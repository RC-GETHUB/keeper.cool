// End-to-end test of the extension against a fake Instagram.
// Loads extension/ into Chromium, serves instagram.com from an in-memory
// mock, and checks import (posts, collections, cover images) and push
// (the order on "Instagram" ends up matching Keeper, collections intact).
//
//   npm run build && node scripts/extension-e2e.mjs
//
// Needs Playwright with Chromium. Keeper must run on localhost:3000, the
// only origin where the extension accepts its quick test pace.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = new URL("..", import.meta.url).pathname;
const EXTENSION = join(ROOT, "extension");
const KEEPER = "http://localhost:3000";
const USER_ID = "4242";
const OTHER_ID = "5151";

// ---------------------------------------------------------------- Fake Instagram

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function code(n) {
  let s = "";
  for (let i = 0; i < 11; i++) s += ALPHABET[(n * 7 + i * 13) % 64];
  return s;
}

const posts = Array.from({ length: 45 }, (_, i) => ({
  code: code(i),
  // Bigger than Number.MAX_SAFE_INTEGER, written unquoted like Instagram does.
  pk: (3456789012345678000n + BigInt(i)).toString(),
  author: ["chef.maria", "urbanframes", "lisa.makes"][i % 3],
  caption: `Post number ${i} with a caption long enough to show two lines in the list ${i % 2 ? "tacos" : "sunset"}`,
  reel: i % 4 === 0,
}));
const mainPosts = [...posts];

// A second Instagram account with its own saves.
const otherPosts = Array.from({ length: 5 }, (_, i) => ({
  code: `OTHER${i}xxxxx`.slice(0, 11),
  pk: (3456789012345679000n + BigInt(i)).toString(),
  author: "jo_travels",
  caption: `Second account post ${i}`,
  reel: false,
}));
posts.push(...otherPosts);
const byPk = new Map(posts.map((p) => [p.pk, p]));
for (const p of otherPosts) p.collectionIds = [];
otherPosts[0].collectionIds = ["17900000000000009"];
otherPosts[2].collectionIds = ["17900000000000009"];
const second = {
  username: "second.account",
  saved: otherPosts.map((p) => p.code),
  collections: new Map([["17900000000000009", { name: "Road Trips", items: [otherPosts[0].code, otherPosts[2].code] }]]),
};
const ig = {
  username: "test.account",
  failOnce: true,
  busyOnce: true,
  saved: mainPosts.map((p) => p.code), // newest first
  collections: new Map([
    ["17900000000000001", { name: "Recipes", items: mainPosts.filter((_, i) => i % 3 === 0).map((p) => p.code) }],
    ["17900000000000002", { name: "Travel", items: mainPosts.filter((_, i) => i % 5 === 0).map((p) => p.code) }],
    ["17900000000000003", { name: "Broken", items: [] }],
  ]),
  calls: [],
};

function mediaJson(c) {
  const p = posts.find((x) => x.code === c);
  // The second account's posts carry their collection ids, as Ryan's do.
  const ids = p.collectionIds ? `"saved_collection_ids":[${p.collectionIds.map((id) => `"${id}"`).join(",")}],` : "";
  return `{${ids}"pk":${p.pk},"id":"${p.pk}_999","code":"${p.code}","product_type":"${p.reel ? "clips" : "feed"}","user":{"username":"${p.author}"},"caption":{"text":"${p.caption}"},"image_versions2":{"candidates":[{"width":640,"height":800,"url":"https://scontent.cdninstagram.com/v/${p.code}_big.jpg"},{"width":320,"height":400,"url":"https://scontent.cdninstagram.com/v/${p.code}.jpg"}]}}`;
}

function page(list, maxId, size) {
  const start = maxId ? Number(maxId) : 0;
  const items = list.slice(start, start + size);
  const more = start + size < list.length;
  return `{"items":[${items.map((c) => `{"media":${mediaJson(c)}}`).join(",")}],"more_available":${more},"next_max_id":${more ? `"${start + size}"` : "null"},"status":"ok"}`;
}

// A tiny red PNG for every cover image.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC",
  "base64",
);

