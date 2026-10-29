import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { ImportError, parseExportFiles, readExport, savedFileKind } from "@/lib/import";
import { parseSavedCollectionsHtml, parseSavedPostsHtml } from "@/lib/import/export-html";
import { parseSavedCollectionsJson, parseSavedPostsJson } from "@/lib/import/export-json";
import { syntheticExport } from "@/lib/synthetic";

const POSTS = JSON.stringify({
  saved_saved_media: [
    { title: "chef.maria", string_map_data: { "Saved on": { href: "https://www.instagram.com/p/AAAAAAAAAAA/", timestamp: 1_700_000_300 } } },
    { title: "urbanframes", string_map_data: { "Saved on": { href: "https://www.instagram.com/reel/BBBBBBBBBBB/", timestamp: 1_700_000_200 } } },
    { title: "", string_map_data: { "Saved on": { href: "https://www.instagram.com/lisa.makes/p/CCCCCCCCCCC/", timestamp: 1_700_000_100 } } },
    { title: "broken", string_map_data: { "Saved on": { href: "https://www.instagram.com/lisa.makes/", timestamp: 1 } } },
  ],
});

const COLLECTIONS = JSON.stringify({
  saved_saved_collections: [
    { title: "Collection", string_map_data: { Name: { value: "Recipes ð\u009f\u008d\u009d" }, "Creation Time": { timestamp: 1_600_000_000 } } },
    { title: "chef.maria", string_map_data: { Name: { value: "chef.maria", href: "https://www.instagram.com/p/AAAAAAAAAAA/" }, "Added Time": { timestamp: 1_700_000_400 } } },
    { title: "Collection", string_map_data: { Name: { value: "CafÃ©s" }, "Creation Time": { timestamp: 1_600_000_100 } } },
    { title: "urbanframes", string_map_data: { Name: { value: "urbanframes", href: "https://www.instagram.com/reel/BBBBBBBBBBB/" } } },
    { title: "chef.maria", string_map_data: { Name: { value: "chef.maria", href: "https://www.instagram.com/p/AAAAAAAAAAA/" } } },
    { title: "only.here", string_map_data: { Name: { value: "only.here", href: "https://www.instagram.com/p/DDDDDDDDDDD/" } } },
    { title: "Collection", string_map_data: { Name: { value: "Empty" }, "Creation Time": { timestamp: 1_600_000_200 } } },
  ],
});

describe("saved_posts.json", () => {
  it("reads posts, authors and save times", () => {
    const { bookmarks, skipped } = parseSavedPostsJson(POSTS);
    expect(skipped).toBe(1);
    expect(bookmarks).toEqual([
      { id: "AAAAAAAAAAA", kind: "post", url: "https://www.instagram.com/p/AAAAAAAAAAA/", author: "chef.maria", savedAt: 1_700_000_300_000 },
      { id: "BBBBBBBBBBB", kind: "reel", url: "https://www.instagram.com/reel/BBBBBBBBBBB/", author: "urbanframes", savedAt: 1_700_000_200_000 },
      { id: "CCCCCCCCCCC", kind: "post", url: "https://www.instagram.com/p/CCCCCCCCCCC/", savedAt: 1_700_000_100_000 },
    ]);
  });

  it("reads the label_values layout", () => {
    const text = JSON.stringify([
      {
        label_values: [
          { label: "Username", value: "jo_travels" },
          { label: "URL", href: "https://www.instagram.com/p/EEEEEEEEEEE/" },
          { label: "Saved on", timestamp_value: 1_700_000_000 },
        ],
      },
    ]);
    expect(parseSavedPostsJson(text).bookmarks).toEqual([
      { id: "EEEEEEEEEEE", kind: "post", url: "https://www.instagram.com/p/EEEEEEEEEEE/", author: "jo_travels", savedAt: 1_700_000_000_000 },
    ]);
  });
});

