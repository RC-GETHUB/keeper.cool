// Keeper's background worker. Keeper pages talk to it through bridge.js;
// it does the work through an instagram.com tab (instagram.js).
//
// Reading (import) goes at about the speed of scrolling your Saved page.
// Writing (push) is slow on purpose: one post every 40–75 seconds, at most
// 120 Instagram actions an hour and 500 a day, and it stops at the first
// sign Instagram is unhappy. Keep PACE in step with src/lib/push.ts.

const PACE = {
  real: { postMin: 40_000, postMax: 75_000, gapMin: 2_500, gapMax: 5_000, perHour: 120, perDay: 500, pageMin: 1_500, pageMax: 3_000, retries: [5_000, 15_000, 45_000, 90_000],
    // Full imports adapt: start at a page a second, slow down when Instagram
    // pushes back, and speed up again after a calm stretch.
    pageStart: 1_000, pageFloor: 700, pageCeil: 8_000 },
  // Only for Keeper's automated tests on localhost.
  test: { postMin: 200, postMax: 400, gapMin: 50, gapMax: 100, perHour: Infinity, perDay: Infinity, pageMin: 10, pageMax: 20, retries: [50, 50, 50, 50], pageStart: 10, pageFloor: 5, pageCeil: 50 },
};
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const JOB_KEY = "pushJob";
const READ_KEY = "readProgress"; // a full read in progress, so a retry picks up where it stopped
const PROBLEM_KEY = "lastProblem"; // what Instagram last said when something failed (shown in the popup)
const ALARM = "keeper-push";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const between = (min, max) => min + Math.random() * (max - min);

function paceFor(name) {
  return PACE[name] || PACE.real;
}

// ---------------------------------------------------------------- Instagram tab

function waitForLoad(tabId) {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id, info) => id === tabId && info.status === "complete" && done();
    const timer = setTimeout(done, 20_000);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/** An instagram.com tab with instagram.js ready in it. Opens one in the background if needed. */
async function instagramTab() {
  // A tab in an ordinary window: Keeper's small Instagram window (for logging in or switching
  // accounts) closes as soon as it's done, so work never runs in it.
  let [tab] = await chrome.tabs.query({ url: "https://www.instagram.com/*", windowType: "normal" });
  if (!tab) {
    tab = await chrome.tabs.create({ url: "https://www.instagram.com/", active: false });
    await waitForLoad(tab.id);
  } else if (tab.discarded) {
    await chrome.tabs.reload(tab.id);
    await waitForLoad(tab.id);
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, { op: "ping" });
      if (reply && reply.ok) return tab.id;
    } catch {
      // Not injected yet (e.g. the tab was open before the extension was installed).
    }
    if (attempt === 2) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["media.js", "instagram.js"] }).catch(() => {});
    }
    await sleep(500);
  }
  throw { code: "no_tab", message: "Keeper couldn't reach Instagram. Open instagram.com in this browser, make sure you're logged in, and try again." };
}

async function ig(op, args) {
  const tabId = await instagramTab();
  let reply;
  try {
    reply = await chrome.tabs.sendMessage(tabId, { op, args });
  } catch {
    throw { code: "no_tab", message: "The Instagram tab stopped responding. Keeper will open it again on the next try." };
  }
  if (!reply || !reply.ok) {
    const error = (reply && reply.error) || { code: "unknown", message: "No answer from the Instagram tab." };
    await chrome.storage.local.set({ [PROBLEM_KEY]: { ...error, op, at: Date.now() } });
    throw error;
  }
  return reply.result;
}

// ---------------------------------------------------------------- Reading

/**
 * A read that waits and tries again when Instagram is busy (5xx, its 572)
 * or the tab hiccups, instead of stopping the whole import.
 */
async function igRead(op, args, pace, emit, onRetry) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ig(op, args);
    } catch (error) {
      const retryable = error && (error.code === "busy" || error.code === "no_tab" || error.code === "unknown");
      if (!retryable || attempt >= pace.retries.length) throw error;
      if (onRetry) onRetry();
      const wait = pace.retries[attempt];
      if (emit) emit({ phase: "retry", wait, detail: error.detail || error.message });
      await sleep(wait);
    }
  }
}

/**
 * Only what's been saved since Keeper last looked: reads from the top of the
 * Saved list until it reaches a post Keeper already has (usually one request).
 */
// ---------------------------------------------------------------- Saved page

/**
 * Collections as the user's own Saved page shows them: the page is opened in
 * a background tab, its collection links are read (scrolling until no more
 * appear), and the tab is closed. Used when Instagram won't hand over the
 * collection list directly.
 */
