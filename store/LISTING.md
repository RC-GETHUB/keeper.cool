# Chrome Web Store listing: Keeper for Instagram

Everything to paste into the Chrome Web Store developer dashboard
(https://chrome.google.com/webstore/devconsole). Upload
`public/keeper-extension.zip` (built by `npm run build`, or download it from
https://keeper-cool.vercel.app/keeper-extension.zip).

## Store listing

**Name:** Keeper for Instagram

**Summary (max 132 characters):**
Sort, rename and tidy your Instagram saved posts in keeper.cool, then sync your new order back to Instagram.

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
**Support:** a support email address (needed; not set yet)

## Privacy practices tab

**Single purpose:**
Lets people organize their own Instagram saved posts in keeper.cool: it reads their saved posts and collections from their logged-in Instagram tab, and, when they ask, re-saves posts so Instagram's saved order matches the order they chose.

**Permission justifications:**
- `storage`: keeps the progress of a sync so it can resume after Chrome restarts.
- `alarms`: paces a sync (one post every 40–75 seconds) even while the extension's background worker sleeps.
- `scripting`: adds Keeper's helper to an instagram.com tab that was already open before the extension was installed.
- Host `https://www.instagram.com/*`: reads the user's saved posts and collections, and saves/unsaves posts when they choose to sync.
- Hosts `https://*.cdninstagram.com/*`, `https://*.fbcdn.net/*`: downloads cover images of the user's saved posts to make small thumbnails.

**Remote code:** No, the extension does not use remote code.

**Data usage (tick):**
- Website content: yes (the user's saved posts: links, captions, usernames, cover images)
- Everything else (personally identifiable info, health, financial, authentication, personal communications, location, web history, user activity): no

**Certify:** not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used for creditworthiness or lending.

**Privacy policy URL:** https://keeper-cool.vercel.app/privacy

## Before submitting

- Test on a spare Instagram account (import, then a small sync).
- Set "Visibility" to Unlisted for the first release if you'd like to test the store install before going public.
- After it's approved, replace the "Download keeper-extension.zip" steps on /extension with the store's "Add to Chrome" link.
