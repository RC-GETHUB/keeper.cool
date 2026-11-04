# Keeper handbook

Everything a new person (or a new chat with an AI assistant) needs to pick up
Keeper where it was left. Keep it current: update it whenever something here
changes. The version history is in [../CHANGELOG.md](../CHANGELOG.md).

## What Keeper is

keeper.cool lets people organize their Instagram **saved posts**: bring them in,
sort them (by hand, A–Z, by date), rename them, file them into collections,
search, spot duplicates, and **export** the new order back to Instagram.

- Owner: Ryan Cramer (support email `rc@ryancramer.la`). Not a developer: explain
  in plain words, step by step, with exact clicks; ask for screenshots.
- Its own project, **separate from BoopStar** (same Vercel team and, later, the
  same Stripe account, nothing else shared).
- Product rules Ryan set: keep everything **simple and uniform** ("a 10-year-old
  with 3 Instagram accounts should manage"); everything inside the app (no stray
  windows); be transparent about what Keeper is doing; never lose data or
  progress (versions, backups, this handbook).

## Where things are

| What | Where |
| --- | --- |
| Code | GitHub `RC-GETHUB/keeper.cool`, branch `main` |
| Website | https://keeper-cool.vercel.app (Vercel project `keeper-cool`, team REMARCS TEAM, Pro plan). Every push to `main` deploys. The `keeper.cool` domain isn't connected yet. |
| Extension download (until the store) | https://keeper-cool.vercel.app/keeper-extension.zip (built from `extension/` by `npm run build`) |
| Chrome Web Store | Item "Keeper – Saved Post Organizer", submitted for review 2026-11-02 as version **0.3.9**, Unlisted, free. Listing texts and answers: [../store/LISTING.md](../store/LISTING.md). Upload file: `/keeper-extension-store.zip`; pictures: `/keeper-store-images.zip`. After approval: set Support URL to `/help`, check contact email, switch the install card to the store link, upload the current version. |
| Apple | Developer account active, Team ID 2T9UACJ42T. Ryan has a Mac (needed for the Safari / iPhone version). Notes: [../store/APPLE.md](../store/APPLE.md). App Store Connect API key is in GitHub repo secrets, never in chat or code. |
| Google Search Console | keeper-cool.vercel.app verified with `public/googlefffcc66a70051dde.html` (keep that file). |
| Secrets | Only in GitHub repo secrets / Vercel settings. Never in code, chat or commit messages. |

## How it works

- **Web app** (Next.js 15, React 19, Tailwind 4, TypeScript), `src/`. The library
  lives in the browser (IndexedDB via idb-keyval, `src/lib/storage.ts`), one library
  per Instagram account (`src/lib/libraries.ts`). Nothing is uploaded.
  - `src/lib/library/` — library operations (immutable; undo keeps 50 steps),
    sorting, search, duplicates.
  - `src/lib/import/` — reading Instagram's "Download your information" export (zip,
    JSON, HTML).
  - `src/lib/instagram-read.ts` — turning what the extension reads into a library.
  - `src/lib/push.ts` — planning an export (re-save the fewest posts).
  - `src/lib/extension.ts` — talking to the extension; the one Instagram window
    (log in / switch accounts).
  - `src/components/` — App (the main screen), ImportDialog, PushDialog (Export),
    Sidebar, BookmarkList, ExtensionGuide (install card), Help check, etc.
  - `src/lib/site.ts` — support email; `multiAccount()` (several accounts are built
    but hidden for now; tests turn them on with localStorage `keeper:multi-account`).
