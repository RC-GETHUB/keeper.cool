import { fixMojibake, isUsername, parsePostUrl, toMs, type PostRef } from "../instagram";
import type { Bookmark, ImportedCollection } from "../types";

// Meta has shipped a few shapes of these files over the years
// (string_map_data, label_values, nested lists), so rather than trusting one
// schema we walk each entry and pick out the links, timestamps and labels.

interface EntryFields {
  title?: string;
  posts: { ref: PostRef; timestamp?: number }[];
  timestamps: number[];
  labels: Map<string, string>;
}

const TIMESTAMP_KEYS = new Set(["timestamp", "timestamp_value", "creation_timestamp"]);

function readEntry(entry: unknown): EntryFields {
  const fields: EntryFields = { posts: [], timestamps: [], labels: new Map() };
  if (entry && typeof entry === "object" && typeof (entry as { title?: unknown }).title === "string") {
    fields.title = fixMojibake((entry as { title: string }).title);
  }
  const seen = new Set<string>();

  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;

    let ownTimestamp: number | undefined;
    for (const [key, value] of Object.entries(obj)) {
      if (TIMESTAMP_KEYS.has(key) && typeof value === "number" && value > 0) {
        ownTimestamp ??= toMs(value);
        fields.timestamps.push(toMs(value));
      }
    }
    if (typeof obj.href === "string") {
      const ref = parsePostUrl(obj.href);
      if (ref && !seen.has(ref.id)) {
        seen.add(ref.id);
        fields.posts.push({ ref, timestamp: ownTimestamp });
      }
    }
    // { "string_map_data": { "Name": { "value": "Recipes" } } }
    if (obj.string_map_data && typeof obj.string_map_data === "object") {
      for (const [label, value] of Object.entries(obj.string_map_data as Record<string, unknown>)) {
        const v = (value as { value?: unknown } | null)?.value;
        if (typeof v === "string" && !fields.labels.has(label)) fields.labels.set(label, fixMojibake(v));
      }
    }
    // { "label_values": [{ "label": "Name", "value": "Recipes" }] }
    if (typeof obj.label === "string" && typeof obj.value === "string" && !fields.labels.has(obj.label)) {
      fields.labels.set(obj.label, fixMojibake(obj.value));
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") walk(value);
    }
  };
  walk(entry);
  return fields;
}

/** The list of entries in an export file: the root array, or its longest array property. */
function entriesOf(root: unknown): unknown[] {
  if (Array.isArray(root)) return root;
  if (!root || typeof root !== "object") return [];
  let best: unknown[] = [];
  for (const value of Object.values(root)) {
    if (Array.isArray(value) && value.length > best.length) best = value;
  }
  return best;
}

function labelled(fields: EntryFields, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = fields.labels.get(name);
    if (value) return value;
  }
  return undefined;
}

function authorOf(fields: EntryFields): string | undefined {
  if (fields.title && isUsername(fields.title)) return fields.title;
  const label = labelled(fields, "Username", "Author", "Owner", "Name");
  return label && isUsername(label) ? label : undefined;
}

function toBookmark(post: { ref: PostRef; timestamp?: number }, fields: EntryFields): Bookmark {
  const bookmark: Bookmark = { id: post.ref.id, kind: post.ref.kind, url: post.ref.url };
  const author = authorOf(fields);
  if (author) bookmark.author = author;
  const savedAt = post.timestamp ?? fields.timestamps[0];
  if (savedAt) bookmark.savedAt = savedAt;
  return bookmark;
}

export interface ParsedPosts {
  bookmarks: Bookmark[];
  skipped: number;
}

export function parseSavedPostsJson(text: string): ParsedPosts {
  const bookmarks: Bookmark[] = [];
  let skipped = 0;
  for (const entry of entriesOf(JSON.parse(text))) {
    const fields = readEntry(entry);
    if (fields.posts.length === 0) {
      skipped++;
      continue;
    }
    for (const post of fields.posts) bookmarks.push(toBookmark(post, fields));
  }
  return { bookmarks, skipped };
}

export interface ParsedCollections {
  collections: ImportedCollection[];
  /** Posts seen in collections, which may be missing from saved_posts. */
  bookmarks: Bookmark[];
  skipped: number;
}

/**
 * saved_collections.json is a flat list: a header entry per collection
 * ("Collection", with Name and Creation Time) followed by that collection's
 * posts. Some versions nest the posts inside the header instead; both work.
 */
export function parseSavedCollectionsJson(text: string): ParsedCollections {
  const collections: ImportedCollection[] = [];
  const bookmarks: Bookmark[] = [];
  let skipped = 0;
  let current: ImportedCollection | null = null;
  let currentIds = new Set<string>();

  for (const entry of entriesOf(JSON.parse(text))) {
    const fields = readEntry(entry);
    const isHeader = fields.posts.length !== 1 || fields.title === "Collection";
    if (isHeader) {
      const name =
        labelled(fields, "Name", "Collection Name", "Title") ??
        (fields.title && fields.title !== "Collection" ? fields.title : undefined);
      if (!name && fields.posts.length === 0) {
        skipped++;
        continue;
      }
      current = { name: name ?? "Untitled collection", items: [] };
      if (fields.timestamps[0]) current.createdAt = fields.timestamps[0];
      collections.push(current);
      currentIds = new Set();
      for (const post of fields.posts) {
        currentIds.add(post.ref.id);
        current.items.push(post.ref.id);
        bookmarks.push({ id: post.ref.id, kind: post.ref.kind, url: post.ref.url });
      }
      continue;
    }
    if (!current) {
      current = { name: "Untitled collection", items: [] };
      collections.push(current);
    }
    const post = fields.posts[0];
    if (!currentIds.has(post.ref.id)) {
      currentIds.add(post.ref.id);
      current.items.push(post.ref.id);
    }
    // In collection files the timestamp is when it was added to the collection,
    // not when it was saved, so it is not used as savedAt.
    const bookmark: Bookmark = { id: post.ref.id, kind: post.ref.kind, url: post.ref.url };
    const author = authorOf(fields);
    if (author) bookmark.author = author;
    bookmarks.push(bookmark);
  }
  return { collections, bookmarks, skipped };
}