/** Collection names Instagram's own pages received for this account (gathered by sniff.js). */
async function storedNames(userId) {
  const all = (await chrome.storage.local.get("collectionNames")).collectionNames || {};
  return all[String(userId)] || { names: {}, paths: [] };
}

/**
 * Reads the collections off the account's Saved page, the way the user sees
 * them: from its links, and from what the page itself received. Opens the
 * page in a small window (a hidden tab doesn't load more as it scrolls) and
 * closes it after. `details` says what happened, for the check report.
 */
async function readSavedPage(username, userId) {
  const url = `https://www.instagram.com/${username}/saved/`;
  const [open] = await chrome.tabs.query({ url: `${url}*` });
  let tabId = open && open.id;
  let windowId = null;
  let previous = null;
  let stoleFocus = false;
  if (!open) {
    // A small window in the corner, without taking focus. (Chrome doesn't load more of a page
    // that can't be seen as it scrolls, so it can't be a hidden tab.)
    previous = await chrome.windows.getLastFocused().catch(() => null);
    const width = 420;
    const height = 640;
    const place =
      previous && previous.width
        ? { left: Math.max(0, previous.left + previous.width - width - 16), top: Math.max(0, previous.top + previous.height - height - 16) }
        : {};
    const win = await chrome.windows.create({ url, type: "popup", focused: false, width, height, ...place });
    windowId = win.id;
    tabId = win.tabs && win.tabs[0] && win.tabs[0].id;
  }
  const details = { opened: open ? "tab already open" : "window" };
  try {
    // A new tab reports "loaded" for its blank page first; wait for Instagram's page itself.
    for (let i = 0; i < 60; i++) {
      const current = await chrome.tabs.get(tabId);
      details.url = (current.url || "").replace(/^https:\/\/www\.instagram\.com/, "");
      if (current.status === "complete" && (current.url || "").startsWith("https://www.instagram.com/")) break;
      await sleep(500);
    }
    if (windowId != null) {
      // If Chrome put it behind another window, it isn't drawn: bring it forward after all.
      const [seen] = await chrome.scripting.executeScript({ target: { tabId }, func: () => document.visibilityState });
      if (seen && seen.result === "hidden") {
        await chrome.windows.update(windowId, { focused: true });
        details.focused = true;
        stoleFocus = true;
      }
    }
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        const found = new Map();
        const hrefs = new Set();
        const read = () => {
          let last = null;
          for (const link of document.querySelectorAll('a[href*="/saved/"]')) {
            const href = link.getAttribute("href") || "";
            if (hrefs.size < 8) hrefs.add(href);
            last = link;
            // Collection links look like /<username>/saved/<name-slug>/<collection id>/
            const match = href.match(/\/saved\/([^/?#]+)\/(\d{5,})\/?(?:[?#]|$)/);
            if (!match || found.has(match[2])) continue;
            const text = (link.innerText || link.getAttribute("aria-label") || "")
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)[0];
            found.set(match[2], text || decodeURIComponent(match[1]).replace(/-/g, " "));
          }
          return last;
        };
        // Wait for the page to draw its collections, then scroll until no new ones load.
        let quiet = 0;
        let last = -1;
        for (let i = 0; i < 240; i++) {
          const lastLink = read();
          if (found.size > 0 && found.size === last) quiet++;
          else quiet = 0;
          last = found.size;
          if (quiet >= 8 || (found.size === 0 && i >= 30)) break;
          if (lastLink) lastLink.scrollIntoView({ block: "end" });
          window.scrollTo(0, document.documentElement.scrollHeight);
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        return {
          collections: [...found].map(([id, name]) => ({ id, name })),
          title: document.title.slice(0, 80),
          savedLinks: document.querySelectorAll('a[href*="/saved/"]').length,
          sampleLinks: [...hrefs],
        };
      },
    });
    const page = (injection && injection.result) || { collections: [] };
    Object.assign(details, { title: page.title, savedLinks: page.savedLinks, sampleLinks: page.sampleLinks, fromLinks: page.collections.length });
    // Give the page's own data a moment to be stored, then add any names it received.
    await sleep(800);
    // "link": drawn on the Saved page. "data": only seen in what Instagram's pages received.
    const byId = new Map(page.collections.map((c) => [c.id, { id: c.id, name: c.name, from: "link" }]));
    const stored = userId ? await storedNames(userId) : { names: {}, paths: [] };
    for (const [id, name] of Object.entries(stored.names)) {
      const seen = byId.get(id);
      if (!seen) byId.set(id, { id, name, from: "data" });
      else if (/^\d+$/.test(seen.name)) seen.name = name;
    }
    details.fromPageData = Object.keys(stored.names).length;
    details.pageDataFrom = stored.paths;
    details.pageRequests = stored.requests || [];
    // Remember the names drawn on the page too, so next time the window isn't needed.
    if (userId && page.collections.length) {
      const all = (await chrome.storage.local.get("collectionNames")).collectionNames || {};
      const mine = all[String(userId)] || { names: {}, paths: [] };
      for (const c of page.collections) if (!mine.names[c.id] || /^\d+$/.test(mine.names[c.id])) mine.names[c.id] = c.name;
      all[String(userId)] = mine;
      await chrome.storage.local.set({ collectionNames: all });
    }
    return { collections: [...byId.values()], details };
  } finally {
    if (windowId != null) chrome.windows.remove(windowId).catch(() => {});
    if (stoleFocus && previous && previous.id != null) chrome.windows.update(previous.id, { focused: true }).catch(() => {});
  }
}

