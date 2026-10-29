import type { Library } from "./types";

// Keeper keeps one library per Instagram account. The index lists them; each
// library is stored on its own (see storage.ts).

export interface LibraryEntry {
  id: string;
  /** The Instagram account it belongs to, when known. */
  userId?: string;
  username?: string;
  count: number;
  createdAt: number;
}

export interface LibraryIndex {
  version: 1;
  active: string;
  entries: LibraryEntry[];
}

/** Who an account is: the extension knows the id; an export file only the username. */
export interface Identity {
  userId?: string;
  username?: string | null;
}

export function newLibraryId(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `lib_${random.slice(0, 8)}`;
}

export function identityOf(lib: Library): Identity {
  return { userId: lib.instagram?.userId, username: lib.instagram?.username ?? lib.exportUsername };
}

export function describe(id: string, lib: Library, createdAt: number): LibraryEntry {
  const { userId, username } = identityOf(lib);
  const entry: LibraryEntry = { id, count: lib.order.length, createdAt };
  if (userId) entry.userId = userId;
  if (username) entry.username = username;
  return entry;
}

export function entryLabel(entry: LibraryEntry): string {
  return entry.username ? `@${entry.username}` : "My library";
}

/** Same account if the ids match, or (when an id is missing) the usernames do. */
export function sameIdentity(a: Identity, b: Identity): boolean {
  if (a.userId && b.userId) return a.userId === b.userId;
  if (a.username && b.username) return a.username.toLowerCase() === b.username.toLowerCase();
  return false;
}

export type ImportRoute =
  /** Import into the open library. */
  | { kind: "here" }
  /** Another library already belongs to this account. */
  | { kind: "switch"; id: string }
  /** The open library has other saves and it's unclear whose: ask, suggesting a new library. */
  | { kind: "ask" };

/**
 * Where an import from `incoming` should go. `postIds` are the posts in the
 * import: when the open library doesn't know its account yet but already
 * holds most of them, it's clearly the same account.
 */
export function routeImport(index: LibraryIndex, active: Library, incoming: Identity, postIds: string[] = []): ImportRoute {
  if (!incoming.userId && !incoming.username) return { kind: "here" };
  const own = identityOf(active);
  if (sameIdentity(own, incoming)) return { kind: "here" };
  const other = index.entries.find((e) => e.id !== index.active && sameIdentity(e, incoming));
  if (other) return { kind: "switch", id: other.id };
  if (active.order.length === 0) return { kind: "here" };
  if (!own.userId && !own.username && postIds.length) {
    const known = postIds.filter((id) => active.bookmarks[id]).length;
    if (known / postIds.length >= 0.5) return { kind: "here" };
  }
  return { kind: "ask" };
}

/** Reads the account name from Instagram's export file name: instagram-<username>-<yyyy>-<mm>-<dd>-….zip */
export function usernameFromExportName(path: string): string | undefined {
  for (const part of path.split(/[\\/]/)) {
    const match = /^instagram-([A-Za-z0-9._]{1,30})-\d{4}-\d{2}-\d{2}/.exec(part);
    if (match) return match[1];
  }
  return undefined;
}
