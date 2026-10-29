import type { Bookmark, Collection, Library } from "../types";
import type { DuplicateReport } from "./duplicates";

export type SortMode = "custom" | "az" | "za" | "newest" | "oldest";

export type Scope =
  | { type: "all" }
  | { type: "collection"; id: string }
  | { type: "unfiled" }
  | { type: "duplicates" };

const KIND_LABEL = { post: "Post", reel: "Reel", tv: "Video" } as const;

export function kindLabel(bookmark: Bookmark): string {
  return KIND_LABEL[bookmark.kind];
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

/** What a bookmark is called in lists: the user's name, else the caption, else who posted it. */
export function displayName(bookmark: Bookmark): string {
  if (bookmark.title) return bookmark.title;
  const caption = bookmark.caption && firstLine(bookmark.caption);
  if (caption) return caption;
  if (bookmark.author) return `@${bookmark.author}`;
  return `${kindLabel(bookmark)} ${bookmark.id}`;
}

export function normalize(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

// Derived strings are cached per bookmark object. Edits replace the object,
// so a stale entry can never be read back.
const searchCache = new WeakMap<Bookmark, string>();
const sortCache = new WeakMap<Bookmark, string>();

function searchText(bookmark: Bookmark): string {
  let text = searchCache.get(bookmark);
  if (text === undefined) {
    text = normalize(
      [bookmark.title, bookmark.caption, bookmark.author && `@${bookmark.author}`, bookmark.id, kindLabel(bookmark)]
        .filter(Boolean)
        .join("\n"),
    );
    searchCache.set(bookmark, text);
  }
  return text;
}

/**
 * A–Z ignores case, accents and leading symbols or emoji, so "@anna" files
 * under A. Numbers are padded so "9 tips" sorts before "10 tips".
 */
function sortKey(bookmark: Bookmark): string {
  let key = sortCache.get(bookmark);
  if (key === undefined) {
    const name = normalize(displayName(bookmark));
    key = (name.replace(/^[^\p{L}\p{N}]+/u, "") || name).replace(/\d+/g, (d) => d.padStart(12, "0"));
    sortCache.set(bookmark, key);
  }
  return key;
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

// The A–Z position of every bookmark, worked out once per version of the
// bookmarks and reused by every view, filter and collection after that.
const alphaRanks = new WeakMap<Library["bookmarks"], Map<string, number>>();

function alphaRank(lib: Library): Map<string, number> {
  let ranks = alphaRanks.get(lib.bookmarks);
  if (!ranks) {
    const keyed = Object.values(lib.bookmarks).map((b) => ({ id: b.id, key: sortKey(b) }));
    keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.id < b.id ? -1 : 1));
    ranks = new Map(keyed.map((k, i) => [k.id, i]));
    alphaRanks.set(lib.bookmarks, ranks);
  }
  return ranks;
}

/** Splits a query into words; a bookmark matches when it contains all of them. */
export function queryTerms(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean);
}

export function matches(bookmark: Bookmark, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const text = searchText(bookmark);
  return terms.every((t) => text.includes(t));
}

export function baseIds(lib: Library, scope: Scope, duplicates?: DuplicateReport): string[] {
  switch (scope.type) {
    case "all":
      return lib.order;
    case "collection":
      return lib.collections.find((c) => c.id === scope.id)?.items ?? [];
    case "unfiled": {
      const filed = filedIds(lib);
      return lib.order.filter((id) => !filed.has(id));
    }
    case "duplicates": {
      // Look-alike groups side by side, then posts filed in several collections.
      if (!duplicates) return [];
      const ids = duplicates.lookalikes.flat();
      const listed = new Set(ids);
      for (const id of lib.order) if (duplicates.inCollections.has(id) && !listed.has(id)) ids.push(id);
      return ids;
    }
  }
}

function filedIds(lib: Library): Set<string> {
  const filed = new Set<string>();
  for (const c of lib.collections) for (const id of c.items) if (lib.bookmarks[id]) filed.add(id);
  return filed;
}

export interface ViewOptions {
  scope: Scope;
  sort: SortMode;
  query: string;
  /** From findDuplicates, for the duplicates scope. */
  duplicates?: DuplicateReport;
}

/** The ids to show, in display order. */
export function viewIds(lib: Library, { scope, sort, query, duplicates }: ViewOptions): string[] {
  const terms = queryTerms(query);
  let ids = baseIds(lib, scope, duplicates);
  if (terms.length) ids = ids.filter((id) => matches(lib.bookmarks[id], terms));
  else if (sort !== "custom") ids = [...ids];

  const get = (id: string) => lib.bookmarks[id];
  switch (sort) {
    case "custom":
      return ids;
    case "az":
    case "za": {
      const ranks = alphaRank(lib);
      const dir = sort === "az" ? 1 : -1;
      return ids.sort((a, b) => dir * (ranks.get(a)! - ranks.get(b)!));
    }
    case "newest":
    case "oldest": {
      const dir = sort === "newest" ? -1 : 1;
      // Undated bookmarks go last either way.
      return ids.sort((a, b) => {
        const x = get(a).savedAt;
        const y = get(b).savedAt;
        if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1;
        return dir * (x - y);
      });
    }
  }
}

export interface Counts {
  total: number;
  unfiled: number;
  collections: Record<string, number>;
}

export function countLibrary(lib: Library): Counts {
  const filed = filedIds(lib);
  const collections: Record<string, number> = {};
  for (const c of lib.collections) collections[c.id] = c.items.length;
  return { total: lib.order.length, unfiled: lib.order.length - filed.size, collections };
}

export type CollectionSort = "custom" | "az" | "za" | "newest" | "oldest" | "size";

/** Collections to show in the sidebar: filtered by name, in the chosen order. */
export function sortCollections(collections: Collection[], sort: CollectionSort, filter = ""): Collection[] {
  const terms = queryTerms(filter);
  let list = terms.length ? collections.filter((c) => terms.every((t) => normalize(c.name).includes(t))) : collections;
  if (sort === "custom") return list;
  list = [...list];
  const byName = (a: Collection, b: Collection) => collator.compare(a.name, b.name);
  // Collections with no date (made before dates were known) go last either way.
  const byDate = (dir: number) => (a: Collection, b: Collection) =>
    a.createdAt === undefined || b.createdAt === undefined
      ? (a.createdAt === undefined ? 1 : 0) - (b.createdAt === undefined ? 1 : 0)
      : dir * (a.createdAt - b.createdAt);
  if (sort === "az") list.sort(byName);
  if (sort === "za") list.sort((a, b) => byName(b, a));
  if (sort === "newest") list.sort(byDate(-1));
  if (sort === "oldest") list.sort(byDate(1));
  if (sort === "size") list.sort((a, b) => b.items.length - a.items.length || byName(a, b));
  return list;
}