// Instagram's Saved page asks for its collections with these GraphQL queries. Their ids
// change when Instagram updates its site, so the ones the page itself last used (seen by
// sniff.js) come first.
const SAVED_QUERIES = {
  first: { name: "PolarisProfileSavedTabContentQuery", docId: "27584326974521636" },
  next: { name: "PolarisProfileSavedTabContentQuery_connection", docId: "27959320833754327" },
};
const SAVED_TYPES = ["ALL_MEDIA_AUTO_COLLECTION", "PLAYLIST_AUTO_COLLECTION", "MEDIA", "AUDIO_AUTO_COLLECTION"];

/**
 * Reads every collection's name and id in the background, the way Instagram's own Saved
 * page does, without opening anything. `onPage` hears how many so far. Throws if
 * Instagram won't answer this way, so the Saved page can be used instead.
 */
async function collectionsFromGraph(userId, onPage) {
  const stored = userId ? await storedNames(userId) : { requests: [] };
  const seen = (name) => (stored.requests || []).filter((r) => r.name === name && r.docId).map((r) => r.docId).reverse();
  const ids = (key) => [...new Set([...seen(SAVED_QUERIES[key].name), SAVED_QUERIES[key].docId])];
  const ask = async (key, after) => {
    let lastError = null;
    for (const docId of ids(key)) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await ig("collectionsGraph", { docId, name: SAVED_QUERIES[key].name, after, first: 24, types: SAVED_TYPES });
        } catch (error) {
          lastError = error;
          if (error && (error.code === "login" || error.code === "blocked" || error.code === "challenge")) throw error;
          if (!error || error.code !== "busy") break; // Try the next query id.
          await sleep([3000, 10000][attempt] || 10000);
        }
      }
    }
    throw lastError || { code: "unknown", message: "Instagram didn't answer." };
  };
  const found = new Map();
  let page = await ask("first", null);
  for (let i = 0; i < 200; i++) {
    for (const c of page.items) if (!found.has(c.id)) found.set(c.id, c.name);
    if (onPage) onPage(found.size);
    if (!page.more) break;
    await sleep(between(500, 1100));
    page = await ask("next", page.next);
  }
  if (!found.size) throw { code: "not_found", message: "Instagram's Saved page query returned no collections." };
  // Remember them, so the next import needn't ask again unless something's new.
  if (userId) {
    const all = (await chrome.storage.local.get("collectionNames")).collectionNames || {};
    const mine = all[String(userId)] || { names: {}, paths: [] };
    for (const [id, name] of found) mine.names[id] = name;
    all[String(userId)] = mine;
    await chrome.storage.local.set({ collectionNames: all });
  }
  return [...found].map(([id, name]) => ({ id, name, from: "graph" }));
}

/** Collection names: quietly in the background first, the Saved page (a small window) only if that fails. */
async function collectionsInBackground(username, userId, onPage) {
  try {
    return await collectionsFromGraph(userId, onPage);
  } catch (error) {
    if (error && (error.code === "login" || error.code === "blocked" || error.code === "challenge")) throw error;
    return username ? collectionsFromSavedPage(username, userId) : [];
  }
}

async function collectionsFromSavedPage(username, userId) {
  return (await readSavedPage(username, userId)).collections;
}

/**
 * A quick report on which ways of reading Instagram work for this account,
 * for when something doesn't come through. Reads only.
 */
