import { postUrl } from "./instagram";
import type { Bookmark, ImportResult, PostKind } from "./types";

// Made-up libraries for benchmarks, tests and the "try a sample" button.
// Seeded, so the same size always gives the same library.

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const ADJECTIVES = ["easy", "crispy", "cozy", "minimal", "vintage", "quick", "spicy", "golden", "tiny", "bold", "sunny", "rainy", "lazy", "perfect", "secret"];
const NOUNS = ["pasta", "living room", "sneakers", "sunset", "workout", "latte art", "garden", "road trip", "haircut", "bookshelf", "tacos", "skincare", "studio", "cabin", "sourdough", "café crawl"];
const EMOJI: Record<string, string> = {
  pasta: "🍝", "living room": "🛋️", sneakers: "👟", sunset: "🌅", workout: "🏋️", "latte art": "☕", garden: "🌿", "road trip": "🚐",
  haircut: "💇", bookshelf: "📚", tacos: "🌮", skincare: "🧴", studio: "🎨", cabin: "🏡", sourdough: "🍞", "café crawl": "🥐",
};
const GRADIENTS = [["#ffb199", "#ff0844"], ["#a1c4fd", "#c2e9fb"], ["#d4fc79", "#96e6a1"], ["#fbc2eb", "#a6c1ee"], ["#fddb92", "#d1fdff"], ["#f6d365", "#fda085"], ["#84fab0", "#8fd3f4"], ["#cfd9df", "#e2ebf0"]];

/**
 * A small illustrated cover for sample posts, so the sample looks like a real
 * library. Each is unique (the <desc>), so only reposts match as look-alikes.
 */
function sampleCover(noun: string, seed: number): string {
  const [a, b] = GRADIENTS[seed % GRADIENTS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 112"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="112" height="112" fill="url(#g)"/><text x="56" y="70" font-size="46" text-anchor="middle">${EMOJI[noun] ?? "📌"}</text><desc>${seed}</desc></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
const EXTRAS = ["you need to try this", "saving this for later", "step by step", "in 10 minutes", "on a budget", "that changed my life", "for beginners", "full tutorial below", "weekend vibes", "game changer"];
const HANDLES = ["chef.maria", "dailyinteriors", "run_with_sam", "the.plant.lady", "urbanframes", "lisa.makes", "tokyo_eats", "coffee.lab", "minimal.homes", "jo_travels", "fitwithkai", "bakeclub", "streetstyle.daily", "olstudio", "ana.draws"];
const COLLECTIONS = ["Recipes", "Home ideas", "Travel", "Workouts", "Outfits", "Art", "Coffee", "Skincare", "Gifts", "Hair", "Garden", "Books"];

function pick<T>(rand: () => number, list: T[]): T {
  return list[Math.floor(rand() * list.length)];
}

function code(rand: () => number): string {
  let s = "";
  for (let i = 0; i < 11; i++) s += CODE_CHARS[Math.floor(rand() * 64)];
  return s;
}

export interface SyntheticOptions {
  seed?: number;
  collections?: number;
  /** Share of posts that are reposts of an earlier caption. */
  repostRate?: number;
  /** Give posts illustrated covers (for the in-app sample). */
  covers?: boolean;
}

/** A library as the extension would import it, with captions. */
export function syntheticImport(size: number, options: SyntheticOptions = {}): ImportResult {
  const rand = rng(options.seed ?? 42);
  const collectionCount = Math.min(options.collections ?? 8, COLLECTIONS.length);
  const repostRate = options.repostRate ?? 0.02;
  const now = Date.UTC(2026, 9, 1);
  const bookmarks: Bookmark[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < size; i++) {
    let id = code(rand);
    while (ids.has(id)) id = code(rand);
    ids.add(id);
    const kind: PostKind = rand() < 0.35 ? "reel" : "post";
    const repost = i > 10 && rand() < repostRate ? bookmarks[Math.floor(rand() * bookmarks.length)] : null;
    const noun = pick(rand, NOUNS);
    const caption = repost ? repost.caption : `${pick(rand, ADJECTIVES)} ${noun} ${pick(rand, EXTRAS)} #${pick(rand, NOUNS).replace(" ", "")}`;
    bookmarks.push({
      id,
      kind,
      url: postUrl(id, kind),
      author: pick(rand, HANDLES),
      caption,
      thumbnailUrl: options.covers ? (repost?.thumbnailUrl ?? sampleCover(noun, i)) : undefined,
      // Newest first, a few hours apart.
      savedAt: now - i * 3_600_000 * (1 + Math.floor(rand() * 6)),
    });
  }
  const collections = COLLECTIONS.slice(0, collectionCount).map((name) => ({ name, items: [] as string[] }));
  if (collections.length) {
    for (const b of bookmarks) {
      const r = rand();
      if (r < 0.55) collections[Math.floor(rand() * collections.length)].items.push(b.id);
      if (r < 0.04) collections[Math.floor(rand() * collections.length)].items.push(b.id);
    }
    for (const c of collections) c.items = [...new Set(c.items)];
  }
  return { bookmarks, collections, mergedDuplicates: 0, skipped: 0, warnings: [] };
}

/** The same library written out as Instagram's JSON export files. */
export function syntheticExport(size: number, options: SyntheticOptions = {}): { posts: string; collections: string } {
  const data = syntheticImport(size, options);
  const byId = new Map(data.bookmarks.map((b) => [b.id, b]));
  const seconds = (ms?: number) => Math.floor((ms ?? 0) / 1000);
  const posts = {
    saved_saved_media: data.bookmarks.map((b) => ({
      title: b.author,
      string_map_data: { "Saved on": { href: b.url, timestamp: seconds(b.savedAt) } },
    })),
  };
  const collections = {
    saved_saved_collections: data.collections.flatMap((c) => [
      {
        title: "Collection",
        string_map_data: {
          Name: { value: c.name },
          "Creation Time": { timestamp: 1_600_000_000 },
          "Update Time": { timestamp: 1_700_000_000 },
        },
      },
      ...c.items.map((id) => ({
        title: byId.get(id)!.author,
        string_map_data: {
          Name: { value: byId.get(id)!.author, href: byId.get(id)!.url },
          "Added Time": { timestamp: seconds(byId.get(id)!.savedAt) },
        },
      })),
    ]),
  };
  return { posts: JSON.stringify(posts), collections: JSON.stringify(collections) };
}
