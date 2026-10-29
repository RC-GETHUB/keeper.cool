import { describe, expect, it } from "vitest";
import { describe as describeEntry, identityOf, routeImport, sameIdentity, usernameFromExportName, type LibraryIndex } from "@/lib/libraries";
import { copyBookmarks, emptyLibrary, mergeImport } from "@/lib/library/ops";
import { planPush } from "@/lib/push";
import type { Bookmark, ImportResult, Library } from "@/lib/types";

const bm = (id: string, extra: Partial<Bookmark> = {}): Bookmark => ({ id, kind: "post", url: `https://www.instagram.com/p/${id}/`, ...extra });
const result = (bookmarks: Bookmark[], extra: Partial<ImportResult> = {}): ImportResult => ({
  bookmarks,
  collections: [],
  mergedDuplicates: 0,
  skipped: 0,
  warnings: [],
  ...extra,
});

function setup(libs: Record<string, Library>, active: string): LibraryIndex {
  return { version: 1, active, entries: Object.entries(libs).map(([id, lib]) => describeEntry(id, lib, 0)) };
}

describe("accounts", () => {
  const ryan = mergeImport(emptyLibrary(), result([bm("a")], { account: { userId: "1", username: "ryancramer" } })).library;
  const work = mergeImport(emptyLibrary(), result([bm("b")], { sourceUsername: "neuron.la" })).library;

  it("knows whose library it is", () => {
    expect(identityOf(ryan)).toEqual({ userId: "1", username: "ryancramer" });
    expect(identityOf(work)).toEqual({ userId: undefined, username: "neuron.la" });
    expect(sameIdentity({ userId: "1", username: "x" }, { userId: "1", username: "renamed" })).toBe(true);
    expect(sameIdentity({ username: "Neuron.LA" }, { userId: "9", username: "neuron.la" })).toBe(true);
    expect(sameIdentity({}, { username: "x" })).toBe(false);
  });

  it("routes imports to the right account's library", () => {
    const index = setup({ r: ryan, w: work, e: emptyLibrary() }, "r");
    expect(routeImport(index, ryan, { userId: "1", username: "ryancramer" })).toEqual({ kind: "here" });
    expect(routeImport(index, ryan, { userId: "2", username: "neuron.la" })).toEqual({ kind: "switch", id: "w" });
    expect(routeImport(index, ryan, { userId: "3", username: "someone.else" })).toEqual({ kind: "ask" });
    expect(routeImport(index, ryan, {})).toEqual({ kind: "here" });
    expect(routeImport({ ...index, active: "e" }, emptyLibrary(), { userId: "3", username: "someone.else" })).toEqual({ kind: "here" });
    // A library from before accounts were known, holding most of the incoming posts: same account.
    const unnamed = mergeImport(emptyLibrary(), result([bm("p"), bm("q"), bm("r")])).library;
    const idx = setup({ u: unnamed }, "u");
    expect(routeImport(idx, unnamed, { userId: "1", username: "ryancramer" }, ["p", "q", "new"])).toEqual({ kind: "here" });
    expect(routeImport(idx, unnamed, { userId: "1", username: "ryancramer" }, ["x", "y", "p"])).toEqual({ kind: "ask" });
  });

  it("reads the account from Instagram's export file name", () => {
    expect(usernameFromExportName("instagram-ryancramer-2026-10-28-AbC123.zip")).toBe("ryancramer");
    expect(usernameFromExportName("instagram-neuron.la-2026-10-28-x/your_instagram_activity/saved/saved_posts.json")).toBe("neuron.la");
    expect(usernameFromExportName("saved_posts.json")).toBeUndefined();
  });
});

describe("copying between accounts", () => {
  it("copies bookmarks on top, marked new and waiting to be saved, into a matching collection", () => {
    const source = mergeImport(emptyLibrary(), result([bm("a", { title: "Mine", caption: "c" }), bm("b"), bm("c")])).library;
    const target = mergeImport(emptyLibrary(), result([bm("b"), bm("z")])).library;
    const { library, copied } = copyBookmarks(target, source, ["a", "b"], "Recipes");
    expect(copied).toBe(1);
    expect(library.order).toEqual(["a", "b", "z"]);
    expect(library.bookmarks.a).toMatchObject({ title: "Mine", caption: "c", isNew: true, toSave: true });
    expect(library.bookmarks.b.toSave).toBeUndefined();
    expect(library.collections.map((c) => [c.name, c.items])).toEqual([["Recipes", ["a", "b"]]]);
    // An existing collection of that name is reused.
    expect(copyBookmarks(library, source, ["c"], "recipes").library.collections.map((c) => c.items)).toEqual([["c", "a", "b"]]);
  });

  it("Sync saves copied posts, and a later import clears the flag", () => {
    const source = mergeImport(emptyLibrary(), result([bm("BA")])).library;
    const target = copyBookmarks(mergeImport(emptyLibrary(), result([bm("z")])).library, source, ["BA"]).library;
    const onInstagram = [{ pk: "pk-z", code: "z", kind: "post" as const, author: null, caption: null, image: null, collectionIds: [] }];
    const saveCodes = new Set(target.order.filter((id) => target.bookmarks[id].toSave));
    const plan = planPush(target.order, onInstagram, { saveCodes });
    expect(plan.steps).toEqual([{ code: "BA", mediaId: "64", action: "save", collections: [] }]);
    expect(planPush(target.order, onInstagram).steps).toEqual([]);
    // A media id Keeper already has wins over working it out from the shortcode.
    expect(planPush(target.order, onInstagram, { saveCodes, mediaIds: new Map([["BA", "999"]]) }).steps[0].mediaId).toBe("999");

    const afterSync = mergeImport(target, result([bm("BA"), bm("z")])).library;
    expect(afterSync.bookmarks.BA.toSave).toBeUndefined();
  });
});
