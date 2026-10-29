import type { Bookmark, Collection, ImportResult, Library } from "../types";

// Every operation returns a new Library and leaves the old one untouched,
// so React can tell what changed and undo is a matter of keeping the old value.

export function emptyLibrary(): Library {
  return { version: 1, bookmarks: {}, order: [], collections: [], updatedAt: Date.now() };
}

function touch(lib: Library, patch: Partial<Library>): Library {
  return { ...lib, ...patch, updatedAt: Date.now() };
}

function newId(): string {
  // randomUUID only exists on https and localhost.
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `c_${random.slice(0, 8)}`;
}

export interface MergeSummary {
  added: number;
  updated: number;
  collectionsAdded: number;
}

/**
 * Brings an import into the library. New bookmarks go on top, newest first,
 * as Instagram shows them. Anything the user already has keeps its name,
 * place and collections. Nothing is removed: posts unsaved on Instagram since
 * the last import stay until the user removes them.
 */
export function mergeImport(lib: Library, result: ImportResult): { library: Library; summary: MergeSummary } {
  const bookmarks = { ...lib.bookmarks };
  const fresh: string[] = [];
  let updated = 0;
  for (const incoming of result.bookmarks) {
    const existing = bookmarks[incoming.id];
    if (!existing) {
      bookmarks[incoming.id] = { ...incoming };
      fresh.push(incoming.id);
      continue;
    }
    const merged: Bookmark = {
      ...existing,
      kind: existing.kind === "post" ? incoming.kind : existing.kind,
      author: existing.author ?? incoming.author,
      caption: incoming.caption ?? existing.caption,
      thumbnailUrl: incoming.thumbnailUrl ?? existing.thumbnailUrl,
      mediaId: existing.mediaId ?? incoming.mediaId,
      savedAt: existing.savedAt ?? incoming.savedAt,
    };
    if (Object.keys(merged).some((k) => merged[k as keyof Bookmark] !== existing[k as keyof Bookmark])) {
      bookmarks[incoming.id] = merged;
      updated++;
    }
  }

  const collections = lib.collections.map((c) => ({ ...c }));
  const collectionOrder: string[] = [];
  let collectionsAdded = 0;
  for (const incoming of result.collections) {
    const existing =
      (incoming.instagramId && collections.find((c) => c.instagramId === incoming.instagramId)) ||
      collections.find((c) => c.instagramName === incoming.name) ||
      collections.find((c) => c.instagramName === undefined && c.name === incoming.name);
    if (!existing) {
      const created: Collection = { id: newId(), name: incoming.name, instagramName: incoming.name, items: [...incoming.items] };
      if (incoming.instagramId) created.instagramId = incoming.instagramId;
      if (incoming.createdAt) created.createdAt = incoming.createdAt;
      if (incoming.updatedAt) created.updatedAt = incoming.updatedAt;
      created.instagramItems = [...incoming.items];
      collections.push(created);
      collectionOrder.push(created.id);
      collectionsAdded++;
      continue;
    }
    existing.instagramName = incoming.name;
    existing.instagramItems = [...incoming.items];
    collectionOrder.push(existing.id);
    if (incoming.instagramId) existing.instagramId = incoming.instagramId;
    // Re-importing corrects the dates.
    if (incoming.createdAt) existing.createdAt = incoming.createdAt;
    if ((incoming.updatedAt ?? 0) > (existing.updatedAt ?? 0)) existing.updatedAt = incoming.updatedAt;
    const have = new Set(existing.items);
    const added = incoming.items.filter((id) => !have.has(id));
    if (added.length) existing.items = [...added, ...existing.items];
  }

  const patch: Partial<Library> = {
    bookmarks,
    order: [...fresh, ...lib.order],
    collections,
    // Instagram's order as of this import, for "Restore Instagram's order".
    instagramOrder: result.bookmarks.map((b) => b.id),
  };
  if (result.collections.length) patch.instagramCollectionOrder = collectionOrder;
  if (result.account) patch.instagram = result.account;
  return {
    library: touch(lib, patch),
    summary: { added: fresh.length, updated, collectionsAdded },
  };
}

