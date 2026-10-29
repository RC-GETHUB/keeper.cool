import { postUrl } from "./instagram";
import { addToCollection, mergeImport } from "./library/ops";
import type { Bookmark, ImportResult, InstagramAccount, Library, PostKind } from "./types";

// What the extension reads from the logged-in Instagram tab, and how it
// becomes an import. The extension trims Instagram's large media objects
// down to these fields before handing them over (see extension/media.js).

export interface InstagramMedia {
  /** Media id, as a string (Instagram's numbers are too big for JS numbers). */
  pk: string;
  /** Shortcode, the id Keeper uses. */
  code: string;
  kind: PostKind;
  author: string | null;
  caption: string | null;
  /** A cover image URL on Instagram's CDN. Expires after a while. */
  image: string | null;
  /** Ids of the collections the post is in, when Instagram says. */
  collectionIds: string[] | null;
}

export interface InstagramCollection {
  id: string;
  name: string;
  /** Shortcodes, in Instagram's order (newest added first). */
  items: string[];
}

export interface InstagramRead {
  account: InstagramAccount;
  /** Newest saved first. */
  saved: InstagramMedia[];
  collections: InstagramCollection[];
  /** Only the posts saved since Keeper last looked (no collections). */
  partial?: boolean;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** A shortcode is the media id written in base 64; private posts add extra characters after the first 11. */
export function codeToPk(code: string): string {
  let pk = BigInt(0);
  for (const ch of code.slice(0, 11)) {
    const value = ALPHABET.indexOf(ch);
    if (value < 0) throw new Error(`Not a shortcode: ${code}`);
    pk = pk * BigInt(64) + BigInt(value);
  }
  return pk.toString();
}

export function fromInstagramRead(read: InstagramRead): ImportResult {
  const seen = new Set<string>();
  const bookmarks: Bookmark[] = [];
  let mergedDuplicates = 0;
  for (const m of read.saved) {
    if (seen.has(m.code)) {
      mergedDuplicates++;
      continue;
    }
    seen.add(m.code);
    const bookmark: Bookmark = { id: m.code, kind: m.kind, url: postUrl(m.code, m.kind), mediaId: m.pk };
    if (m.author) bookmark.author = m.author;
    if (m.caption?.trim()) bookmark.caption = m.caption.trim();
    bookmarks.push(bookmark);
  }
  return {
    bookmarks,
    collections: read.collections.map((c) => ({
      name: c.name,
      instagramId: c.id,
      items: c.items.filter((code) => seen.has(code)),
    })),
    mergedDuplicates,
    skipped: 0,
    warnings: [],
    account: read.account,
    partial: read.partial,
  };
}

/**
 * Adds posts saved since the last visit, and files them into their
 * collections when Instagram says which (and Keeper knows the collection).
 */
export function mergeNewSaves(lib: Library, read: InstagramRead): { library: Library; added: number } {
  const { library, summary } = mergeImport(lib, fromInstagramRead({ ...read, partial: true }));
  let next = library;
  const byInstagramId = new Map(next.collections.filter((c) => c.instagramId).map((c) => [c.instagramId!, c.id]));
  for (const m of read.saved) {
    for (const igId of m.collectionIds ?? []) {
      const id = byInstagramId.get(igId);
      if (id) next = addToCollection(next, id, [m.code]);
    }
  }
  return { library: next, added: summary.added };
}

/**
 * Builds each collection's post list from the collection ids on the saved
 * posts, for when Instagram includes them (it saves one request per
 * collection). Order within a collection follows the saved order.
 */
export function collectionsFromMedia(saved: InstagramMedia[], collections: { id: string; name: string }[]): InstagramCollection[] {
  const byId = new Map(collections.map((c) => [c.id, { ...c, items: [] as string[] }]));
  for (const m of saved) for (const id of m.collectionIds ?? []) byId.get(id)?.items.push(m.code);
  return [...byId.values()];
}
