# Keeper versions

Every version of Keeper (website + extension), newest first. Each one is a git tag, so the
code can be looked at or restored exactly as it was, and its extension build is saved in
`releases/keeper-extension-<version>.zip`. How to go back to one: see docs/HANDBOOK.md.

## 0.4.1 — 2026-11-04

- One Instagram window, never left behind (extension 0.4.1)

## 0.4.0 — 2026-11-04

- Export: switch to the library's account instead of copying everything by accident
- "Add another account" switches Instagram accounts; Export shows on narrower windows
- Hide empty Instagram collections, with a switch to show them
- Keep the menu's footer in view; only the collections scroll
- Extension 0.4.0: read collections in the background, no window

## 0.3.9 — 2026-11-03

- Run a check from the Help page, any time
- Import from Instagram / Export to Instagram buttons
- Help page and support email
- Privacy page: say Keeper stores each imported account's username and number
- Store notes: declare the Instagram username/account id as personal info
- Google Search Console verification file for keeper-cool.vercel.app
- Click a post to open it; Chrome Web Store upload and listing images
- Import progress in the tab title; store and privacy notes brought up to date
- Quicker second imports and a simpler start on phones
- Extension 0.3.9: open the Saved page only when a collection has no name yet

## 0.3.8 — 2026-11-02

- Install guide floats over Keeper; extension connects without a reload

## 0.3.7 — 2026-11-02

- Extension 0.3.7: leave out collection names that aren't the account's

## 0.3.6 — 2026-11-02

- Extension 0.3.6: find collection names from the Saved page's own data

## 0.3.5 — 2026-11-02

- Confirm which Instagram account to import before reading
- Extension 0.3.5: get collections when Instagram won't name the account

## 0.3.4 — 2026-11-02

- Extension 0.3.4: find the username other ways, so the Saved page is read

## 0.3.3 — 2026-11-02

- Import progress: a gliding back-and-forth bar when the total is unknown
- Extension 0.3.3: "of about N" and the collection count while importing

## 0.3.2 — 2026-11-01

- Extension 0.3.2: collections from the Saved page, and a Run a check button

## 0.3.1 — 2026-11-01

- Extension 0.3.1: don't let the collection list stop an import

## 0.3.0 — 2026-11-01

- Extension 0.3.0: library fills in while importing, live progress, faster

## 0.2.4 — 2026-11-01

- Extension 0.2.4: wait and retry when Instagram is busy (its 572)

## 0.2.3 — 2026-11-01

- Extension 0.2.3: recover from updates, send Instagram's request headers

## 0.2.1 — 2026-11-01

- Extension 0.2.1: gentler reads, resumable imports, Instagram's reply shown

## 0.2.0 — 2026-11-01

- Name the extension "Keeper – Saved Post Organizer"
- store/APPLE.md: build on Ryan's Mac with Xcode
- store: Apple Team ID and plan for the Safari extension
- One library per Instagram account, and copying saves between accounts
- README: next steps; drop the blank preview screenshot
- Chrome Web Store prep: icons, privacy policy, listing, screenshots

## 0.1.0 — 2026-10-29

- Simpler for everyday users: one sort menu, Sync, auto-refresh, New flags
- Tests: match the bookmark sort menu exactly (a collection sort menu exists now)
- Drag bookmarks into collections, restore Instagram's order, better dates
- Collections: drag to reorder, sort A-Z/Z-A/newest/oldest/size, keep order
- Keeper extension: one-click import with covers, and Push to Instagram
- Preview panel: see the actual post inside Keeper
- Import: step-by-step export settings and a Last-year warning
- Import steps: where Settings is on instagram.com
- Import steps: match Instagram's current export flow
- README: link the live site
- In-page confirmations, theme override, ids without HTTPS
- Keeper phase 1: import, organize and benchmark Instagram saves