async function diagnose(hint = {}) {
  const report = { extension: chrome.runtime.getManifest().version, at: new Date().toISOString() };
  const step = async (name, run) => {
    try {
      report[name] = await run();
    } catch (error) {
      report[name] = { failed: (error && (error.code || error.message)) || String(error), said: (error && error.detail) || null };
    }
  };
  let account = null;
  let fromPage = [];
  await step("account", async () => {
    account = await ig("whoami", hint);
    return { username: account.username, foundVia: account.via, hasId: Boolean(account.userId) };
  });
  await step("savedList", async () => {
    const page = await ig("savedPage", { maxId: null });
    const withIds = page.items.filter((m) => Array.isArray(m.collectionIds));
    return { posts: page.items.length, more: page.more, postsListingTheirCollections: withIds.length, inACollection: withIds.filter((m) => m.collectionIds.length).length };
  });
  await step("collectionList", async () => {
    const page = await ig("collectionsPage", { maxId: null });
    return { collections: page.items.length, total: page.total, first: page.items.slice(0, 3).map((c) => c.name) };
  });
  let fromGraph = [];
  await step("collectionQuery", async () => {
    fromGraph = await collectionsFromGraph(account && account.userId);
    return { collections: fromGraph.length, first: fromGraph.slice(0, 3).map((c) => c.name) };
  });
  await step("savedPage", async () => {
    // Only opens Instagram's Saved page (a small window) when the quiet way didn't work.
    if (fromGraph.length) {
      fromPage = fromGraph;
      return { skipped: "not needed" };
    }
    if (!account || !account.username) return { skipped: "no username" };
    const { collections, details } = await readSavedPage(account.username, account.userId);
    fromPage = collections;
    return { collections: fromPage.length, first: fromPage.slice(0, 3).map((c) => c.name), ...details };
  });
  if (fromPage[0]) {
    await step("collectionPosts", async () => {
      const page = await ig("collectionPage", { id: fromPage[0].id, maxId: null });
      return { collection: fromPage[0].name, posts: page.items.length, more: page.more };
    });
  }
  return report;
}

async function readNewSaves(pace, known) {
  const { userId, username } = await ig("whoami");
  const account = { userId, username };
  const knownSet = new Set(known);
  const saved = [];
  let maxId = null;
  for (let page = 0; page < 10; page++) {
    const result = await igRead("savedPage", { maxId }, pace);
    const firstKnown = result.items.findIndex((m) => knownSet.has(m.code));
    saved.push(...(firstKnown < 0 ? result.items : result.items.slice(0, firstKnown)));
    if (firstKnown >= 0 || !result.more) break;
    maxId = result.next;
    await sleep(between(pace.pageMin, pace.pageMax));
  }
  return { account, saved, collections: [], partial: true };
}

