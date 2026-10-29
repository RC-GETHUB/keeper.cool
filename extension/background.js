// Keeper's background worker. Keeper pages talk to it through bridge.js;
// it does the work through an instagram.com tab (instagram.js).
//
// Reading (import) goes at about the speed of scrolling your Saved page.
// Writing (push) is slow on purpose: one post every 40–75 seconds, at most
// 120 Instagram actions an hour and 500 a day, and it stops at the first
// sign Instagram is unhappy. Keep PACE in step with src/lib/push.ts.

const PACE = {
  real: { postMin: 40_000, postMax: 75_000, gapMin: 2_500, gapMax: 5_000, perHour: 120, perDay: 500, pageMin: 700, pageMax: 1_500 },
  // Only for Keeper's automated tests on localhost.
  test: { postMin: 200, postMax: 400, gapMin: 50, gapMax: 100, perHour: Infinity, perDay: Infinity, pageMin: 10, pageMax: 20 },
};
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const JOB_KEY = "pushJob";
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
  let [tab] = await chrome.tabs.query({ url: "https://www.instagram.com/*" });
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
  if (!reply || !reply.ok) throw (reply && reply.error) || { code: "unknown", message: "No answer from the Instagram tab." };
  return reply.result;
}

// ---------------------------------------------------------------- Reading

/**
 * Only what's been saved since Keeper last looked: reads from the top of the
 * Saved list until it reaches a post Keeper already has (usually one request).
 */
async function readNewSaves(pace, known) {
  const account = await ig("whoami");
  const knownSet = new Set(known);
  const saved = [];
  let maxId = null;
  for (let page = 0; page < 10; page++) {
    const result = await ig("savedPage", { maxId });
    const firstKnown = result.items.findIndex((m) => knownSet.has(m.code));
    saved.push(...(firstKnown < 0 ? result.items : result.items.slice(0, firstKnown)));
    if (firstKnown >= 0 || !result.more) break;
    maxId = result.next;
    await sleep(between(pace.pageMin, pace.pageMax));
  }
  return { account, saved, collections: [], partial: true };
}

async function readInstagram(pace, emit) {
  const account = await ig("whoami");
  emit({ phase: "account", account });

  const saved = [];
  let maxId = null;
  for (let page = 0; page < 5_000; page++) {
    const result = await ig("savedPage", { maxId });
    saved.push(...result.items);
    emit({ phase: "saved", count: saved.length });
    if (!result.more) break;
    maxId = result.next;
    await sleep(between(pace.pageMin, pace.pageMax));
  }

  const collections = [];
  maxId = null;
  for (let page = 0; page < 200; page++) {
    const result = await ig("collectionsPage", { maxId });
    collections.push(...result.items);
    if (!result.more) break;
    maxId = result.next;
    await sleep(between(pace.pageMin, pace.pageMax));
  }

  // When saved posts carry their collection ids, membership is already
  // known. Otherwise read each collection.
  const haveIds = saved.length > 0 && saved.every((m) => Array.isArray(m.collectionIds));
  if (haveIds) {
    const byId = new Map(collections.map((c) => [c.id, { ...c, items: [] }]));
    for (const m of saved) for (const id of m.collectionIds) byId.get(id) && byId.get(id).items.push(m.code);
    emit({ phase: "collections", done: collections.length, total: collections.length });
    return { account, saved, collections: [...byId.values()] };
  }

  const inSaved = new Map(saved.map((m) => [m.code, m]));
  for (const m of saved) m.collectionIds = [];
  const filled = [];
  for (let i = 0; i < collections.length; i++) {
    const c = { ...collections[i], items: [] };
    maxId = null;
    for (let page = 0; page < 2_000; page++) {
      await sleep(between(pace.pageMin, pace.pageMax));
      const result = await ig("collectionPage", { id: c.id, maxId });
      for (const m of result.items) {
        c.items.push(m.code);
        const s = inSaved.get(m.code);
        if (s && !s.collectionIds.includes(c.id)) s.collectionIds.push(c.id);
      }
      if (!result.more) break;
      maxId = result.next;
    }
    filled.push(c);
    emit({ phase: "collections", done: i + 1, total: collections.length, name: c.name });
  }
  return { account, saved, collections: filled };
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

async function makeThumbs(items, emit) {
  const queue = items.filter((m) => m.image);
  let index = 0;
  let done = 0;
  let batch = [];
  const flush = () => {
    if (batch.length) emit({ phase: "thumbs", done, total: queue.length, items: batch });
    batch = [];
  };
  async function worker() {
    while (index < queue.length) {
      const m = queue[index++];
      try {
        batch.push({ code: m.code, data: await makeThumb(m.image) });
      } catch {
        // A missing cover just keeps the coloured tile.
      }
      done++;
      if (batch.length >= 60) flush();
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  flush();
  emit({ phase: "thumbs-done", done, total: queue.length });
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
      case "account":
        result = await ig("whoami");
        break;
      case "read": {
        const read = Array.isArray(payload.known)
          ? await readNewSaves(paceFor(pace), payload.known)
          : await readInstagram(paceFor(pace), (progress) => reply({ event: "progress", ...progress }));
        // Hand over the list now; cover images follow as progress events.
        reply({ ok: true, result: read });
        if (payload.thumbnails !== false) {
          await makeThumbs(read.saved, (progress) => reply({ event: "progress", ...progress }));
        }
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
    if (["pause", "resume", "cancel"].includes(message.type)) return setStatus(message.type);
    return null;
  };
  run().then(reply, () => reply(null));
  return true;
});
