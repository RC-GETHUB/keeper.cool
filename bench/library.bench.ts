import { bench, describe } from "vitest";
import { parseExportFiles } from "@/lib/import";
import { findDuplicates } from "@/lib/library/duplicates";
import { emptyLibrary, mergeImport, moveItems, renameBookmark } from "@/lib/library/ops";
import { countLibrary, viewIds } from "@/lib/library/query";
import { syntheticExport, syntheticImport } from "@/lib/synthetic";
import type { Library } from "@/lib/types";

// Sizes: 10k is a heavy real-world saver; 50k is a stress test.
for (const size of [10_000, 50_000]) {
  const files = syntheticExport(size, { collections: 12 });
  const exportFiles = [
    { name: "saved_posts.json", text: files.posts },
    { name: "saved_collections.json", text: files.collections },
  ];
  const data = syntheticImport(size, { collections: 12 });
  const lib: Library = mergeImport(emptyLibrary(), data).library;
  const all = { type: "all" } as const;
  const middle = lib.order[Math.floor(size / 2)];

  describe(`${size.toLocaleString("en")} bookmarks`, () => {
    bench("import: parse Instagram export JSON", () => {
      parseExportFiles(exportFiles);
    });
    bench("import: merge into library", () => {
      mergeImport(emptyLibrary(), data);
    });
    bench("re-import: merge into existing library", () => {
      mergeImport(lib, data);
    });
    bench("sort A–Z", () => {
      viewIds(lib, { scope: all, sort: "az", query: "" });
    });
    bench("sort newest", () => {
      viewIds(lib, { scope: all, sort: "newest", query: "" });
    });
    bench("search one word", () => {
      viewIds(lib, { scope: all, sort: "custom", query: "tacos" });
    });
    bench("search two words + A–Z", () => {
      viewIds(lib, { scope: all, sort: "az", query: "crispy pasta" });
    });
    bench("find duplicates", () => {
      findDuplicates(lib);
    });
    bench("counts", () => {
      countLibrary(lib);
    });
    bench("drag one bookmark", () => {
      moveItems(lib, null, [middle], 0);
    });
    bench("rename one bookmark", () => {
      renameBookmark(lib, middle, "Renamed");
    });
  });
}
