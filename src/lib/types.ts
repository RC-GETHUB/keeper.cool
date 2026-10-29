export type PostKind = "post" | "reel" | "tv";

export interface Bookmark {
  /** Instagram shortcode (the "C0aBcD1eFgH" in /p/C0aBcD1eFgH/). Stable across imports. */
  id: string;
  kind: PostKind;
  url: string;
  author?: string;
  caption?: string;
  /** A small cover image: a data: URI made by the extension, or a remote URL. */
  thumbnailUrl?: string;
  /** Instagram's numeric media id, needed to save or unsave the post. */
  mediaId?: string;
  /** When it was saved on Instagram, in ms. */
  savedAt?: number;
  /** The user's own name for it. Lives only in Keeper: Instagram has no bookmark names. */
  title?: string;
  /** Came in with an import after the first one, and not yet marked as seen. */
  isNew?: true;
  /** Copied from another account's library and not yet saved on this account: Sync saves it. */
  toSave?: true;
}

export interface Collection {
  id: string;
  name: string;
  /** Name on Instagram at the last import, so a rename can be pushed back. Unset for collections made in Keeper. */
  instagramName?: string;
  /** Instagram's id for the collection, when it came from the extension. */
  instagramId?: string;
  createdAt?: number;
  /** When a post was last added to it (on Instagram, or in Keeper). */
  updatedAt?: number;
  /** Bookmark ids in the user's order. */
  items: string[];
  /** Its posts in Instagram's order at the last import, for "Restore Instagram's order". */
  instagramItems?: string[];
  /** Came in with an import after the first one, and not yet marked as seen. */
  isNew?: true;
}

export interface Library {
  version: 1;
  bookmarks: Record<string, Bookmark>;
  /** The user's order for "All bookmarks". Holds every bookmark id exactly once. */
  order: string[];
  collections: Collection[];
  /** The Instagram account the extension last imported from. */
  instagram?: InstagramAccount;
  /** The account named in an imported export file's name, when the extension hasn't said. */
  exportUsername?: string;
  /** Saved posts in Instagram's order at the last import, for "Restore Instagram's order". */
  instagramOrder?: string[];
  /** Collection ids in Instagram's order at the last import. */
  instagramCollectionOrder?: string[];
  updatedAt: number;
}

export interface InstagramAccount {
  userId: string;
  username: string | null;
}

export interface ImportedCollection {
  name: string;
  instagramId?: string;
  createdAt?: number;
  updatedAt?: number;
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
  /** Set when the import came from the extension. */
  account?: InstagramAccount;
  /** Only new saves, not the whole list: Instagram's full order is unknown. */
  partial?: boolean;
  /** The account an export file came from, read from its file name. */
  sourceUsername?: string;
}
