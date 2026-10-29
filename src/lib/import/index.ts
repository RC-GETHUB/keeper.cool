import type { Bookmark, ImportedCollection, ImportResult } from "../types";
import { parseSavedCollectionsHtml, parseSavedPostsHtml } from "./export-html";
import { parseSavedCollectionsJson, parseSavedPostsJson, type ParsedCollections, type ParsedPosts } from "./export-json";
import { usernameFromExportName } from "../libraries";
import { readZipText } from "./zip";

export interface ExportFile {
  name: string;
  text: string;
}

type FileKind = "posts" | "collections";

export function savedFileKind(path: string): FileKind | null {
  const base = path.split(/[\\/]/).pop() ?? path;
  if (/^saved_posts.*\.(json|html?)$/i.test(base)) return "posts";
  if (/^saved_collections.*\.(json|html?)$/i.test(base)) return "collections";
  return null;
}

function isHtml(file: ExportFile): boolean {
  return /\.html?$/i.test(file.name) || /^\s*</.test(file.text);
}

export class ImportError extends Error {}

export function parseExportFiles(files: ExportFile[]): ImportResult {
  const posts: ParsedPosts[] = [];
  const collections: ParsedCollections[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    const kind = savedFileKind(file.name);
    if (!kind) continue;
    try {
      if (kind === "posts") posts.push(isHtml(file) ? parseSavedPostsHtml(file.text) : parseSavedPostsJson(file.text));
      else collections.push(isHtml(file) ? parseSavedCollectionsHtml(file.text) : parseSavedCollectionsJson(file.text));
    } catch {
      warnings.push(`Couldn't read ${file.name}. It may be damaged or in a format Keeper doesn't know yet.`);
    }
  }
  if (posts.length === 0 && collections.length === 0) {
    throw new ImportError(
      warnings[0] ??
        "No saved posts found. Look for saved_posts.json (or .html) in your Instagram download, or upload the whole zip.",
    );
  }

  const byId = new Map<string, Bookmark>();
  let mergedDuplicates = 0;
  let skipped = 0;
  const add = (bookmark: Bookmark, countDuplicate: boolean) => {
    const existing = byId.get(bookmark.id);
    if (!existing) {
      byId.set(bookmark.id, { ...bookmark });
      return;
    }
    if (countDuplicate) mergedDuplicates++;
    existing.author ??= bookmark.author;
    existing.savedAt ??= bookmark.savedAt;
    if (existing.kind === "post" && bookmark.kind !== "post") existing.kind = bookmark.kind;
  };
  for (const part of posts) {
    skipped += part.skipped;
    for (const bookmark of part.bookmarks) add(bookmark, true);
  }

  const merged = new Map<string, { collection: ImportedCollection; ids: Set<string> }>();
  for (const part of collections) {
    skipped += part.skipped;
    for (const bookmark of part.bookmarks) add(bookmark, false);
    for (const collection of part.collections) {
      const found = merged.get(collection.name);
      if (!found) {
        merged.set(collection.name, { collection: { ...collection, items: [...collection.items] }, ids: new Set(collection.items) });
        continue;
      }
      found.collection.createdAt ??= collection.createdAt;
      if ((collection.updatedAt ?? 0) > (found.collection.updatedAt ?? 0)) found.collection.updatedAt = collection.updatedAt;
      for (const id of collection.items) {
        if (!found.ids.has(id)) {
          found.ids.add(id);
          found.collection.items.push(id);
        }
      }
    }
  }

  // Newest saved first, like Instagram. Posts with no date keep their place at the end.
  const bookmarks = [...byId.values()];
  const dated = bookmarks.filter((b) => b.savedAt !== undefined).sort((a, b) => b.savedAt! - a.savedAt!);
  const undated = bookmarks.filter((b) => b.savedAt === undefined);

  return {
    bookmarks: [...dated, ...undated],
    collections: [...merged.values()].map((m) => m.collection),
    mergedDuplicates,
    skipped,
    warnings,
  };
}

/** Reads what the user dropped in: Instagram's zip, or the JSON/HTML files from inside it. */
export async function readExport(files: File[]): Promise<ImportResult> {
  const texts: ExportFile[] = [];
  for (const file of files) {
    if (/\.zip$/i.test(file.name) || file.type === "application/zip") {
      texts.push(...(await readZipText(file, (path) => savedFileKind(path) !== null)));
    } else if (savedFileKind(file.name)) {
      texts.push({ name: file.name, text: await file.text() });
    } else if (/\.(json|html?)$/i.test(file.name)) {
      // Renamed files: guess from the content.
      const text = await file.text();
      const kind = /saved_saved_collections|Creation Time/.test(text) ? "saved_collections" : "saved_posts";
      texts.push({ name: `${kind}${file.name.slice(file.name.lastIndexOf("."))}`, text });
    }
  }
  const result = parseExportFiles(texts);
  const username = [...files.map((f) => f.name), ...texts.map((t) => t.name)].map(usernameFromExportName).find(Boolean);
  if (username) result.sourceUsername = username;
  return result;
}