- **Chrome extension** (Manifest V3), `extension/`:
  - `instagram.js` runs in an instagram.com tab and makes Instagram's own web
    requests with the user's session (saved posts feed, collections, save/unsave,
    GraphQL for collection names).
  - `sniff.js` (page context, instagram.com) notices collection names and the
    GraphQL query ids in what Instagram's own pages load. Nothing else.
  - `background.js` runs imports (paced, resumable, retries Instagram's 5xx/572),
    makes cover thumbnails, runs exports one post every 40–75 s (≤120/hour,
    ≤500/day), and the "Run a check" report.
  - `bridge.js` connects Keeper's pages to the extension.

### What we learned about Instagram (real account @ryancramer, Nov 2026)

- ~4,400 saves readable live (the export file listed 5,119: deleted/private posts
  drop out). ~590 collections, ~110 with none of the readable posts in them.
- The plain collection list (`/api/v1/collections/list/`) answers **404** for this
  account. Collection names come from Instagram's own Saved-page GraphQL query
  instead: `PolarisProfileSavedTabContentQuery` (doc_id 27584326974521636) then
  `PolarisProfileSavedTabContentQuery_connection` (doc_id 27959320833754327,
  `after` cursor), with the page's `lsd`/`fb_dtsg` tokens. Instagram changes these
  ids; `sniff.js` records the current ones whenever the Saved page is opened, and
  the Saved page (in a small window) is the fallback.
- Each saved post lists its collection ids (`saved_collection_ids`), so collection
  membership comes with the posts.
- The username isn't in `users/<id>/info` for this account; it comes from
  `/api/v1/accounts/edit/web_form_data/`.
- Instagram can't be shown inside Keeper (it refuses to be embedded), so logging in
  or switching accounts uses one small Instagram window that Keeper closes itself.

## Working on it

```bash
npm install          # needs legacy-peer-deps (set in .npmrc)
npm run dev          # http://localhost:3000
npx tsc --noEmit     # types
npx vitest run       # unit tests
npm run build        # also packs the extension zips
node scripts/extension-e2e.mjs   # full test with the real extension against a fake Instagram (needs a build; ~4 min)
```

Before every push: types, unit tests, and the extension test must pass.

### Versions, going back, backups

- **One version number for everything** (website + extension), e.g. 0.4.2. Make a
  new one with `npm run release -- 0.4.3 "what it's about"`, then
  `git push origin main --tags`. That sets the version in `package.json` and
  `extension/manifest.json`, saves the extension build to `releases/`, tags it
  and updates CHANGELOG.md.
- **Look at or restore an old version**: every version is a git tag (`v0.3.9` …).
  - Old extension: `releases/keeper-extension-<version>.zip` (unzip, Load unpacked).
  - Old website: in Vercel → project keeper-cool → Deployments, pick the deployment
    of that version's commit → "Promote to Production" (instant rollback). Or in
    git: `git revert` the changes since that tag (don't rewrite history).
  - Code as it was: `git checkout v0.3.9` (read-only look), or a branch from it.
- **The user's own library** lives only in their browser: Keeper's "Download a
  backup" (bottom of the left menu) saves it as a file. Do this before big changes.
- GitHub keeps every commit; nothing pushed is lost.

### Conventions

- Plain, friendly wording in the app; the same words everywhere ("Import from
  Instagram", "Export to Instagram", "collections", "saved posts").
- Commits end with the co-author/session lines the assistant is given; no AI model
  names in commits or code.
- Don't open pull requests unless asked; work on `main` (this repo's convention).
- Don't test exports on Ryan's real account beyond a one-post test; use a test
  account (@rcctest) for bigger ones.

## Status and next steps (keep this list current)

Done recently (see CHANGELOG): import with collections in the background (0.4.0),
one Instagram window (0.4.1), one-account focus (0.4.2).

Next, in order:
1. **Clickable mockup** of the simpler design ("a 10-year-old with 3 accounts"):
   account picker with profile photos, Keeper switches Instagram accounts for you,
   three big buttons (Get my saves / Organize / Put back on Instagram), one status
   line, big Undo, extras under "More". Try it, then build it in.
2. Consistency pass: every dialog the same layout and words.
3. Ryan's one-post Export test on @ryancramer (Export only proven on the fake Instagram).
4. Chrome store approval → "Add to Chrome" link; upload the current version.
5. Keeper sign-in (Apple / Google / email link) and sync between devices; privacy page update first.
6. Safari for Mac + iPhone (same extension in an Xcode wrapper, on Ryan's Mac).
7. Imports that keep going with Keeper closed (needs notifications + unlimitedStorage permissions).
8. Exporting collections (order inside each, and of the collections).
9. Waitlist with influencer referral/coupon codes; Pro plan with Stripe; more platforms
   (TikTok, then X and LinkedIn); connect the keeper.cool domain (ask Ryan where it was bought).
