import { describe, expect, it } from "vitest";
import { findDuplicates, reasonsFor } from "@/lib/library/duplicates";
import {
  addToCollection,
  applyOrder,
  createCollection,
  deleteCollection,
  emptyLibrary,
  mergeImport,
  moveCollection,
  moveItems,
  removeBookmarks,
  removeFromCollection,
  renameBookmark,
  renameCollection,
} from "@/lib/library/ops";
import { countLibrary, displayName, viewIds } from "@/lib/library/query";
import type { Bookmark, ImportResult } from "@/lib/types";

function bm(id: string, extra: Partial<Bookmark> = {}): Bookmark {
  return { id, kind: "post", url: `https://www.instagram.com/p/${id}/`, ...extra };
}

function result(bookmarks: Bookmark[], collections: ImportResult["collections"] = []): ImportResult {
  return { bookmarks, collections, mergedDuplicates: 0, skipped: 0, warnings: [] };
}

const first = result(
  [
    bm("a", { author: "zed", savedAt: 3000 }),
    bm("b", { author: "anna", savedAt: 2000, caption: "Crispy tacos 🌮\nrecipe below" }),
    bm("c", { author: "Émile", savedAt: 1000, caption: "Café crawl in Paris" }),
  ],
  [{ name: "Food", items: ["b", "c"] }],
);

const lib = () => mergeImport(emptyLibrary(), first).library;

describe("mergeImport", () => {
  it("builds a library in Instagram's order", () => {
    const { library, summary } = mergeImport(emptyLibrary(), first);
    expect(library.order).toEqual(["a", "b", "c"]);
    expect(library.collections).toMatchObject([{ name: "Food", instagramName: "Food", items: ["b", "c"] }]);
    expect(summary).toEqual({ added: 3, updated: 0, collectionsAdded: 1 });
  });

  it("puts new saves on top and keeps the user's work", () => {
    let library = renameBookmark(lib(), "c", "Paris list");
    library = moveItems(library, null, ["c"], 0);
    library = renameCollection(library, library.collections[0].id, "Eats");
    const second = result(
      [bm("d", { savedAt: 4000 }), bm("a", { savedAt: 3000, caption: "now with caption" }), bm("b"), bm("c")],
      [{ name: "Food", items: ["d", "b", "c"] }, { name: "New", items: ["a"] }],
    );
    const { library: merged, summary } = mergeImport(library, second);
    expect(merged.order).toEqual(["d", "c", "a", "b"]);
    expect(merged.bookmarks.c.title).toBe("Paris list");
    expect(merged.bookmarks.a.caption).toBe("now with caption");
    // Matched by its Instagram name even though it was renamed here.
    expect(merged.collections.map((c) => [c.name, c.items])).toEqual([
      ["Eats", ["d", "b", "c"]],
      ["New", ["a"]],
    ]);
    expect(summary).toEqual({ added: 1, updated: 1, collectionsAdded: 1 });
  });
});