/** Adds cover images (from the extension) to bookmarks. Not an edit, so it isn't something to undo. */
export function applyThumbnails(lib: Library, thumbs: { code: string; data: string }[]): Library {
  const bookmarks = { ...lib.bookmarks };
  let changed = false;
  for (const { code, data } of thumbs) {
    const b = bookmarks[code];
    if (b && b.thumbnailUrl !== data) {
      bookmarks[code] = { ...b, thumbnailUrl: data };
      changed = true;
    }
  }
  return changed ? { ...lib, bookmarks } : lib;
}

/** Sets the user's own name for a bookmark. An empty name goes back to the default. */
export function renameBookmark(lib: Library, id: string, title: string): Library {
  const bookmark = lib.bookmarks[id];
  if (!bookmark) return lib;
  const trimmed = title.trim();
  const next: Bookmark = { ...bookmark };
  if (trimmed) next.title = trimmed;
  else delete next.title;
  return touch(lib, { bookmarks: { ...lib.bookmarks, [id]: next } });
}

/** Removes bookmarks from the library entirely (and so from every collection). */
export function removeBookmarks(lib: Library, ids: Iterable<string>): Library {
  const gone = new Set(ids);
  const bookmarks = { ...lib.bookmarks };
  for (const id of gone) delete bookmarks[id];
  return touch(lib, {
    bookmarks,
    order: lib.order.filter((id) => !gone.has(id)),
    collections: lib.collections.map((c) =>
      c.items.some((id) => gone.has(id)) ? { ...c, items: c.items.filter((id) => !gone.has(id)) } : c,
    ),
  });
}

export function collectionNameError(lib: Library, name: string, exceptId?: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give the collection a name.";
  if (trimmed.length > 100) return "Keep the name under 100 characters.";
  const clash = lib.collections.find((c) => c.id !== exceptId && c.name.toLowerCase() === trimmed.toLowerCase());
  return clash ? `You already have a collection called “${clash.name}”.` : null;
}

export function createCollection(lib: Library, name: string, items: string[] = []): { library: Library; id: string } {
  const error = collectionNameError(lib, name);
  if (error) throw new Error(error);
  const now = Date.now();
  const collection: Collection = { id: newId(), name: name.trim(), createdAt: now, updatedAt: now, items: unique(items) };
  return { library: touch(lib, { collections: [...lib.collections, collection] }), id: collection.id };
}

export function renameCollection(lib: Library, id: string, name: string): Library {
  const error = collectionNameError(lib, name, id);
  if (error) throw new Error(error);
  return updateCollection(lib, id, (c) => ({ ...c, name: name.trim() }));
}

/** Deletes a collection. Its bookmarks stay in the library. */
export function deleteCollection(lib: Library, id: string): Library {
  return touch(lib, { collections: lib.collections.filter((c) => c.id !== id) });
}

/** Moves a collection to a new position in the sidebar. */
export function moveCollection(lib: Library, id: string, toIndex: number): Library {
  const from = lib.collections.findIndex((c) => c.id === id);
  if (from < 0) return lib;
  const collections = [...lib.collections];
  const [moved] = collections.splice(from, 1);
  collections.splice(Math.max(0, Math.min(toIndex, collections.length)), 0, moved);
  return touch(lib, { collections });
}

/**
 * Puts collections in the given order, e.g. the sidebar's A–Z view.
 * `ids` may be a subset (a filtered view): those take the slots they already
 * occupy, in the given order, and the rest stay put.
 */
export function orderCollections(lib: Library, ids: string[]): Library {
  const byId = new Map(lib.collections.map((c) => [c.id, c]));
  const queue = unique(ids).filter((id) => byId.has(id));
  const reordering = new Set(queue);
  let q = 0;
  const collections = lib.collections.map((c) => (reordering.has(c.id) ? byId.get(queue[q++])! : c));
  return collections.every((c, i) => c === lib.collections[i]) ? lib : touch(lib, { collections });
}

/** Whether Keeper knows Instagram's order for this list (all bookmarks when `collectionId` is null). */
export function canRestoreInstagramOrder(lib: Library, collectionId: string | null): boolean {
  if (collectionId === null) return Boolean(lib.instagramOrder?.length) || Object.values(lib.bookmarks).some((b) => b.savedAt);
  return Boolean(lib.collections.find((c) => c.id === collectionId)?.instagramItems);
}

/**
 * Puts a list back in Instagram's order as of the last import. Posts Keeper
 * doesn't have an Instagram position for (added since) stay on top in their
 * current order. Libraries imported before Keeper kept this fall back to
 * newest saved first, which is the same thing for an export import.
 */
