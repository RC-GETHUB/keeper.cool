import { createStore, del, get, set } from "idb-keyval";
import type { Library } from "./types";

// For now the library lives in the browser (IndexedDB), so nothing leaves
// the user's device. Accounts and sync replace this later.

const KEY = "library";
let store: ReturnType<typeof createStore> | null = null;

function db() {
  store ??= createStore("keeper", "kv");
  return store;
}

export async function loadLibrary(): Promise<Library | null> {
  const lib = await get<Library>(KEY, db());
  return lib?.version === 1 ? lib : null;
}

export function saveLibrary(lib: Library): Promise<void> {
  return set(KEY, lib, db());
}

export function clearLibrary(): Promise<void> {
  return del(KEY, db());
}
