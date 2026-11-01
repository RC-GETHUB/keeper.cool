// Runs inside the user's instagram.com tab. It makes the same requests
// Instagram's own web app makes when you open your Saved page or tap the
// bookmark icon, with the user's own session. The background script decides
// what to do and how fast; this file only knows how to talk to Instagram.
(() => {
  // Run once per page, but replace a copy left behind by an earlier version of
  // the extension (it can no longer talk to the extension, so it's dead).
  const alive = () => {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  };
  if (globalThis.__keeperInstagram && globalThis.__keeperInstagram()) return;
  globalThis.__keeperInstagram = alive;

  const APP_ID = "936619743392459"; // Instagram's own web app id, sent by instagram.com itself.
  let wwwClaim = "0";
  const { liteMedia } = globalThis.KeeperMedia;

  function cookie(name) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function problem(code, message, extra = {}) {
    return { code, message, ...extra };
  }

  /** Sorts a failed response into something Keeper can act on, keeping what Instagram said. */
  function classify(status, json, text) {
    const message = (json && (json.message || json.feedback_message)) || "";
    const lower = `${message} ${text.slice(0, 2000)}`.toLowerCase();
    // An HTML reply is an error page full of styles and scripts: say so rather than quote it.
    const said = json ? message : /<html|<!doctype/i.test(text) ? "(Instagram sent an error page)" : text.trim().slice(0, 120);
    const detail = `${status}${said ? ` ${said}` : ""}`;
    if (status === 429 || (json && json.spam) || /feedback_required|wait a few minutes|try again later|rate limit/.test(lower)) {
      return problem("blocked", "Instagram asked Keeper to slow down. Wait a few hours, then try again.", { status, detail });
    }
    if (/checkpoint_required|challenge_required|suspicious|confirm it.s you/.test(lower)) {
      return problem("challenge", "Instagram wants you to confirm it's you. Open instagram.com, follow its prompt, then try again.", { status, detail });
    }
    if (status === 401 || /login_required/.test(lower) || (!json && /accounts\/login|log in to instagram|loginform/.test(lower))) {
      return problem("login", "You're not logged into Instagram in this browser. Log in at instagram.com, then try again.", { status, detail });
    }
    // 5xx, including Instagram's own 572: overloaded or briefly throttling. Worth retrying.
    if (status >= 500) {
      return problem("busy", "Instagram is busy right now. Try again in a minute.", { status, detail });
    }
    if (status === 404 || /media not found|not available|deleted/.test(lower)) {
      return problem("not_found", "This post isn't available any more.", { status, detail });
    }
    return problem("unknown", message || `Instagram answered with an unexpected reply (${status}).`, { status, detail });
  }

  async function api(path, { method = "GET", form } = {}) {
    // The same identifying headers instagram.com sends with its own requests.
    // The "claim" is a token Instagram hands back on each reply and expects on the next request.
    const headers = {
      "X-IG-App-ID": APP_ID,
      "X-IG-WWW-Claim": wwwClaim !== "0" ? wwwClaim : sessionStorage.getItem("www-claim-v2") || "0",
      "X-ASBD-ID": "129477",
      "X-Requested-With": "XMLHttpRequest",
      Accept: "*/*",
    };
    const csrf = cookie("csrftoken");
    if (csrf) headers["X-CSRFToken"] = csrf;
    let body;
    if (form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(form).toString();
    }
    const res = await fetch(`https://www.instagram.com${path}`, { method, headers, body, credentials: "include" });
    const claim = res.headers.get("x-ig-set-www-claim");
    if (claim) wwwClaim = claim;
    const text = await res.text();
    let json = null;
    try {
      // Media and collection ids are bigger than JavaScript numbers can
      // hold exactly; quote long integers before parsing so no digit is lost.
      json = JSON.parse(text.replace(/([:[,]\s*)(\d{16,})(?=\s*[,\]}])/g, '$1"$2"'));
    } catch {
      json = null;
    }
    if (!res.ok || !json || json.status === "fail") throw classify(res.status, json, text);
    return json;
  }

  function query(params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value != null) search.set(key, value);
    const s = search.toString();
    return s ? `?${s}` : "";
  }

  function mediaPage(json) {
    const items = (json.items || []).map((item) => liteMedia(item.media || item)).filter(Boolean);
    return { items, more: Boolean(json.more_available && json.next_max_id), next: json.next_max_id || null };
  }

  const ops = {
    ping: async () => ({ ready: true }),

    whoami: async () => {
      const userId = cookie("ds_user_id");
      if (!userId) throw problem("login", "You're not logged into Instagram in this browser. Log in at instagram.com, then try again.");
      let username = null;
      try {
        const info = await api(`/api/v1/users/${userId}/info/`);
        username = (info.user && info.user.username) || null;
      } catch {
        // The id alone is enough to tell accounts apart.
      }
      return { userId: String(userId), username };
    },

    savedPage: async ({ maxId }) => mediaPage(await api(`/api/v1/feed/saved/posts/${query({ max_id: maxId })}`)),

    collectionsPage: async ({ maxId }) => {
      // "All posts" (ALL_MEDIA_AUTO_COLLECTION) is asked for too: its count is
      // the total number of saved posts, so Keeper can show how many are left.
      const list = (types) =>
        api(`/api/v1/collections/list/${query({ collection_types: types, include_public_only: "0", max_id: maxId })}`);
      let json;
      try {
        json = await list('["ALL_MEDIA_AUTO_COLLECTION","MEDIA"]');
      } catch (error) {
        // Some accounts refuse the "All posts" entry; ask the plain way (no total then).
        if (!error || (error.code !== "not_found" && error.code !== "unknown")) throw error;
        json = await list('["MEDIA"]');
      }
      const all = (json.items || []).find((c) => c.collection_type === "ALL_MEDIA_AUTO_COLLECTION");
      const total = all && Number(all.collection_media_count);
      const items = (json.items || [])
        .filter((c) => !c.collection_type || c.collection_type === "MEDIA")
        .map((c) => ({ id: String(c.collection_id), name: String(c.collection_name || "Untitled collection") }));
      return {
        items,
        total: Number.isFinite(total) && total > 0 ? total : null,
        more: Boolean(json.more_available && json.next_max_id),
        next: json.next_max_id || null,
      };
    },

    collectionPage: async ({ id, maxId }) => {
      try {
        return mediaPage(await api(`/api/v1/feed/collection/${id}/posts/${query({ max_id: maxId })}`));
      } catch (error) {
        // Some collections only answer at the older address.
        if (!error || error.code !== "not_found") throw error;
        return mediaPage(await api(`/api/v1/feed/collection/${id}/${query({ max_id: maxId })}`));
      }
    },

    save: async ({ mediaId }) => {
      await api(`/api/v1/web/save/${mediaId}/save/`, { method: "POST", form: {} });
      return true;
    },

    unsave: async ({ mediaId }) => {
      await api(`/api/v1/web/save/${mediaId}/unsave/`, { method: "POST", form: {} });
      return true;
    },

    addToCollection: async ({ collectionId, mediaId }) => {
      await api(`/api/v1/collections/${collectionId}/edit/`, {
        method: "POST",
        form: { added_media_ids: JSON.stringify([mediaId]) },
      });
      return true;
    },
  };

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || !message || !ops[message.op]) return false;
    ops[message.op](message.args || {}).then(
      (result) => reply({ ok: true, result }),
      (error) => reply({ ok: false, error: error && error.code ? error : problem("unknown", String((error && error.message) || error)) }),
    );
    return true;
  });
})();