export function restoreInstagramOrder(lib: Library, collectionId: string | null): Library {
  const list = collectionId === null ? lib.order : lib.collections.find((c) => c.id === collectionId)?.items;
  if (!list) return lib;
  let reference = collectionId === null ? lib.instagramOrder : lib.collections.find((c) => c.id === collectionId)?.instagramItems;
  if (!reference && collectionId === null) {
    reference = list
      .filter((id) => lib.bookmarks[id]?.savedAt !== undefined)
      .sort((a, b) => lib.bookmarks[b].savedAt! - lib.bookmarks[a].savedAt!);
  }
  if (!reference) return lib;
  const inList = new Set(list);
  const ranked = new Set(reference.filter((id) => inList.has(id)));
  const next = [...list.filter((id) => !ranked.has(id)), ...ranked];
  return next.every((id, i) => id === list[i]) ? lib : setOrder(lib, collectionId, next);
}

/** Puts the collection list back in Instagram's order; collections made in Keeper go after. */
export function restoreCollectionOrder(lib: Library): Library {
  const reference = lib.instagramCollectionOrder;
  if (!reference) return lib;
  const rank = new Map(reference.map((id, i) => [id, i]));
  const last = reference.length;
  const collections = [...lib.collections].sort((a, b) => (rank.get(a.id) ?? last) - (rank.get(b.id) ?? last));
  return collections.every((c, i) => c === lib.collections[i]) ? lib : touch(lib, { collections });
}

/** Adds bookmarks to the top of a collection, skipping ones already in it. */
export function addToCollection(lib: Library, id: string, ids: string[]): Library {
  return updateCollection(lib, id, (c) => {
    const have = new Set(c.items);
    const added = unique(ids).filter((x) => !have.has(x) && lib.bookmarks[x]);
    return added.length ? { ...c, items: [...added, ...c.items], updatedAt: Date.now() } : c;
  });
}

export function removeFromCollection(lib: Library, id: string, ids: string[]): Library {
  const gone = new Set(ids);
  return updateCollection(lib, id, (c) => ({ ...c, items: c.items.filter((x) => !gone.has(x)) }));
}

/**
 * Moves `ids` so they sit together, in their current relative order, at
 * `toIndex` of the list as it would be without them. `collectionId` null
 * means the "All bookmarks" order.
 */
export function moveItems(lib: Library, collectionId: string | null, ids: string[], toIndex: number): Library {
  const list = collectionId === null ? lib.order : lib.collections.find((c) => c.id === collectionId)?.items;
  if (!list) return lib;
  const moving = new Set(ids);
  const kept: string[] = [];
  const moved: string[] = [];
  for (const id of list) (moving.has(id) ? moved : kept).push(id);
  if (moved.length === 0) return lib;
  const at = Math.max(0, Math.min(toIndex, kept.length));
  const next = [...kept.slice(0, at), ...moved, ...kept.slice(at)];
  return setOrder(lib, collectionId, next);
}

/**
 * Saves a full order, e.g. the current A–Z view, as the user's own order.
 * `ids` may be a subset (a filtered view): those are placed in the given
 * order into the slots they already occupy, and everything else stays put.
 */
export function applyOrder(lib: Library, collectionId: string | null, ids: string[]): Library {
  const list = collectionId === null ? lib.order : lib.collections.find((c) => c.id === collectionId)?.items;
  if (!list) return lib;
  const inList = new Set(list);
  const queue = unique(ids).filter((id) => inList.has(id));
  const reordering = new Set(queue);
  let q = 0;
  const next = list.map((id) => (reordering.has(id) ? queue[q++] : id));
  return setOrder(lib, collectionId, next);
}

function setOrder(lib: Library, collectionId: string | null, next: string[]): Library {
  if (collectionId === null) return touch(lib, { order: next });
  return updateCollection(lib, collectionId, (c) => ({ ...c, items: next }));
}

function updateCollection(lib: Library, id: string, update: (c: Collection) => Collection): Library {
  let changed = false;
  const collections = lib.collections.map((c) => {
    if (c.id !== id) return c;
    const next = update(c);
    changed = next !== c;
    return next;
  });
  return changed ? touch(lib, { collections }) : lib;
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}