async function readInstagram(pace, emit, thumbs, hint = {}) {
  const found = await ig("whoami", hint);
  const account = { userId: found.userId, username: found.username };
  emit({ phase: "account", account });

  // The time between pages adapts: it doubles whenever Instagram pushes back
  // and eases off again after a calm stretch.
  let gap = pace.pageStart;
  let calm = 0;
  const slowDown = () => {
    gap = Math.min(pace.pageCeil, gap * 2);
    calm = 0;
  };
  const rest = () => sleep(between(gap * 0.8, gap * 1.2));
  const calmer = () => {
    if (++calm >= 8) gap = Math.max(pace.pageFloor, gap * 0.85);
  };

  // The collection list comes first: it also says how many posts are saved
  // in all, so progress can show how many are left.
  const collections = [];
  const warnings = [];
  let listFailed = false;
  let total = null;
  let maxId = null;
  try {
    for (let page = 0; page < 200; page++) {
      const result = await igRead("collectionsPage", { maxId }, pace, emit, slowDown);
      collections.push(...result.items);
      if (result.total) total = result.total;
      if (!result.more) break;
      maxId = result.next;
      await rest();
    }
  } catch (error) {
    // Without the collection list the saved posts still come in; only stop
    // for the things that would stop those too.
    if (error && (error.code === "login" || error.code === "blocked" || error.code === "challenge")) throw error;
    collections.length = 0;
    listFailed = true;
    // Some accounts don't get the list at all. Start from the names Keeper already knows; the
    // Saved page is only opened, after the posts, if a post is in a collection not named yet.
    const stored = await storedNames(account.userId);
    for (const [id, name] of Object.entries(stored.names)) collections.push({ id, name, from: "data" });
  }

  // Say how many collections there are straight away; they're matched up after the saved posts.
  if (collections.length) emit({ phase: "collections", done: 0, total: collections.length });

  // A read that stopped part-way (logged out, slowed down, Chrome closed)
  // carries on from where it got to, for up to six hours.
  const stored = (await chrome.storage.local.get(READ_KEY))[READ_KEY];
  const resume = stored && stored.userId === account.userId && stored.maxId && Date.now() - stored.at < 6 * HOUR;
  const saved = resume ? stored.saved : [];
  maxId = resume ? stored.maxId : null;
  if (saved.length) {
    emit({ phase: "page", media: saved });
    if (thumbs) thumbs.add(saved);
  }
  emit({ phase: "saved", count: saved.length, total });
  for (let page = 0; page < 5_000; page++) {
    await rest();
    const result = await igRead("savedPage", { maxId }, pace, emit, slowDown);
    saved.push(...result.items);
    // Each page goes to Keeper straight away, so the library fills in while it reads.
    emit({ phase: "page", media: result.items });
    if (thumbs) thumbs.add(result.items);
    emit({ phase: "saved", count: saved.length, total: total && Math.max(total, saved.length), gap });
    calmer();
    if (!result.more) break;
    maxId = result.next;
    if (page % 3 === 0) await chrome.storage.local.set({ [READ_KEY]: { userId: account.userId, saved, maxId, at: Date.now() } });
  }

  // When saved posts carry their collection ids, membership is already
  // known. Otherwise read each collection.
  const haveIds = saved.length > 0 && saved.every((m) => Array.isArray(m.collectionIds));
  if (listFailed) {
    const named = new Set(collections.map((c) => c.id));
    const unnamed = haveIds ? new Set(saved.flatMap((m) => m.collectionIds).filter((id) => !named.has(id))) : null;
    if (!unnamed || unnamed.size) {
      try {
        const onPage = (n) => emit({ phase: "collections", done: 0, total: n, reading: true });
        for (const c of await collectionsInBackground(account.username, account.userId, onPage)) {
          const known = collections.find((k) => k.id === c.id);
          if (known) Object.assign(known, c);
          else collections.push(c);
        }
      } catch {
        // Falls through to the note below.
      }
    }
    const nowNamed = new Set(collections.map((c) => c.id));
    const stillUnnamed = haveIds && saved.some((m) => m.collectionIds.some((id) => !nowNamed.has(id)));
    if (!collections.length && (!haveIds || stillUnnamed)) {
      warnings.push("Instagram wouldn't list your collections this time, so they aren't in Keeper yet. Import again later to bring them in.");
    }
    emit({ phase: "collections", done: 0, total: collections.length });
  }
  if (haveIds) {
    const byId = new Map(collections.map((c) => [c.id, { ...c, items: [] }]));
    for (const m of saved) for (const id of m.collectionIds) byId.get(id) && byId.get(id).items.push(m.code);
    emit({ phase: "collections", done: collections.length, total: collections.length });
    await chrome.storage.local.remove(READ_KEY);
    // A name only seen in Instagram's page data, with none of these posts in it, may not be this account's.
    const kept = [...byId.values()].filter((c) => c.items.length || c.from !== "data").map(({ from, ...c }) => c); // eslint-disable-line no-unused-vars
    return { account, saved, collections: kept, warnings };
  }

  const inSaved = new Map(saved.map((m) => [m.code, m]));
  for (const m of saved) m.collectionIds = [];
  const filled = [];
  const unreadable = [];
  for (let i = 0; i < collections.length; i++) {
    const c = { ...collections[i], items: [] };
    maxId = null;
    try {
      for (let page = 0; page < 2_000; page++) {
        await rest();
        const result = await igRead("collectionPage", { id: c.id, maxId }, pace, emit, slowDown);
        for (const m of result.items) {
          c.items.push(m.code);
          const s = inSaved.get(m.code);
          if (s && !s.collectionIds.includes(c.id)) s.collectionIds.push(c.id);
        }
        calmer();
        if (!result.more) break;
        maxId = result.next;
      }
    } catch (error) {
      // Logged out or told to slow down: stop, and a retry picks up from here.
      // Anything else wrong with one collection shouldn't sink the import.
      if (error && (error.code === "login" || error.code === "blocked" || error.code === "challenge")) throw error;
      unreadable.push(c.name);
    }
    filled.push(c);
    emit({ phase: "collections", done: i + 1, total: collections.length, name: c.name });
  }
  await chrome.storage.local.remove(READ_KEY);
  if (unreadable.length) {
    warnings.push(
        `Instagram wouldn't open ${unreadable.length === 1 ? "the collection" : `${unreadable.length} collections`} ${unreadable.map((n) => `“${n}”`).join(", ")}, so ${unreadable.length === 1 ? "it's" : "they're"} empty in Keeper for now. The posts themselves were imported.`,
    );
  }
  return { account, saved, collections: filled.filter((c) => c.items.length || c.from !== "data").map(({ from, ...c }) => c), warnings };
}

