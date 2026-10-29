// Drives the real app in Chromium and times what users feel: importing,
// searching, sorting, dragging, scrolling and reopening the page.
//
//   npm run build && npm run bench:ui            (sizes default to 10000,50000)
//   SIZES=2000 SHOTS=./bench-results npm run bench:ui
//
// Needs Playwright with Chromium installed.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { zipSync, strToU8 } from "fflate";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const PORT = Number(process.env.PORT ?? 3123);
const BASE = `http://localhost:${PORT}`;
const SIZES = (process.env.SIZES ?? "10000,50000").split(",").map(Number);
const SHOTS = process.env.SHOTS;

function exportZip(size) {
  const handles = ["chef.maria", "dailyinteriors", "run_with_sam", "urbanframes", "lisa.makes", "tokyo_eats"];
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const posts = [];
  const seen = new Set();
  for (let i = 0; i < size; i++) {
    let code = "";
    while (code.length < 11 || seen.has(code)) code = code.length >= 11 ? "" : code + chars[Math.floor(rand() * 64)];
    seen.add(code);
    posts.push({
      title: handles[i % handles.length],
      string_map_data: { "Saved on": { href: `https://www.instagram.com/p/${code}/`, timestamp: 1_760_000_000 - i * 3600 } },
    });
  }
  const collections = ["Recipes", "Travel", "Home"].flatMap((name, c) => [
    { title: "Collection", string_map_data: { Name: { value: name }, "Creation Time": { timestamp: 1_600_000_000 } } },
    ...posts.filter((_, i) => i % 5 === c).map((p) => ({ title: p.title, string_map_data: { Name: { value: p.title, href: p.string_map_data["Saved on"].href } } })),
  ]);
  const media = new Uint8Array(2_000_000).fill(1); // stands in for the photos in a real export
  return Buffer.from(
    zipSync({
      "your_instagram_activity/saved/saved_posts.json": strToU8(JSON.stringify({ saved_saved_media: posts })),
      "your_instagram_activity/saved/saved_collections.json": strToU8(JSON.stringify({ saved_saved_collections: collections })),
      "media/posts/202501/a.jpg": [media, { level: 0 }],
    }),
  );
}

async function timed(fn) {
  const start = performance.now();
  await fn();
  return Math.round(performance.now() - start);
}