describe("saved_collections.json", () => {
  it("groups posts under their collection header", () => {
    const { collections, bookmarks } = parseSavedCollectionsJson(COLLECTIONS);
    expect(collections).toEqual([
      { name: "Recipes 🍝", createdAt: 1_600_000_000_000, items: ["AAAAAAAAAAA"] },
      { name: "Cafés", createdAt: 1_600_000_100_000, items: ["BBBBBBBBBBB", "AAAAAAAAAAA", "DDDDDDDDDDD"] },
      { name: "Empty", createdAt: 1_600_000_200_000, items: [] },
    ]);
    expect(bookmarks.find((b) => b.id === "DDDDDDDDDDD")).toMatchObject({ author: "only.here" });
    // Added-to-collection time is not the save time.
    expect(bookmarks.every((b) => b.savedAt === undefined)).toBe(true);
  });

  it("reads collections that nest their posts", () => {
    const text = JSON.stringify({
      saved_saved_collections: [
        {
          title: "Travel",
          string_map_data: { "Creation Time": { timestamp: 1_600_000_000 } },
          media_list_data: [
            { href: "https://www.instagram.com/p/AAAAAAAAAAA/" },
            { href: "https://www.instagram.com/p/BBBBBBBBBBB/" },
          ],
        },
      ],
    });
    expect(parseSavedCollectionsJson(text).collections).toEqual([
      { name: "Travel", createdAt: 1_600_000_000_000, items: ["AAAAAAAAAAA", "BBBBBBBBBBB"] },
    ]);
  });
});

