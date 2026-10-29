import { fixMojibake, isUsername, parsePostUrl } from "../instagram";
import type { Bookmark, ImportedCollection } from "../types";
import type { ParsedCollections, ParsedPosts } from "./export-json";

// The HTML export is the same data laid out as tables of labels and values.
// It is parsed by reading the page as a flat run of text and links, so it
// works with a plain regex scan in both the browser and Node.

type Token = { type: "text"; text: string } | { type: "link"; href: string; text: string };

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  aacute: "á", agrave: "à", acirc: "â", auml: "ä", atilde: "ã", aring: "å", ccedil: "ç",
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë", iacute: "í", igrave: "ì", icirc: "î", iuml: "ï",
  ntilde: "ñ", oacute: "ó", ograve: "ò", ocirc: "ô", ouml: "ö", otilde: "õ", oslash: "ø",
  uacute: "ú", ugrave: "ù", ucirc: "û", uuml: "ü", szlig: "ß",
};

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    const lower = ENTITIES[code.toLowerCase()];
    if (!lower) return match;
    // &Eacute; is the capital of &eacute;.
    return code[0] === code[0].toUpperCase() && code.length > 2 ? lower.toUpperCase() : lower;
  });
}

function clean(text: string): string {
  return fixMojibake(decode(text.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim());
}

export function tokenize(html: string): Token[] {
  const body = html.replace(/<(head|style|script)\b[\s\S]*?<\/\1>/gi, "");
  const tokens: Token[] = [];
  const re = /<a\b[^>]*?href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>|<[^>]*>|([^<]+)/gi;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (m[1] !== undefined) {
      tokens.push({ type: "link", href: decode(m[1]), text: clean(m[2]) });
    } else if (m[3] !== undefined) {
      const text = clean(m[3]);
      if (text) tokens.push({ type: "text", text });
    }
  }
  return tokens;
}

function parseDate(text: string): number | undefined {
  if (!/\d{4}/.test(text)) return undefined;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : undefined;
}

const LABELS = new Set(["Name", "Saved on", "Added Time", "Creation Time", "Update Time", "Collection", "Username", "URL"]);

interface Segment {
  texts: string[];
  link: Token & { type: "link" };
  /** Text after the link, up to the next post link. */
  after: string[];
}

/** Splits the page into one segment per post link, with the text around it. */
function segments(tokens: Token[]): { segments: Segment[]; trailing: string[] } {
  const result: Segment[] = [];
  let texts: string[] = [];
  for (const token of tokens) {
    if (token.type === "link" && parsePostUrl(token.href)) {
      const segment = { texts, link: token, after: [] as string[] };
      result.push(segment);
      texts = segment.after;
    } else if (token.type === "text") {
      texts.push(token.text);
    }
  }
  // The text after a link belongs to it until the next link, and is also
  // the text before that next link. Keep both views.
  for (let i = 1; i < result.length; i++) result[i].texts = result[i - 1].after;
  return { segments: result, trailing: texts };
}

function authorBefore(texts: string[], link: Token & { type: "link" }): string | undefined {
  if (isUsername(link.text) && !parsePostUrl(link.text)) return link.text;
  for (let i = texts.length - 1; i >= 0; i--) {
    if (!LABELS.has(texts[i]) && isUsername(texts[i])) return texts[i];
  }
  return undefined;
}

export function parseSavedPostsHtml(html: string): ParsedPosts {
  const { segments: segs } = segments(tokenize(html));
  const bookmarks: Bookmark[] = segs.map(({ texts, link, after }) => {
    const ref = parsePostUrl(link.href)!;
    const bookmark: Bookmark = { id: ref.id, kind: ref.kind, url: ref.url };
    // The username sits just above the link, the date just below it.
    const author = authorBefore(texts.slice(-3), link);
    if (author) bookmark.author = author;
    for (const text of after) {
      const savedAt = parseDate(text);
      if (savedAt) {
        bookmark.savedAt = savedAt;
        break;
      }
    }
    return bookmark;
  });
  return { bookmarks, skipped: 0 };
}

/** The collection name in a run of text holding a header ("Collection", "Name", "Recipes", "Creation Time", ...). */
function headerName(texts: string[]): string | undefined {
  const marker = texts.findIndex((t) => t === "Collection" || t === "Creation Time");
  if (marker < 0) return undefined;
  for (let i = Math.max(0, marker - 2); i < texts.length - 1; i++) {
    if (texts[i] === "Name" && !LABELS.has(texts[i + 1])) return texts[i + 1];
  }
  const afterCollection = texts.indexOf("Collection");
  if (afterCollection >= 0 && afterCollection + 1 < texts.length && !LABELS.has(texts[afterCollection + 1])) {
    return texts[afterCollection + 1];
  }
  return undefined;
}

export function parseSavedCollectionsHtml(html: string): ParsedCollections {
  const { segments: segs, trailing } = segments(tokenize(html));
  const collections: ImportedCollection[] = [];
  const bookmarks: Bookmark[] = [];
  let current: ImportedCollection | null = null;
  let currentIds = new Set<string>();

  for (const { texts, link } of segs) {
    const name = headerName(texts);
    if (name || !current) {
      current = { name: name ?? "Untitled collection", items: [] };
      collections.push(current);
      currentIds = new Set();
    }
    const ref = parsePostUrl(link.href)!;
    if (!currentIds.has(ref.id)) {
      currentIds.add(ref.id);
      current.items.push(ref.id);
    }
    const bookmark: Bookmark = { id: ref.id, kind: ref.kind, url: ref.url };
    const author = authorBefore(texts.slice(-3), link);
    if (author) bookmark.author = author;
    bookmarks.push(bookmark);
  }
  // A collection with no posts has nothing after its header.
  const emptyName = headerName(trailing);
  if (emptyName) collections.push({ name: emptyName, items: [] });
  return { collections, bookmarks, skipped: 0 };
}
