import { createStore, del, get, set } from "idb-keyval";
import { describe, newLibraryId, type LibraryIndex } from "./libraries";
import { emptyLibrary } from "./library/ops";
import type { Library } from "./types";

// Libraries live in the browser (IndexedDB), so nothing leaves the user's
// device. One record lists the libraries (one per Instagram account); each
// library is its own record. Accounts and server sync replace this later.

const INDEX = "libraries";
const LEGACY = "library"; // the single library from before accounts were separate
let store: ReturnType<typeof createStore> | null = null;

function db() {
  store ??= createStore("keeper", "kv");
  return store;
}

const key = (id: string) => `library:${id}`;

export async function loadLibrary(id: string): Promise<Library | null> {
  const lib = await get<Library>(key(id), db());
  return lib?.version === 1 ? lib : null;
}

export function saveLibrary(id: string, lib: Library): Promise<void> {
  return set(key(id), lib, db());
}

export function saveIndex(index: LibraryIndex): Promise<void> {
  return set(INDEX, index, db());
}

export async function deleteLibrary(id: string): Promise<void> {
  await del(key(id), db());
}

/** The index and the open library, creating the first library (or moving the old single one over) if needed. */
export async function openLibraries(): Promise<{ index: LibraryIndex; lib: Library }> {
  let index = await get<LibraryIndex>(INDEX, db());
  if (!index?.entries?.length) {
    const legacy = await get<Library>(LEGACY, db());
    const lib = legacy?.version === 1 ? legacy : emptyLibrary();
    const id = newLibraryId();
    await saveLibrary(id, lib);
    index = { version: 1, active: id, entries: [describe(id, lib, Date.now())] };
    await saveIndex(index);
    if (legacy) await del(LEGACY, db());
    return { index, lib };
  }
  if (!index.entries.some((e) => e.id === index!.active)) index = { ...index, active: index.entries[0].id };
  return { index, lib: (await loadLibrary(index.active)) ?? emptyLibrary() };
}
