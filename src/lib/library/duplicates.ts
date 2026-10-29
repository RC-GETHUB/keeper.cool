import type { Bookmark, Library } from "../types";
import { normalize } from "./query";

// Instagram only lets you save a post once, so a true duplicate can't exist
// on Instagram itself. What people mean by duplicates is one of these:
//  - the same post filed in several collections
//  - different posts that are the same content (reposts, re-uploads)
// Exact repeats in an import are merged on the way in and never get here.

export type DuplicateReason = "collections" | "lookalike";

export interface DuplicateReport {
  /** Bookmark id → ids of the collections it is in, for bookmarks in two or more. */
  inCollections: Map<string, string[]>;
  /** Groups of different posts that look like the same content, in library order. */
  lookalikes: string[][];
  /** Bookmark id → its lookalike group. */
  groupOf: Map<string, string[]>;
  /** Every flagged bookmark. */
  flagged: Set<string>;
}

// Captions shorter than this ("😍", "yes!!") match too many unrelated posts.
const MIN_CAPTION = 24;

const captionKeys = new WeakMap<Bookmark, string>();

function captionKey(bookmark: Bookmark & { caption: string }): string {
  let key = captionKeys.get(bookmark);
  if (key === undefined) {
    key = normalize(bookmark.caption)
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[#@][\p{L}\p{N}_.]+/gu, " ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    captionKeys.set(bookmark, key);
  }
  return key;
}

export function findDuplicates(lib: Library): DuplicateReport {
  const inCollections = new Map<string, string[]>();
  const seenIn = new Map<string, string[]>();
  for (const c of lib.collections) {
    for (const id of c.items) {
      const list = seenIn.get(id);
      if (list) list.push(c.id);
      else seenIn.set(id, [c.id]);
    }
  }
  for (const [id, cols] of seenIn) if (cols.length > 1 && lib.bookmarks[id]) inCollections.set(id, cols);

  const byKey = new Map<string, string[]>();
  for (const id of lib.order) {
    const b = lib.bookmarks[id];
    if (b?.caption) {
      const key = captionKey(b as Bookmark & { caption: string });
      if (key.length >= MIN_CAPTION) {
        const group = byKey.get(key);
        if (group) group.push(id);
        else byKey.set(key, [id]);
      }
    }
    if (b?.thumbnailUrl) {
      const key = `thumb:${b.thumbnailUrl.split("?")[0]}`;
      const group = byKey.get(key);
      if (group) group.push(id);
      else byKey.set(key, [id]);
    }
  }

  // A post can match one group on caption and another on thumbnail, so join
  // overlapping groups (union-find).
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (id !== root) {
      const next = parent.get(id)!;
      parent.set(id, root);
      id = next;
    }
    return root;
  };
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    for (const id of group) if (!parent.has(id)) parent.set(id, id);
    const root = find(group[0]);
    for (const id of group) {
      const r = find(id);
      if (r !== root) parent.set(r, root);
    }
  }
  const byRoot = new Map<string, string[]>();
  for (const id of lib.order) {
    if (!parent.has(id)) continue;
    const root = find(id);
    const group = byRoot.get(root);
    if (group) group.push(id);
    else byRoot.set(root, [id]);
  }
  const lookalikes = [...byRoot.values()];
  const groupOf = new Map<string, string[]>();
  for (const group of lookalikes) for (const id of group) groupOf.set(id, group);

  return {
    inCollections,
    lookalikes,
    groupOf,
    flagged: new Set([...inCollections.keys(), ...groupOf.keys()]),
  };
}

export function reasonsFor(report: DuplicateReport, id: string): DuplicateReason[] {
  const reasons: DuplicateReason[] = [];
  if (report.inCollections.has(id)) reasons.push("collections");
  if (report.groupOf.has(id)) reasons.push("lookalike");
  return reasons;
}
