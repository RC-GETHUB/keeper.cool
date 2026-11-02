# Chrome Web Store listing: Keeper – Saved Post Organizer

Everything to paste into the Chrome Web Store developer dashboard
(https://chrome.google.com/webstore/devconsole).

**Upload this zip:** https://keeper-cool.vercel.app/keeper-extension-store.zip
(the same extension, with manifest.json at the top of the zip and without the
localhost address used for development; built by `npm run build`).

**Pictures for the listing, in one zip:** https://keeper-cool.vercel.app/keeper-store-images.zip

## Store listing

**Name:** Keeper – Saved Post Organizer

(No "Instagram" in the name: stores reject names that use another company's trademark. The description says it works with Instagram.)

**Summary (max 132 characters):**
Sort, rename and tidy your Instagram saved posts in keeper.cool, then sync your new order back. Works with Instagram.

**Category:** Productivity · **Language:** English

**Description:**

Instagram keeps your saved posts in the order you saved them, with no way to rearrange, rename or search them. Keeper fixes that.

With the Keeper extension:
• Bring all your saved posts and collections into keeper.cool in one click, with cover images and captions
• Arrange them A–Z, by date, or by hand with drag and drop
• Rename posts, file them into collections, search everything and spot duplicates
• New saves show up in Keeper automatically
• Sync your new order back to Instagram when you're ready

Keeper uses the Instagram account you're already logged into in Chrome. It never sees your password, and your library stays in your browser.

Syncing works slowly and carefully (about one post a minute) and stops if Instagram asks it to slow down. Keeper is not affiliated with Instagram or Meta.

**Images:**
- Icon: `extension/icons/icon-128.png`
- Small promo tile (440×280): `store/promo-small-440x280.png`
- Screenshots (1280×800): `store/screenshot-*.png`

**Website:** https://keeper-cool.vercel.app (switch to https://keeper.cool once the domain is live)
**Support email:** rc@ryancramer.la (set in `src/lib/site.ts` for the site)
**Support URL:** https://keeper-cool.vercel.app/help

**Test instructions for the reviewer** (dashboard → Test instructions): "Install, open https://keeper-cool.vercel.app and log into any Instagram account in the same Chrome. Click Import → Import from Instagram → Start import. Saved posts appear in Keeper. Sync to Instagram only runs after ticking the consent box; please try it on a test account."

## Privacy practices tab

**Single purpose:**
Lets people organize their own Instagram saved posts in keeper.cool: it reads their saved posts and collections from their logged-in Instagram tab, and, when they ask, re-saves posts so Instagram's saved order matches the order they chose.

**Permission justifications:**
- `storage`: keeps the progress of an import or sync so it can carry on after Chrome restarts, and remembers the names of the user's own Instagram collections so they don't have to be read again.
- `alarms`: paces a sync (one post every 40–75 seconds) even while the extension's background worker sleeps.
- `scripting`: adds Keeper's helper to instagram.com and keeper.cool tabs that were already open before the extension was installed, and reads the collection names shown on the user's own Instagram Saved page.
- Host `https://www.instagram.com/*`: reads the user's saved posts and collections, and saves/unsaves posts when they choose to sync. A small script on instagram.com notices the names of the user's own collections in what Instagram's Saved page loads (some accounts can't ask for the list directly); it reads nothing else, changes nothing, and sends nothing anywhere.
- Hosts `https://*.cdninstagram.com/*`, `https://*.fbcdn.net/*`: downloads cover images of the user's saved posts to make small thumbnails.
- Hosts `https://keeper.cool/*`, `https://www.keeper.cool/*`, `https://keeper-cool.vercel.app/*`: connects the extension to the Keeper web app the user has open, including right after installing (no reload needed). `http://localhost:3000/*` is only for development and can be removed from the store build.

**Remote code:** No, the extension does not use remote code.

**Data usage (tick):**
- Personally identifiable information: yes (the user's own Instagram username and account id, kept on their device to keep each account's library apart)
- Website content: yes (the user's saved posts: links, captions, usernames, cover images)
- Everything else (health, financial, authentication, personal communications, location, web history, user activity): no

**Certify:** not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used for creditworthiness or lending.

**Privacy policy URL:** https://keeper-cool.vercel.app/privacy

## Before submitting

- Test on a spare Instagram account (import, then a small sync).
- Set "Visibility" to Unlisted for the first release if you'd like to test the store install before going public.
- After it's approved, replace the "Download keeper-extension.zip" steps in the install card (`src/components/ExtensionGuide.tsx`, also used by /extension) with the store's "Add to Chrome" link. Store installs update themselves, so the "download again and ↻" steps go away.
- Bump `version` in `extension/manifest.json` for every upload; the store refuses a version it has seen.