describe("editing", () => {
  it("renames and un-renames a bookmark", () => {
    const renamed = renameBookmark(lib(), "a", "  Best one ");
    expect(displayName(renamed.bookmarks.a)).toBe("Best one");
    expect(displayName(renameBookmark(renamed, "a", "").bookmarks.a)).toBe("@zed");
  });

  it("names bookmarks from their caption's first line", () => {
    expect(displayName(lib().bookmarks.b)).toBe("Crispy tacos 🌮");
  });

  it("creates, fills, renames, reorders and deletes collections", () => {
    let { library, id } = createCollection(lib(), "Trips");
    library = addToCollection(library, id, ["a", "c", "a", "missing"]);
    expect(library.collections[1].items).toEqual(["a", "c"]);
    library = addToCollection(library, id, ["b", "c"]);
    expect(library.collections[1].items).toEqual(["b", "a", "c"]);
    library = removeFromCollection(library, id, ["a"]);
    expect(library.collections[1].items).toEqual(["b", "c"]);
    library = moveCollection(library, id, 0);
    expect(library.collections.map((c) => c.name)).toEqual(["Trips", "Food"]);
    library = deleteCollection(library, id);
    expect(library.collections.map((c) => c.name)).toEqual(["Food"]);
    expect(library.order).toHaveLength(3);
  });

  it("refuses empty and clashing collection names", () => {
    expect(() => createCollection(lib(), "  ")).toThrow(/name/);
    expect(() => createCollection(lib(), "food")).toThrow(/already have/);
    const library = lib();
    expect(renameCollection(library, library.collections[0].id, "FOOD").collections[0].name).toBe("FOOD");
  });

  it("moves a group of bookmarks together", () => {
    let library = mergeImport(emptyLibrary(), result(["a", "b", "c", "d", "e"].map((id) => bm(id)))).library;
    library = moveItems(library, null, ["d", "b"], 0);
    expect(library.order).toEqual(["b", "d", "a", "c", "e"]);
    library = moveItems(library, null, ["b"], 99);
    expect(library.order).toEqual(["d", "a", "c", "e", "b"]);
  });

  it("saves a sorted view as the order, leaving hidden items in place", () => {
    let library = mergeImport(emptyLibrary(), result(["a", "b", "c", "d"].map((id) => bm(id)))).library;
    library = applyOrder(library, null, ["d", "b"]);
    expect(library.order).toEqual(["a", "d", "c", "b"]);
  });

  it("removes bookmarks everywhere", () => {
    const library = removeBookmarks(lib(), ["b"]);
    expect(library.order).toEqual(["a", "c"]);
    expect(library.bookmarks.b).toBeUndefined();
    expect(library.collections[0].items).toEqual(["c"]);
  });

  it("does not mutate the previous library", () => {
    const before = lib();
    const snapshot = JSON.stringify(before);
    moveItems(renameBookmark(addToCollection(before, before.collections[0].id, ["a"]), "a", "x"), null, ["a"], 2);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("viewing", () => {
  it("sorts A–Z by name, ignoring @ and accents", () => {
    const library = renameBookmark(lib(), "a", "zebra stripes");
    expect(viewIds(library, { scope: { type: "all" }, sort: "az", query: "" })).toEqual(["c", "b", "a"]);
    expect(viewIds(library, { scope: { type: "all" }, sort: "za", query: "" })).toEqual(["a", "b", "c"]);
  });

  it("sorts by save date", () => {
    expect(viewIds(lib(), { scope: { type: "all" }, sort: "oldest", query: "" })).toEqual(["c", "b", "a"]);
  });

  it("searches names, captions and authors, accent-insensitively", () => {
    const all = { scope: { type: "all" } as const, sort: "custom" as const };
    expect(viewIds(lib(), { ...all, query: "cafe" })).toEqual(["c"]);
    expect(viewIds(lib(), { ...all, query: "EMILE paris" })).toEqual(["c"]);
    expect(viewIds(lib(), { ...all, query: "@anna" })).toEqual(["b"]);
    expect(viewIds(lib(), { ...all, query: "tacos paris" })).toEqual([]);
    expect(viewIds(renameBookmark(lib(), "a", "Favourite"), { ...all, query: "favou" })).toEqual(["a"]);
  });

  it("shows a collection and what isn't in any collection", () => {
    const library = lib();
    expect(viewIds(library, { scope: { type: "collection", id: library.collections[0].id }, sort: "custom", query: "" })).toEqual(["b", "c"]);
    expect(viewIds(library, { scope: { type: "unfiled" }, sort: "custom", query: "" })).toEqual(["a"]);
  });

  it("counts everything", () => {
    const library = lib();
    expect(countLibrary(library)).toEqual({ total: 3, unfiled: 1, collections: { [library.collections[0].id]: 2 } });
  });
});

describe("findDuplicates", () => {
  it("flags posts in several collections and look-alike posts", () => {
    const caption = "The BEST crispy tacos recipe you will ever make #tacos";
    let library = mergeImport(
      emptyLibrary(),
      result(
        [
          bm("a", { caption }),
          bm("b", { caption: "the best crispy tacos recipe you will ever make!! #food @chef" }),
          bm("c", { caption: "ok" }),
          bm("d", { caption: "ok" }),
          bm("e", { thumbnailUrl: "https://cdn/x.jpg?sig=1" }),
          bm("f", { thumbnailUrl: "https://cdn/x.jpg?sig=2" }),
        ],
        [
          { name: "One", items: ["c"] },
          { name: "Two", items: ["c", "a"] },
        ],
      ),
    ).library;
    let report = findDuplicates(library);
    expect([...report.inCollections.keys()]).toEqual(["c"]);
    expect(report.lookalikes).toEqual([["a", "b"], ["e", "f"]]);
    expect(reasonsFor(report, "a")).toEqual(["lookalike"]);
    expect(reasonsFor(report, "c")).toEqual(["collections"]);
    expect(report.flagged.has("d")).toBe(false);
    expect(viewIds(library, { scope: { type: "duplicates" }, sort: "custom", query: "", duplicates: report })).toEqual(["a", "b", "e", "f", "c"]);

    library = removeBookmarks(library, ["b"]);
    report = findDuplicates(library);
    expect(report.lookalikes).toEqual([["e", "f"]]);
  });

  it("joins groups that overlap on caption and thumbnail", () => {
    const caption = "a caption that is long enough to count as a match";
    const library = mergeImport(
      emptyLibrary(),
      result([bm("a", { caption }), bm("b", { caption, thumbnailUrl: "t" }), bm("c", { thumbnailUrl: "t" })]),
    ).library;
    expect(findDuplicates(library).lookalikes).toEqual([["a", "b", "c"]]);
  });
});
