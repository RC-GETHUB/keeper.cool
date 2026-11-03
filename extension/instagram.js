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

  const USERNAME = /^[A-Za-z0-9._]{1,30}$/;
  const valid = (name) => (typeof name === "string" && USERNAME.test(name) ? name : null);

  /**
   * The logged-in account's username. Not every account gets it from the
   * same place, so several are tried in turn; \`via\` says which worked.
   */
  async function findUsername(userId, hint) {
    const attempts = [
      ["user info", async () => valid((await api(`/api/v1/users/${userId}/info/`)).user?.username)],
      ["account settings", async () => valid((await api("/api/v1/accounts/edit/web_form_data/")).form_data?.username)],
      ["current user", async () => valid((await api("/api/v1/accounts/current_user/?edit=true")).user?.username)],
      [
        "page data",
        async () => {
          // The logged-in page carries the viewer's own record: a username next to this account's id.
          const html = await (await fetch("/", { credentials: "include" })).text();
          const near = new RegExp(`"username":"([A-Za-z0-9._]{1,30})"[^{}]{0,300}"(?:id|pk|pk_id)":"?${userId}\\b|"(?:id|pk|pk_id)":"?${userId}"?[^{}]{0,300}"username":"([A-Za-z0-9._]{1,30})"`);
          const match = html.match(near);
          return valid(match && (match[1] || match[2]));
        },
      ],
      [
        "profile menu",
        async () => {
          // Instagram's left-hand menu has a "Profile" item linking to /<username>/.
          const links = [...document.querySelectorAll('a[href^="/"]')].filter((a) => /^\s*profile\s*$/i.test(a.innerText || a.getAttribute("aria-label") || ""));
          const names = [...new Set(links.map((a) => (a.getAttribute("href") || "").match(/^\/([A-Za-z0-9._]{1,30})\/?$/)?.[1]).filter(Boolean))];
          return names.length === 1 ? valid(names[0]) : null;
        },
      ],
      [
        "profile link",
        async () => {
          // The navigation's own profile picture is labelled "<username>'s profile picture".
          const labels = [...document.querySelectorAll("nav img[alt$=\"'s profile picture\"], [role=navigation] img[alt$=\"'s profile picture\"]")]
            .map((img) => img.getAttribute("alt").replace(/'s profile picture$/, ""));
          const unique = [...new Set(labels)];
          return unique.length === 1 ? valid(unique[0]) : null;
        },
      ],
      ["Keeper", async () => valid(hint)],
    ];
    for (const [via, attempt] of attempts) {
      try {
        const username = await attempt();
        if (username) return { username, via };
      } catch {
        // Try the next way.
      }
    }
    return { username: null, via: null };
  }

  // ---- Instagram's own GraphQL, as its Saved page uses it (for accounts that can't list collections the plain way).

  /** The page tokens Instagram's web app sends with GraphQL requests (from this page, or a fresh copy of it). */
  let graphTokens = null;
  async function tokens() {
    if (graphTokens) return graphTokens;
    const find = (html) => {
      const lsd = html.match(/"LSD",\[\],\{"token":"([^"]+)"/) || html.match(/"lsd":"([^"]+)"/);
      const dtsg = html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/) || html.match(/"dtsg":\{"token":"([^"]+)"/);
      return { lsd: lsd ? lsd[1] : null, dtsg: dtsg ? dtsg[1] : null };
    };
    let found = find(document.documentElement.innerHTML);
    if (!found.lsd || !found.dtsg) {
      const fresh = find(await (await fetch("/", { credentials: "include" })).text());
      found = { lsd: found.lsd || fresh.lsd, dtsg: found.dtsg || fresh.dtsg };
    }
    graphTokens = found;
    return found;
  }

  async function graphql(docId, name, variables) {
    const { lsd, dtsg } = await tokens();
    const form = {
      __a: "1",
      __comet_req: "7",
      fb_api_caller_class: "RelayModern",
      fb_api_req_friendly_name: name,
      variables: JSON.stringify(variables),
      server_timestamps: "true",
      doc_id: docId,
    };
    if (lsd) form.lsd = lsd;
    if (dtsg) {
      form.fb_dtsg = dtsg;
      form.jazoest = `2${[...dtsg].reduce((sum, ch) => sum + ch.charCodeAt(0), 0)}`;
    }
    const headers = {
      "X-IG-App-ID": APP_ID,
      "X-ASBD-ID": "129477",
      "X-FB-Friendly-Name": name,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "*/*",
    };
    if (lsd) headers["X-FB-LSD"] = lsd;
    const csrf = cookie("csrftoken");
    if (csrf) headers["X-CSRFToken"] = csrf;
    const res = await fetch("https://www.instagram.com/api/graphql", {
      method: "POST",
      headers,
      body: new URLSearchParams(form).toString(),
      credentials: "include",
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text.replace(/^for \(;;\);/, "").replace(/([:[,]\s*)(\d{16,})(?=\s*[,\]}])/g, '$1"$2"'));
    } catch {
      json = null;
    }
    if (!res.ok || !json) throw classify(res.status, json, text);
    if (!json.data && json.errors && json.errors.length) {
      // A stale query id or missing token: say so, so Keeper can fall back to the Saved page.
      graphTokens = null;
      throw problem("unknown", String(json.errors[0].message || "Instagram didn't accept the request."), { status: res.status, detail: `graphql ${String(json.errors[0].message || "").slice(0, 120)}` });
    }
    return json;
  }

  /** Collections (id and name) and where the next page starts, from a GraphQL answer. */
  function collectionsIn(json) {
    const items = [];
    let pageInfo = null;
    const walk = (node, depth = 0) => {
      if (!node || typeof node !== "object" || depth > 40) return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1);
        return;
      }
      if (!pageInfo && typeof node.has_next_page === "boolean") pageInfo = node;
      const name = node.collection_name;
      const id = node.collection_id ?? (name !== undefined ? (node.id ?? node.pk) : undefined);
      const type = node.collection_type;
      if (typeof name === "string" && id != null && /^\d{5,}$/.test(String(id)) && (!type || type === "MEDIA")) {
        items.push({ id: String(id), name });
      }
      for (const key in node) if (node[key] && typeof node[key] === "object") walk(node[key], depth + 1);
    };
    walk(json.data);
    return { items, more: Boolean(pageInfo && pageInfo.has_next_page && pageInfo.end_cursor), next: pageInfo ? pageInfo.end_cursor || null : null };
  }

  function mediaPage(json) {
    const items = (json.items || []).map((item) => liteMedia(item.media || item)).filter(Boolean);
    return { items, more: Boolean(json.more_available && json.next_max_id), next: json.next_max_id || null };
  }

  const ops = {
    ping: async () => ({ ready: true }),

    whoami: async ({ usernameHint, hintUserId } = {}) => {
      const userId = cookie("ds_user_id");
      if (!userId) throw problem("login", "You're not logged into Instagram in this browser. Log in at instagram.com, then try again.");
      // Keeper's own idea of the username only counts if it's for this very account.
      const hint = hintUserId && String(hintUserId) === String(userId) ? usernameHint : null;
      const { username, via } = await findUsername(String(userId), hint);
      return { userId: String(userId), username, via };
    },

    collectionsGraph: async ({ docId, name, after, first = 24, types }) => {
      const variables = { collection_types: types, first };
      if (after != null) variables.after = after;
      return collectionsIn(await graphql(docId, name, variables));
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

  // Collection names Instagram's own page received (see sniff.js), kept per account for Keeper.
  const NAMES_KEY = "collectionNames";
  window.addEventListener("message", async (event) => {
    if (event.source !== window || !event.data || event.data.__keeper !== "collections" || !alive()) return;
    const userId = cookie("ds_user_id");
    const pairs = Array.isArray(event.data.pairs) ? event.data.pairs : [];
    if (!userId || !pairs.length) return;
    try {
      const all = (await chrome.storage.local.get(NAMES_KEY))[NAMES_KEY] || {};
      const mine = all[userId] || { names: {}, paths: [] };
      for (const [id, name] of pairs) if (/^\d{5,}$/.test(id) && typeof name === "string") mine.names[id] = name.slice(0, 200);
      mine.paths = [...new Set([...(mine.paths || []), ...(event.data.paths || [])])].slice(-10);
      for (const r of Array.isArray(event.data.requests) ? event.data.requests : []) {
        mine.requests = (mine.requests || []).filter((k) => !(k.path === r.path && k.name === r.name && k.docId === r.docId));
        mine.requests.push(r);
      }
      mine.requests = (mine.requests || []).slice(-5);
      mine.at = Date.now();
      all[userId] = mine;
      await chrome.storage.local.set({ [NAMES_KEY]: all });
    } catch {
      // The extension was reloaded; this page's copy is retired.
    }
  });
  window.postMessage({ __keeper: "hello" }, location.origin);

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || !message || !ops[message.op]) return false;
    ops[message.op](message.args || {}).then(
      (result) => reply({ ok: true, result }),
      (error) => reply({ ok: false, error: error && error.code ? error : problem("unknown", String((error && error.message) || error)) }),
    );
    return true;
  });
})();