async function frameStats(page, action) {
  return page.evaluate(async (action) => {
    const list = document.querySelector("[data-testid=bookmark-list]");
    const frames = [];
    let last = performance.now();
    let running = true;
    const loop = (t) => {
      frames.push(t - last);
      last = t;
      if (running) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    if (action === "scroll") {
      for (let i = 0; i < 90; i++) {
        list.scrollTop += 900;
        await new Promise((r) => requestAnimationFrame(r));
      }
    }
    running = false;
    frames.shift();
    frames.sort((a, b) => a - b);
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
    return { avgMs: Math.round(avg * 10) / 10, p95Ms: Math.round(frames[Math.floor(frames.length * 0.95)] * 10) / 10, frames: frames.length };
  }, action);
}

async function waitForCount(page, testId, pattern) {
  await page.waitForFunction(
    ([id, source]) => new RegExp(source).test(document.querySelector(`[data-testid=${id}]`)?.textContent ?? ""),
    [testId, pattern.source],
    { polling: "raf", timeout: 60_000 },
  );
}

async function firstRowId(page) {
  return page.locator("[role=listitem]").first().getAttribute("data-id");
}

async function run() {
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], { stdio: "ignore", detached: true });
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(BASE)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    const browser = await chromium.launch();
    if (SHOTS) mkdirSync(SHOTS, { recursive: true });
    const results = {};

    for (const size of SIZES) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(BASE);
      const r = {};
      const label = size.toLocaleString("en");

      const zip = exportZip(size);
      await page.getByRole("button", { name: "Import from Instagram" }).click();
      r.importZipMs = await timed(async () => {
        await page.getByTestId("import-input").setInputFiles({ name: "instagram-export.zip", mimeType: "application/zip", buffer: zip });
        await page.getByText(/Added .* bookmarks?\./).waitFor({ timeout: 120_000 });
      });
      await page.getByRole("button", { name: "Done" }).click();
      await waitForCount(page, "view-count", new RegExp(`^${label} bookmarks`));
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${size}-library.png` });

      const search = page.getByRole("searchbox", { name: "Search bookmarks" });
      r.searchMs = await timed(async () => {
        await search.fill("chef");
        await waitForCount(page, "view-count", / of .* match/);
      });
      r.searchNoMatchMs = await timed(async () => {
        await search.fill("zzzz-nothing");
        await waitForCount(page, "view-count", /^0 of/);
      });
      await search.fill("");
      await waitForCount(page, "view-count", new RegExp(`^${label} bookmarks`));

      const before = await firstRowId(page);
      r.sortAzMs = await timed(async () => {
        await page.getByRole("combobox", { name: "Sort" }).selectOption("az");
        await page.waitForFunction((b) => document.querySelector("[role=listitem]")?.getAttribute("data-id") !== b, before, { polling: "raf" });
      });
      r.sortNewestMs = await timed(async () => {
        await page.getByRole("combobox", { name: "Sort" }).selectOption("newest");
        await page.waitForFunction((b) => document.querySelector("[role=listitem]")?.getAttribute("data-id") === b, before, { polling: "raf" });
      });
      await page.getByRole("combobox", { name: "Sort" }).selectOption("custom");

      // Drag the first bookmark down three rows.
      const firstId = await page.locator("[role=listitem]").first().getAttribute("data-id");
      const handle = page.locator(`[data-id="${firstId}"] button`).first();
      const box = await handle.boundingBox();
      r.dragMs = await timed(async () => {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2, box.y + 64 * 3.5, { steps: 8 });
        await page.mouse.up();
        await page.waitForFunction((id) => document.querySelector("[role=listitem]")?.getAttribute("data-id") !== id, firstId, { polling: "raf" });
      });
      const newIndex = await page.evaluate((id) => {
        const rows = [...document.querySelectorAll("[role=listitem]")].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top));
        return rows.findIndex((row) => row.getAttribute("data-id") === id);
      }, firstId);
      r.dragLandedAtRow = newIndex;

      r.scroll = await frameStats(page, "scroll");
      await page.evaluate(() => {
        document.querySelector("[data-testid=bookmark-list]").scrollTop = 0;
      });
      await page.waitForFunction(() => document.querySelector("[role=listitem]")?.style.top === "0px", null, { polling: "raf" });

      // Rename the first row.
      r.renameMs = await timed(async () => {
        await page.locator("[role=listitem]").first().getByRole("button", { name: /^Rename/ }).click();
        await page.locator("[role=listitem] input:not([type=checkbox])").fill("My renamed bookmark");
        await page.keyboard.press("Enter");
        await page.getByText("My renamed bookmark").waitFor();
      });

      // Select 10 rows with shift-click and file them into a new collection.
      await page.locator("[role=listitem]").nth(0).click();
      await page.locator("[role=listitem]").nth(9).click({ modifiers: ["Shift"] });
      r.fileSelectionMs = await timed(async () => {
        await page.getByRole("button", { name: /Add to collection/ }).click();
        await page.getByPlaceholder("New collection…").fill("Benchmark picks");
        await page.keyboard.press("Enter");
        await page.getByTestId("count-Benchmark picks").waitFor();
      });
      r.newCollectionCount = Number(await page.getByTestId("count-Benchmark picks").textContent());

      // Saving is debounced; give it a moment, then time a cold reopen.
      await page.waitForTimeout(1500);
      r.reopenMs = await timed(async () => {
        await page.reload();
        await waitForCount(page, "view-count", new RegExp(`^${label} bookmarks`));
      });
      r.renameSurvivedReload = await page.getByText("My renamed bookmark").isVisible();
      r.heapMB = Math.round((await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0)) / 1e6);

      if (SHOTS) {
        await page.getByRole("button", { name: /Possible duplicates/ }).click();
        await page.screenshot({ path: `${SHOTS}/${size}-duplicates.png` });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole("button", { name: "Open collections" }).click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${SHOTS}/${size}-mobile-drawer.png` });
        await page.getByRole("button", { name: /All bookmarks/ }).click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${SHOTS}/${size}-mobile.png` });
      }
      r.pageErrors = errors;
      results[label] = r;
      await context.close();
    }
    await browser.close();
    console.log(JSON.stringify(results, null, 2));
  } finally {
    // npx starts next in a child process; stop the whole group.
    process.kill(-server.pid);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