// ---------------------------------------------------------------- Cover images

function base64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** A square 112 px JPEG of the cover, as a data: URI (~4 KB), so it never expires. */
async function makeThumb(url) {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`image ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob());
  const size = 112;
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.72 });
  return `data:image/jpeg;base64,${base64(await blob.arrayBuffer())}`;
}

/**
 * Makes cover images as posts arrive (six at a time), sending them to Keeper
 * in small batches, so pictures fill in while the import is still reading.
 */
function thumbPipeline(emit) {
  const queue = [];
  let next = 0;
  let done = 0;
  let total = 0;
  let running = 0;
  let closed = false;
  let batch = [];
  let finished = null;
  const flush = () => {
    if (batch.length) emit({ phase: "thumbs", done, total, items: batch });
    batch = [];
  };
  const settle = () => {
    if (closed && done === total && finished) {
      flush();
      emit({ phase: "thumbs-done", done, total });
      finished();
      finished = null;
    }
  };
  const pump = () => {
    while (running < 6 && next < queue.length) {
      const m = queue[next++];
      running++;
      makeThumb(m.image)
        .then(
          (data) => batch.push({ code: m.code, data }),
          () => {
            // A missing cover just keeps the coloured tile.
          },
        )
        .finally(() => {
          done++;
          running--;
          if (batch.length >= 24) flush();
          pump();
          settle();
        });
    }
  };
  return {
    add(items) {
      const withImages = items.filter((m) => m.image);
      queue.push(...withImages);
      total += withImages.length;
      pump();
    },
    finish() {
      closed = true;
      return new Promise((resolve) => {
        finished = resolve;
        settle();
      });
    },
  };
}

// ---------------------------------------------------------------- Pushing

async function loadJob() {
  return (await chrome.storage.local.get(JOB_KEY))[JOB_KEY] || null;
}

async function saveJob(job) {
  await chrome.storage.local.set({ [JOB_KEY]: job });
  broadcast({ event: "job", job: summary(job) });
}

function summary(job) {
  if (!job) return null;
  const step = job.steps[job.index];
  return {
    id: job.id,
    status: job.status,
    message: job.message || null,
    done: job.index,
    total: job.steps.length,
    account: job.account,
    nextAt: job.nextAt || null,
    skipped: job.skipped,
    // A post that's been unsaved but not saved again yet.
    pendingUrl: step && job.phase === "unsaved" ? `https://www.instagram.com/p/${step.code}/` : null,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
  };
}

let ticking = false;
let testTimer = null;

function schedule(job, delay) {
  job.nextAt = Date.now() + delay;
  if (job.pace === "test") {
    clearTimeout(testTimer);
    testTimer = setTimeout(tick, delay);
  } else {
    // Alarms survive the worker being shut down between posts.
    chrome.alarms.create(ALARM, { when: job.nextAt });
  }
}