async function mockInstagram(context) {
  await context.route("https://scontent.cdninstagram.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG, headers: { "access-control-allow-origin": "*" } }),
  );
  await context.route("https://www.instagram.com/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body });
    // Its Saved page shows its collections as links, drawn a moment after loading.
    if (path === `/${second.username}/saved/`) {
      const links = [...second.collections]
        .map(([id, c]) => `<a href="/${second.username}/saved/${c.name.toLowerCase().replace(/ /g, "-")}/${id}/"><span>${c.name}</span></a>`)
        .join("");
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<html><body><a href="/${second.username}/saved/all-posts/">All posts</a><div id="c"></div><script>setTimeout(()=>{document.getElementById("c").innerHTML=${JSON.stringify(links)}},700)</script></body></html>`,
      });
    }
    if (!path.startsWith("/api/")) return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>Fake Instagram</body></html>" });
    if (request.method() === "POST" && request.headers()["x-csrftoken"] !== "csrf-test") return route.fulfill({ status: 403, body: "CSRF" });
    ig.calls.push(`${request.method()} ${path}${url.search}`);
    // Whoever is logged in (by cookie) gets their own saves.
    const uid = /ds_user_id=(\d+)/.exec((await request.allHeaders()).cookie ?? "")?.[1];
    const acct = uid === OTHER_ID ? second : ig;

    const info = path.match(/^\/api\/v1\/users\/(\d+)\/info\/$/);
    // Like Ryan's account, the second one gets no username from Instagram at all.
    if (info && info[1] === OTHER_ID) return route.fulfill({ status: 404, contentType: "text/html", body: "<!DOCTYPE html><html>Page not found</html>" });
    if (info) return json(`{"user":{"username":"${ig.username}"},"status":"ok"}`);

    // The first time, fail part-way through the saved list, like Instagram dropping a session.
    // And once, Instagram's own "572" (busy): Keeper should wait and retry by itself.
    if (path === "/api/v1/feed/saved/posts/" && url.searchParams.get("max_id") === "40" && ig.busyOnce) {
      ig.busyOnce = false;
      return route.fulfill({ status: 572, contentType: "text/plain", body: "572" });
    }
    if (path === "/api/v1/feed/saved/posts/" && url.searchParams.get("max_id") === "20" && ig.failOnce) {
      ig.failOnce = false;
      return route.fulfill({ status: 401, contentType: "application/json", body: '{"message":"login_required","status":"fail"}' });
    }
    // SHOT=path: slow the saved list down and screenshot the progress part-way.
    if ((process.env.SHOT || (process.env.SHOT2 && acct === second && second.slow)) && path === "/api/v1/feed/saved/posts/") {
      await new Promise((r) => setTimeout(r, 1200));
    }
    if (path === "/api/v1/feed/saved/posts/") return json(page(acct.saved, url.searchParams.get("max_id"), 20));
    // The second account doesn't get the collection list at all, like Ryan's real one.
    if (path === "/api/v1/collections/list/" && acct === second) {
      return route.fulfill({ status: 404, contentType: "text/html", body: "<!DOCTYPE html><html>Page not found</html>" });
    }
    if (path === "/api/v1/collections/list/") {
      const items = [
        `{"collection_id":"ALL_MEDIA_AUTO_COLLECTION","collection_name":"All posts","collection_type":"ALL_MEDIA_AUTO_COLLECTION","collection_media_count":${acct.saved.length}}`,
        ...[...acct.collections].map(([id, c]) => `{"collection_id":${id},"collection_name":"${c.name}","collection_type":"MEDIA"}`),
      ];
      return json(`{"items":[${items.join(",")}],"more_available":false,"next_max_id":null,"status":"ok"}`);
    }
    // A collection Instagram won't open at either address.
    if (path.startsWith("/api/v1/feed/collection/17900000000000003/")) {
      return route.fulfill({ status: 404, contentType: "text/html", body: "<!DOCTYPE html><html><style>:root{--fds-black:#000}</style>Page not found</html>" });
    }
    let m = path.match(/^\/api\/v1\/feed\/collection\/(\d+)\/posts\/$/);
    if (m) return json(page(acct.collections.get(m[1]).items, url.searchParams.get("max_id"), 20));
    m = path.match(/^\/api\/v1\/web\/save\/(\d+)\/(save|unsave)\/$/);
    if (m) {
      const p = byPk.get(m[1]);
      if (!p) return route.fulfill({ status: 404, contentType: "application/json", body: '{"message":"Media not found","status":"fail"}' });
      acct.saved = acct.saved.filter((c) => c !== p.code);
      if (m[2] === "save") acct.saved.unshift(p.code);
      else for (const c of acct.collections.values()) c.items = c.items.filter((x) => x !== p.code);
      return json('{"status":"ok"}');
    }
    m = path.match(/^\/api\/v1\/collections\/(\d+)\/edit\/$/);
    if (m) {
      const added = JSON.parse(new URLSearchParams(request.postData()).get("added_media_ids"));
      const c = acct.collections.get(m[1]);
      for (const pk of added) {
        const p = byPk.get(pk);
        c.items = [p.code, ...c.items.filter((x) => x !== p.code)];
      }
      return json('{"status":"ok"}');
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: '{"status":"fail","message":"unknown"}' });
  });
}

// ---------------------------------------------------------------- Test

function check(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function run() {
  const server = spawn("npx", ["next", "start", "-p", "3000"], { cwd: ROOT, stdio: "ignore", detached: true });
  const profile = mkdtempSync(join(tmpdir(), "keeper-e2e-"));
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(KEEPER)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
      viewport: { width: 1280, height: 900 },
    });
    // Start logged out of Instagram; the test logs in through Keeper's pop-up.
    const logIn = (userId = USER_ID) =>
      context.addCookies([
        { name: "ds_user_id", value: userId, domain: ".instagram.com", path: "/", secure: true },
        { name: "csrftoken", value: "csrf-test", domain: ".instagram.com", path: "/", secure: true },
      ]);
    await mockInstagram(context);
    if (!context.serviceWorkers().length) await context.waitForEvent("serviceworker");
    console.log("Extension loaded.");

    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(KEEPER);
    await page.evaluate(() => localStorage.setItem("keeper:test-pace", "1"));
    await page.reload();

    console.log("Import:");
    // On the welcome screen the button starts the import straight away.
    await page.getByRole("button", { name: "Import from Instagram" }).click();
    await page.getByRole("button", { name: "Log in to Instagram" }).waitFor({ timeout: 30_000 });
    check(true, "asks to log in to Instagram when logged out");
    const [popup] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: "Log in to Instagram" }).click()]);
    check(popup.url().startsWith("https://www.instagram.com/accounts/login"), "opens Instagram's own login page in a pop-up");
    await logIn();
    if (process.env.SHOT) {
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: "Log in to Instagram" }).click().catch(() => {});
      await page.getByTestId("import-count").waitFor();
      await page.waitForTimeout(2000);
      await page.getByRole("dialog").screenshot({ path: process.env.SHOT });
      console.log("screenshot saved");
      process.exit(0);
    }
    // Instagram drops the session part-way: Keeper asks again, then carries on from where it stopped.
    await page.getByText(/Instagram said: 401 login_required/).waitFor({ timeout: 60_000 });
    check(true, "shows what Instagram said when it stops part-way");
    const savedCallsBefore = ig.calls.filter((c) => c.includes("/feed/saved/posts/")).length;
    await page.getByRole("button", { name: "Log in to Instagram" }).click();
    await page.getByText(/Added 45 bookmarks/).waitFor({ timeout: 60_000 }).catch(async (e) => {
      console.log("DIALOG:", await page.getByRole("dialog").innerText().catch(() => "none"));
      console.log("ERRORS:", errors);
      console.log("CALLS:", ig.calls.slice(-5));
      throw e;
    });
    check(true, "45 saved posts imported, with nothing doubled after the retry");
    const retry = ig.calls.filter((c) => c.includes("/feed/saved/posts/")).slice(savedCallsBefore);
    check(retry[0]?.endsWith("max_id=20"), "the retry picked up where it stopped instead of starting over");
    check(retry.filter((c) => c.endsWith("max_id=40")).length === 2 && !ig.busyOnce, "a 572 from Instagram was retried automatically");
    check(await page.getByText("45 saved posts on Instagram (@test.account)").isVisible(), "shows which account it read");
    await page.getByText(/Cover images added \(45\)/).waitFor({ timeout: 60_000 });
    check(true, "45 cover images made");
    check(await page.getByText(/Instagram wouldn't open the collection “Broken”/).isVisible(), "a collection Instagram won't open is skipped and named, not fatal");
    await page.getByRole("button", { name: "Done" }).click();
    check((await page.getByTestId("count-New").count()) === 0, "nothing is marked New after a first import that had to resume");
    check((await page.getByTestId("count-Recipes").textContent()) === "15", "Recipes has its 15 posts");
    check((await page.getByTestId("count-Travel").textContent()) === "9", "Travel has its 9 posts");
    const src = await page.locator("[role=listitem] img").first().getAttribute("src");
    check(src?.startsWith("data:image/jpeg;base64,"), "rows show stored cover images");
    check(await page.getByText(/Post number 0 with a caption/).first().isVisible(), "rows show the caption");
    const firstRows = await page.evaluate(() =>
      [...document.querySelectorAll("[role=listitem]")].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)).map((r) => r.dataset.id),
    );
    check(JSON.stringify(firstRows.slice(0, 5)) === JSON.stringify(mainPosts.slice(0, 5).map((p) => p.code)), "the resumed import kept Instagram's order");

    console.log("Push a small change:");
    // Move the bottom post to the top.
    const rows = page.locator("[role=list]");
    await rows.evaluate((el) => (el.parentElement.scrollTop = 1e6));
    const last = posts[44].code;
    await page.locator(`[data-id="${last}"] input[type=checkbox]`).check();
    await page.getByRole("button", { name: "Top", exact: true }).click();
    await page.getByRole("button", { name: "Sync to Instagram" }).click();
    await page.getByRole("checkbox", { name: /I understand/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("posts will move on Instagram").waitFor();
    check((await page.locator("p.text-2xl").textContent()) === "1", "plan re-saves just the 1 moved post");
    const before = ig.calls.length;
    await page.getByRole("button", { name: "Start sync" }).click();
    await page.getByText("Finished").waitFor({ timeout: 30_000 }).catch(async () => {
      await page.getByRole("button", { name: /Syncing/ }).click();
      await page.getByText("Finished").waitFor({ timeout: 30_000 });
    });
    check(ig.saved[0] === last, "the moved post is now first on Instagram");
    const writes = ig.calls.slice(before).filter((c) => c.startsWith("POST"));
    check(writes.length === 2 + (44 % 3 === 0 ? 1 : 0) + (44 % 5 === 0 ? 1 : 0), `only ${writes.length} Instagram actions used`);
    await page.getByRole("dialog").getByText("Close", { exact: true }).click();

    console.log("Push a full A–Z re-sort:");
    // Picking a sort arranges the list right away.
    await page.getByRole("combobox", { name: "Sort", exact: true }).selectOption("az");
    const order = await page.evaluate(async () => {
      const ids = [...document.querySelectorAll("[role=listitem]")]
        .sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
        .map((r) => r.getAttribute("data-id"));
      return ids;
    });
    await page.getByRole("button", { name: "Sync to Instagram" }).click();
    await page.getByRole("checkbox", { name: /I understand/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("posts will move on Instagram").waitFor();
    await page.getByRole("button", { name: "Start sync" }).click();
    await page.getByText("Finished").waitFor({ timeout: 120_000 });
    check(
      JSON.stringify(ig.saved.slice(0, order.length)) === JSON.stringify(order),
      `Instagram's first ${order.length} saves now match Keeper's A–Z order`,
    );
    const recipes = mainPosts.filter((_, i) => i % 3 === 0).map((p) => p.code).sort();
    check(
      JSON.stringify([...ig.collections.get("17900000000000001").items].sort()) === JSON.stringify(recipes),
      "Recipes still has exactly its posts after re-saving",
    );
    await page.getByRole("dialog").getByText("Close", { exact: true }).click();

    console.log("New saves arrive on their own:");
    const fresh = { code: "NEWPOSTxxxx", pk: "3456789012345678999", author: "jo_travels", caption: "Saved just now", reel: false };
    posts.push(fresh);
    byPk.set(fresh.pk, fresh);
    ig.saved.unshift(fresh.code);
    await page.reload();
    await page.getByText("1 new save from Instagram").waitFor({ timeout: 30_000 });
    check(true, "a post saved on Instagram appears after reopening Keeper");
    check((await page.locator("[role=listitem]").first().getAttribute("data-id")) === fresh.code, "it lands on top");
    check(await page.getByText("46 bookmarks").first().isVisible(), "total is now 46");

    console.log("A second Instagram account:");
    await context.clearCookies();
    await logIn(OTHER_ID);
    // Its Saved page is open in a tab (a tab the extension opened itself would load the real Instagram).
    const savedTab = await context.newPage();
    await savedTab.goto(`https://www.instagram.com/${second.username}/saved/`);
    await page.bringToFront();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Import from Instagram" }).click();
    await page.getByRole("button", { name: "New library for this account" }).click({ timeout: 30_000 });
    await page.getByText(/Added 5 bookmarks/).waitFor({ timeout: 30_000 });
    check(true, "imports another account into its own library, after asking");
    // Instagram never said the username, so Keeper asks for it to read the collections.
    await page.getByLabel("What's your Instagram username?").fill("@second.account");
    await page.getByRole("button", { name: "Get collections" }).click();
    await page.getByText("Added 1 collection.").waitFor({ timeout: 60_000 });
    check(true, "asks for the username when Instagram won't say it, then gets the collections in seconds");
    await page.getByRole("button", { name: "Done" }).click();
    check((await page.getByTestId("account-menu").textContent()).includes("@second.account"), "the header shows which account is open");
    check((await page.locator("[role=listitem]").count()) === 5, "the new library has only that account's 5 saves");
    check((await page.getByTestId("count-Road Trips").textContent()) === "2", "collections read off the Saved page when Instagram won't list them");
    if (process.env.SHOT2) {
      // Import this account again, slowly, to see "of about N" and the collection count.
      second.slow = true;
      await page.getByRole("button", { name: "Import", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Import from Instagram" }).click();
      await page.getByTestId("import-count").waitFor();
      await page.waitForTimeout(1500);
      await page.getByRole("dialog").screenshot({ path: process.env.SHOT2 });
      console.log("screenshot saved:", await page.getByTestId("import-count").innerText());
      process.exit(0);
    }

    const copied = [otherPosts[0].code, otherPosts[1].code];
    for (const c of copied) await page.locator(`[data-id="${c}"] input[type=checkbox]`).check();
    await page.getByRole("button", { name: /Copy to/ }).click();
    await page.getByRole("button", { name: /@test\.account/ }).click();
    await page.getByText(/Copied 2 bookmarks to @test\.account/).waitFor();
    check(true, "copies selected bookmarks to the other account's library");

    await page.getByTestId("account-menu").click();
    await page.getByRole("button", { name: /@test\.account/ }).click();
    await page.getByText("Switched to @test.account").waitFor();
    const top = await page.evaluate(() =>
      [...document.querySelectorAll("[role=listitem]")].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)).slice(0, 2).map((r) => r.dataset.id),
    );
    check(JSON.stringify(top) === JSON.stringify(copied), "the copies sit on top of @test.account's library");

    await context.clearCookies();
    await logIn(USER_ID);
    await page.getByRole("button", { name: "Sync to Instagram" }).click();
    await page.getByRole("checkbox", { name: /I understand/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText(/2 new to this account/).waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Start sync" }).click();
    await page.getByText("Finished").waitFor({ timeout: 60_000 });
    if (!copied.every((c) => ig.saved.includes(c))) {
      console.log("CALLS:", ig.calls.slice(-8), "TOP:", ig.saved.slice(0, 3), "DIALOG:", await page.getByRole("dialog").innerText());
    }
    check(copied.every((c) => ig.saved.includes(c)), "Sync saved the copied posts on @test.account's Instagram");
    check(!second.saved.some((c) => !otherPosts.some((p) => p.code === c)), "the second account wasn't touched");
    await page.getByRole("dialog").getByText("Close", { exact: true }).click();

    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
    await context.close();
    console.log("All extension checks passed.");
  } finally {
    process.kill(-server.pid);
    rmSync(profile, { recursive: true, force: true });
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
