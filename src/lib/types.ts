export type PostKind = "post" | "reel" | "tv";

export interface Bookmark {
  /** Instagram shortcode (the "C0aBcD1eFgH" in /p/C0aBcD1eFgH/). Stable across imports. */
  id: string;
  kind: PostKind;
  url: string;
  author?: string;
  caption?: string;
  thumbnailUrl?: string;
  /** When it was saved on Instagram, in ms. */
  savedAt?: number;
  /** The user's own name for it. Lives only in Keeper: Instagram has no bookmark names. */
  title?: string;
}

export interface Collection {
  id: string;
  name: string;
  /** Name on Instagram at the last import, so a rename can be pushed back. Unset for collections made in Keeper. */
  instagramName?: string;
  createdAt?: number;
  /** Bookmark ids in the user's order. */
  items: string[];
}

export interface Library {
  version: 1;
  bookmarks: Record<string, Bookmark>;
  /** The user's order for "All bookmarks". Holds every bookmark id exactly once. */
  order: string[];
  collections: Collection[];
  updatedAt: number;
}

export interface ImportedCollection {
  name: string;
  createdAt?: number;
  /** Bookmark ids, newest added first (Instagram's order). */
  items: string[];
}

export interface ImportResult {
  /** Newest saved first (Instagram's order). */
  bookmarks: Bookmark[];
  collections: ImportedCollection[];
  /** Entries that pointed at a post already seen (e.g. the same post under a /p/ and a /reel/ link). */
  mergedDuplicates: number;
  /** Entries with no recognisable post link. */
  skipped: number;
  warnings: string[];
}