function budgetWait(job, pace, needed) {
  const now = Date.now();
  job.actions = job.actions.filter((t) => now - t < DAY);
  const lastHour = job.actions.filter((t) => now - t < HOUR);
  if (lastHour.length + needed > pace.perHour) return lastHour[0] + HOUR - now + 1_000;
  if (job.actions.length + needed > pace.perDay) return job.actions[0] + DAY - now + 1_000;
  return 0;
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const job = await loadJob();
    if (!job || (job.status !== "running" && job.status !== "waiting")) return;
    const pace = paceFor(job.pace);
    const step = job.steps[job.index];
    if (!step) {
      job.status = "done";
      job.finishedAt = Date.now();
      await saveJob(job);
      return;
    }

    const needed = (step.action === "resave" ? 2 : 1) + step.collections.length;
    const wait = budgetWait(job, pace, needed);
    if (wait > 0) {
      job.status = "waiting";
      job.message = "Pausing to stay within Instagram's limits. Keeper carries on by itself.";
      schedule(job, wait);
      await saveJob(job);
      return;
    }
    job.status = "running";
    job.message = null;

    // Check it's still the same Instagram account every so often.
    if (job.index % 20 === 0) {
      const me = await ig("whoami");
      if (me.userId !== job.account.userId) {
        job.status = "paused";
        job.message = `Instagram is now logged into a different account${me.username ? ` (@${me.username})` : ""}. Log back into @${job.account.username || job.account.userId} to continue.`;
        await saveJob(job);
        return;
      }
    }

    const record = async () => {
      job.actions.push(Date.now());
      await chrome.storage.local.set({ [JOB_KEY]: job });
    };
    // phase: null → nothing done yet; "unsaved" → unsaved, not saved again;
    // a number → saved, and that many collections restored.
    if (step.action === "resave" && job.phase == null) {
      await ig("unsave", { mediaId: step.mediaId });
      job.phase = "unsaved";
      await record();
      await sleep(between(pace.gapMin, pace.gapMax));
    }
    if (job.phase == null || job.phase === "unsaved") {
      await ig("save", { mediaId: step.mediaId });
      job.phase = 0;
      await record();
    }
    for (let i = job.phase; i < step.collections.length; i++) {
      await sleep(between(pace.gapMin, pace.gapMax));
      await ig("addToCollection", { collectionId: step.collections[i], mediaId: step.mediaId });
      job.phase = i + 1;
      await record();
    }
    job.index++;
    job.phase = null;
    job.failures = 0;
    finishOrContinue(job, pace);
    await saveJob(job);
  } catch (error) {
    await handleError(error);
  } finally {
    ticking = false;
  }
}

function finishOrContinue(job, pace) {
  if (job.index >= job.steps.length) {
    job.status = "done";
    job.finishedAt = Date.now();
    job.nextAt = null;
    job.message = null;
  } else {
    schedule(job, between(pace.postMin, pace.postMax));
  }
}

async function handleError(error) {
  const job = await loadJob();
  if (!job) return;
  const pace = paceFor(job.pace);
  const step = job.steps[job.index];
  const code = (error && error.code) || "unknown";

  if (code === "not_found" && step && job.phase == null) {
    // Deleted or private: skip it and move on.
    job.skipped.push({ code: step.code, reason: "unavailable" });
    job.index++;
    job.phase = null;
    finishOrContinue(job, pace);
  } else if (code === "blocked" || code === "challenge" || code === "login") {
    job.status = code === "login" ? "paused" : "blocked";
    job.message = error.message;
    job.nextAt = null;
  } else {
    // Network hiccup, tab closed, unexpected answer: try again a bit later,
    // and stop after three failures in a row so nothing loops.
    job.failures = (job.failures || 0) + 1;
    if (job.failures >= 3) {
      job.status = "paused";
      job.message = `Stopped after repeated errors: ${(error && error.message) || error}`;
      job.nextAt = null;
    } else {
      schedule(job, between(pace.postMin, pace.postMax));
    }
  }
  await saveJob(job);
}

async function startPush({ steps, account, pace }) {
  const existing = await loadJob();
  if (existing && (existing.status === "running" || existing.status === "waiting")) {
    throw { code: "busy", message: "A sync is already running. Pause or stop it first." };
  }
  const me = await ig("whoami");
  if (me.userId !== account.userId) {
    throw {
      code: "account",
      message: `Instagram is logged into ${me.username ? `@${me.username}` : "a different account"}, not the account this sync was planned for.`,
    };
  }
  const job = {
    id: crypto.randomUUID(),
    account: me,
    steps,
    index: 0,
    phase: null,
    status: "running",
    pace,
    actions: [],
    skipped: [],
    failures: 0,
    startedAt: Date.now(),
  };
  await saveJob(job);
  schedule(job, 0);
  await chrome.storage.local.set({ [JOB_KEY]: job });
  return summary(job);
}

async function setStatus(action) {
  const job = await loadJob();
  if (!job) return null;
  if (action === "pause" && (job.status === "running" || job.status === "waiting")) {
    job.status = "paused";
    job.message = "Paused. Resume whenever you like.";
    job.nextAt = null;
    chrome.alarms.clear(ALARM);
    clearTimeout(testTimer);
  } else if (action === "resume" && (job.status === "paused" || job.status === "blocked")) {
    job.status = "running";
    job.message = null;
    job.failures = 0;
    schedule(job, 0);
  } else if (action === "cancel") {
    // Never leave a post unsaved: finish putting back the one in progress.
    const step = job.steps[job.index];
    if (step && job.phase === "unsaved") {
      try {
        await ig("save", { mediaId: step.mediaId });
        job.phase = 0;
      } catch {
        // pendingUrl in the summary still points the user at it.
      }
    }
    job.status = "cancelled";
    job.finishedAt = Date.now();
    job.nextAt = null;
    chrome.alarms.clear(ALARM);
    clearTimeout(testTimer);
  }
  await saveJob(job);
  return summary(job);
}

