# keeper.cool

Sort, rename and tidy your Instagram saved posts.

**Live:** https://keeper-cool.vercel.app (Vercel project `keeper-cool` in the
REMARCS TEAM team; every push to `main` deploys).

Instagram keeps saves in the order you saved them and gives you no way to
rearrange, rename or search them. Keeper brings your saves in, lets you
organize them, and (next phase) pushes the new order and collections back to
Instagram.

## What works now (phase 1)

- **Import** Instagram's "Download your information" export: the zip as-is
  (only the saved files are read out of it, even from a multi-GB export), or
  the `saved_posts` / `saved_collections` files in JSON or HTML.
- **Sort** by custom order (drag and drop, or ↑/↓ on the handle), name A–Z /
  Z–A, newest or oldest saved. **Keep this order** turns any sort into the
  custom order.
- **Collections**: create, rename, delete, add to, remove from. Counts for
  every collection, plus the total and "Not in a collection".
- **Rename** any bookmark (Keeper-only; Instagram has no bookmark names).
- **Search** names, captions and @usernames, ignoring case and accents.
- **Possible duplicates**: posts filed in several collections, and different
  posts that look like the same content (same caption or same image).
- Multi-select (shift-click for ranges), move to top/bottom, undo (⌘/Ctrl Z),
  backup download.
- Works on phones and desktop. The library is kept in the browser
  (IndexedDB), so nothing leaves the device yet.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

No account or keys are needed. Use "Try 10,000 sample bookmarks" on the
welcome screen to explore without an export.

| Command | What it does |
|---|---|
| `npm test` | Unit tests (import parsing, library operations, search, duplicates) |
| `npm run typecheck` | TypeScript |
| `npm run bench` | Speed of the core operations at 10k and 50k bookmarks |
| `npm run build && npm run bench:ui` | Drives the real app in Chromium and times what users feel |

## Benchmarks

Measured in this repo's cloud dev container (headless Chromium, no GPU), so
real devices will differ; the point is the relative cost and how it grows.

**Core operations** (`npm run bench`, mean per call):

| | 10,000 | 50,000 |
|---|---|---|
| Parse Instagram export JSON | 85 ms | 350 ms |
| Sort A–Z | 7 ms | 60 ms |
| Sort newest | 7 ms | 41 ms |
| Search | 2 ms | 13–18 ms |
| Find duplicates | 10 ms | 78 ms |
| Drag one bookmark | 0.2 ms | 2 ms |
| Rename one bookmark | 4 ms | 28 ms |

**In the browser** (`npm run bench:ui`, from action to screen updated):

| | 10,000 | 50,000 |
|---|---|---|
| Import a zip (with 2 MB of media in it) | 0.55 s | 1.2 s |
| Search | 45 ms | 130–180 ms |
| Sort A–Z | 49 ms | 244 ms |
| Rename | 76 ms | 140 ms |
| Reopen the page (load from storage) | 0.13 s | 0.24 s |
| Scrolling | 60 fps | ~50 fps |
| Memory (JS heap) | 40 MB | 68 MB |

Only the rows on screen are rendered, so scrolling cost doesn't grow with
library size. Most people have hundreds to a few thousand saves; 50,000 is a
stress test.

## How it's built

- Next.js 15, React 19, Tailwind 4, TypeScript.
- `src/lib/import/`: export parsing. The JSON reader walks each entry for
  links, timestamps and labels instead of trusting one schema, because Meta
  has changed the layout more than once. It also repairs Meta's
  double-encoded UTF-8 ("cafÃ©" → "café"). The zip reader reads the zip's
  index and pulls out only the saved files.
- `src/lib/library/`: the library model and every operation (pure functions
  that return a new library, which is what makes undo free), sorting,
  search and duplicate detection.
- `src/components/`: the UI. `BookmarkList` virtualizes rows and does its
  own drag and drop with pointer events, so it works with touch and with
  50,000 rows.

## Not verified yet

The importer is built from Meta's documented export layouts and tested
against hand-made samples. It needs a run against a real, current export
(JSON and HTML) before launch.

## The browser extension

`extension/` is a Chrome extension (Manifest V3, plain JavaScript, no build
step). Until it's in the Chrome Web Store, the site serves it as
`/keeper-extension.zip` (packed by `scripts/pack-extension.mjs` before every
dev run and build) with install steps at `/extension`.

- **Import** reads the user's saved posts and collections from their own
  logged-in instagram.com tab, using the same requests Instagram's web app
  makes, then makes ~4 KB cover images so they never expire.
- **Push** makes Instagram's saved order match Keeper's. Instagram can't move
  a saved post, so the plan (`src/lib/push.ts`) re-saves the fewest posts
  needed, bottom-most first, and puts each back in its collections. The
  extension runs it slowly (40–75 s per post, at most 120 actions an hour and
  500 a day), survives Chrome restarts, and stops on the first sign of a block.
- Pages talk to it through `extension/bridge.js`, which only runs on Keeper's
  own origins.

`node scripts/extension-e2e.mjs` (after `npm run build`) loads the extension
into Chromium against a fake Instagram and checks import, cover images, a
one-post push and a full A–Z push.

## Next

1. Test the extension on a real (spare) Instagram account.
2. Push the order of posts within collections, and collection order.
3. **Accounts and sync**: sign-in and a server copy of the library.
4. **Payments**: Stripe; a free tier with a bookmark cap, paid plans for
   unlimited bookmarks and push-back.