describe("parseExportFiles", () => {
  it("combines posts and collections, newest first", () => {
    const result = parseExportFiles([
      { name: "your_instagram_activity/saved/saved_posts.json", text: POSTS },
      { name: "your_instagram_activity/saved/saved_collections.json", text: COLLECTIONS },
      { name: "your_instagram_activity/likes/liked_posts.json", text: "{}" },
    ]);
    expect(result.bookmarks.map((b) => b.id)).toEqual(["AAAAAAAAAAA", "BBBBBBBBBBB", "CCCCCCCCCCC", "DDDDDDDDDDD"]);
    expect(result.collections.map((c) => c.name)).toEqual(["Recipes 🍝", "Cafés", "Empty"]);
    expect(result.skipped).toBe(1);
    expect(result.mergedDuplicates).toBe(0);
  });

  it("merges the same post saved under two links", () => {
    const text = JSON.stringify({
      saved_saved_media: [
        { title: "a.b", string_map_data: { "Saved on": { href: "https://www.instagram.com/p/AAAAAAAAAAA/", timestamp: 2 } } },
        { title: "a.b", string_map_data: { "Saved on": { href: "https://www.instagram.com/reel/AAAAAAAAAAA/", timestamp: 1 } } },
      ],
    });
    const result = parseExportFiles([{ name: "saved_posts.json", text }]);
    expect(result.bookmarks).toHaveLength(1);
    expect(result.bookmarks[0].kind).toBe("reel");
    expect(result.mergedDuplicates).toBe(1);
  });

  it("explains when there is nothing to import", () => {
    expect(() => parseExportFiles([{ name: "liked_posts.json", text: "{}" }])).toThrow(ImportError);
    expect(() => parseExportFiles([{ name: "saved_posts.json", text: "{nope" }])).toThrow(/Couldn't read saved_posts.json/);
  });

  it("recognises saved files by name", () => {
    expect(savedFileKind("a/b/saved_posts.json")).toBe("posts");
    expect(savedFileKind("saved_posts_1.html")).toBe("posts");
    expect(savedFileKind("saved_collections.json")).toBe("collections");
    expect(savedFileKind("saved_posts.jpg")).toBeNull();
  });

  it("round-trips a generated 2,000-post export", () => {
    const files = syntheticExport(2000, { collections: 6 });
    const result = parseExportFiles([
      { name: "saved_posts.json", text: files.posts },
      { name: "saved_collections.json", text: files.collections },
    ]);
    expect(result.bookmarks).toHaveLength(2000);
    expect(result.collections).toHaveLength(6);
  });
});

const POSTS_HTML = `<html><head><title>Saved posts</title><style>td{}</style></head><body>
<div class="pam"><h2>chef.maria</h2><table><tr><td>Saved on</td><td><a target="_blank" href="https://www.instagram.com/p/AAAAAAAAAAA/">https://www.instagram.com/p/AAAAAAAAAAA/</a><div>Nov 14, 2023 10:25 pm</div></td></tr></table></div>
<div class="pam"><h2>urbanframes</h2><table><tr><td>Saved on</td><td><a href="https://www.instagram.com/reel/BBBBBBBBBBB/">https://www.instagram.com/reel/BBBBBBBBBBB/</a><div>Nov 13, 2023 9:00 am</div></td></tr></table></div>
</body></html>`;

const COLLECTIONS_HTML = `<html><body>
<div><h2>Collection</h2><table><tr><td>Name</td><td>Caf&eacute; &amp; Bakes</td></tr><tr><td>Creation Time</td><td>Sep 13, 2020 12:26 pm</td></tr></table></div>
<div><h2>chef.maria</h2><table><tr><td>Name</td><td><a href="https://www.instagram.com/p/AAAAAAAAAAA/">chef.maria</a></td></tr><tr><td>Added Time</td><td>Nov 14, 2023 10:25 pm</td></tr></table></div>
<div><h2>Collection</h2><table><tr><td>Name</td><td>Travel</td></tr><tr><td>Creation Time</td><td>Sep 14, 2020 12:26 pm</td></tr></table></div>
<div><h2>urbanframes</h2><table><tr><td>Name</td><td><a href="https://www.instagram.com/reel/BBBBBBBBBBB/">urbanframes</a></td></tr></table></div>
<div><h2>Collection</h2><table><tr><td>Name</td><td>Empty one</td></tr><tr><td>Creation Time</td><td>Sep 15, 2020 12:26 pm</td></tr></table></div>
</body></html>`;

describe("HTML export", () => {
  it("reads saved posts", () => {
    const { bookmarks } = parseSavedPostsHtml(POSTS_HTML);
    expect(bookmarks.map((b) => [b.id, b.kind, b.author])).toEqual([
      ["AAAAAAAAAAA", "post", "chef.maria"],
      ["BBBBBBBBBBB", "reel", "urbanframes"],
    ]);
    expect(bookmarks[0].savedAt).toBe(new Date("2023-11-14T22:25:00").getTime());
  });

  it("reads collections", () => {
    const { collections } = parseSavedCollectionsHtml(COLLECTIONS_HTML);
    expect(collections).toEqual([
      { name: "Café & Bakes", items: ["AAAAAAAAAAA"] },
      { name: "Travel", items: ["BBBBBBBBBBB"] },
      { name: "Empty one", items: [] },
    ]);
  });
});

describe("readExport", () => {
  const files = {
    "instagram-me-2026-10-29/your_instagram_activity/saved/saved_posts.json": strToU8(POSTS),
    "instagram-me-2026-10-29/your_instagram_activity/saved/saved_collections.json": strToU8(COLLECTIONS),
    "instagram-me-2026-10-29/media/posts/202310/photo.jpg": new Uint8Array(50_000).fill(7),
  };

  it("reads only the saved files out of the zip", async () => {
    for (const level of [0, 6] as const) {
      const zip = new File([zipSync(files, { level }) as Uint8Array<ArrayBuffer>], "instagram-me-2026-10-29.zip");
      const result = await readExport([zip]);
      expect(result.bookmarks).toHaveLength(4);
      expect(result.collections).toHaveLength(3);
    }
  });

  it("reads loose JSON files", async () => {
    const result = await readExport([new File([POSTS], "saved_posts.json"), new File([COLLECTIONS], "renamed.json")]);
    expect(result.bookmarks).toHaveLength(4);
    expect(result.collections).toHaveLength(3);
  });

  it("rejects something that isn't a zip", async () => {
    await expect(readExport([new File(["hello"], "export.zip")])).rejects.toThrow(/isn't a zip/);
  });
});