chrome.alarms.onAlarm.addListener((alarm) => alarm.name === ALARM && tick());

chrome.runtime.onStartup.addListener(async () => {
  // Chrome was restarted mid-push: pick up where it left off.
  const job = await loadJob();
  if (job && (job.status === "running" || job.status === "waiting")) {
    schedule(job, between(5_000, 15_000));
    await chrome.storage.local.set({ [JOB_KEY]: job });
  }
});

// ---------------------------------------------------------------- Talking to Keeper

const ports = new Set();
let fullReadRunning = false;

function broadcast(message) {
  for (const port of ports) {
    try {
      port.postMessage(message);
    } catch {
      ports.delete(port);
    }
  }
}

function originOf(port) {
  try {
    return new URL(port.sender.url).origin;
  } catch {
    return "";
  }
}

async function handle(port, message) {
  const { id, type, payload = {} } = message;
  const reply = (body) => {
    try {
      port.postMessage({ id, ...body });
    } catch {
      // Keeper tab closed.
    }
  };
  // The quick pace is only for Keeper's own tests, run on localhost.
  const pace = payload.pace === "test" && originOf(port) === "http://localhost:3000" ? "test" : "real";
  try {
    let result;
    switch (type) {
      case "hello":
        result = { version: chrome.runtime.getManifest().version, job: summary(await loadJob()) };
        break;
      case "collections": {
        // Just the collection names and ids, for when the username is now known.
        const username = payload.username;
        let list = [];
        try {
          const page = await ig("collectionsPage", { maxId: null });
          list = page.items;
        } catch {
          const me = await ig("whoami");
          list = await collectionsInBackground(username || me.username, me.userId);
        }
        result = { collections: list };
        break;
      }
      case "diagnose":
        result = await diagnose({ usernameHint: payload.usernameHint, hintUserId: payload.hintUserId });
        break;
      case "account":
        result = await ig("whoami");
        break;
      case "read": {
        if (!Array.isArray(payload.known) && fullReadRunning) {
          throw { code: "busy", message: "An import is already running. Leave it to finish; this window shows its progress when you reopen it." };
        }
        const emit = (progress) => reply({ event: "progress", ...progress });
        const thumbs = payload.thumbnails !== false ? thumbPipeline(emit) : null;
        let read;
        if (Array.isArray(payload.known)) {
          read = await readNewSaves(paceFor(pace), payload.known);
          if (thumbs) thumbs.add(read.saved);
        } else {
          fullReadRunning = true;
          try {
            read = await readInstagram(paceFor(pace), emit, thumbs, { usernameHint: payload.usernameHint, hintUserId: payload.hintUserId });
          } finally {
            fullReadRunning = false;
          }
        }
        // Hand over the list now; the last cover images follow as progress events.
        reply({ ok: true, result: read });
        if (thumbs) await thumbs.finish();
        return;
      }
      case "push:start":
        result = await startPush({ steps: payload.steps, account: payload.account, pace });
        break;
      case "push:status":
        result = summary(await loadJob());
        break;
      case "push:pause":
      case "push:resume":
      case "push:cancel":
        result = await setStatus(type.slice(5));
        break;
      default:
        throw { code: "unknown", message: `Unknown request: ${type}` };
    }
    reply({ ok: true, result });
  } catch (error) {
    reply({ ok: false, error: error && error.code ? error : { code: "unknown", message: String((error && error.message) || error) } });
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "keeper") return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  port.onMessage.addListener((message) => handle(port, message));
});

// The toolbar popup.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.tab) return false;
  const run = async () => {
    if (message.type === "status") return summary(await loadJob());
    if (message.type === "problem") return (await chrome.storage.local.get(PROBLEM_KEY))[PROBLEM_KEY] || null;
    if (["pause", "resume", "cancel"].includes(message.type)) return setStatus(message.type);
    return null;
  };
  run().then(reply, () => reply(null));
  return true;
});

// Content scripts only arrive in pages opened after installing. On a fresh
// install, connect Keeper pages that are already open, so the install guide
// turns green without a reload. (After an update, open pages ask for a reload.)
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install") return;
  const pages = chrome.runtime.getManifest().content_scripts.find((c) => c.js.includes("bridge.js")).matches;
  for (const tab of await chrome.tabs.query({ url: pages })) {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["bridge.js"] }).catch(() => {});
  }
});
