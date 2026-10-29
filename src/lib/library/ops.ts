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
  return `c_${crypto.randomUUID().slice(0, 8)}`;
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
      author: existing.author ?? incoming.author,
      caption: existing.caption ?? incoming.caption,
      thumbnailUrl: incoming.thumbnailUrl ?? existing.thumbnailUrl,
      savedAt: existing.savedAt ?? incoming.savedAt,
    };
    if (Object.keys(merged).some((k) => merged[k as keyof Bookmark] !== existing[k as keyof Bookmark])) {
      bookmarks[incoming.id] = merged;
      updated++;
    }
  }

  const collections = lib.collections.map((c) => ({ ...c }));
  let collectionsAdded = 0;
  for (const incoming of result.collections) {
    const existing =
      collections.find((c) => c.instagramName === incoming.name) ??
      collections.find((c) => c.instagramName === undefined && c.name === incoming.name);
    if (!existing) {
      collections.push({
        id: newId(),
        name: incoming.name,
        instagramName: incoming.name,
        createdAt: incoming.createdAt,
        items: [...incoming.items],
      });
      collectionsAdded++;
      continue;
    }
    existing.instagramName ??= incoming.name;
    const have = new Set(existing.items);
    const added = incoming.items.filter((id) => !have.has(id));
    if (added.length) existing.items = [...added, ...existing.items];
  }

  return {
    library: touch(lib, { bookmarks, order: [...fresh, ...lib.order], collections }),
    summary: { added: fresh.length, updated, collectionsAdded },
  };
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
  const collection: Collection = { id: newId(), name: name.trim(), createdAt: Date.now(), items: unique(items) };
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

/** Adds bookmarks to the top of a collection, skipping ones already in it. */
export function addToCollection(lib: Library, id: string, ids: string[]): Library {
  return updateCollection(lib, id, (c) => {
    const have = new Set(c.items);
    const added = unique(ids).filter((x) => !have.has(x) && lib.bookmarks[x]);
    return added.length ? { ...c, items: [...added, ...c.items] } : c;
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
