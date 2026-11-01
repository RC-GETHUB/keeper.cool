# Apple (Safari extension for iPhone, iPad and Mac)

Planned after the desktop extension test and accounts.

- **Team ID:** 2T9UACJ42T
- **Bundle IDs (to register):**
  - App: `cool.keeper.app`
  - Safari extension inside it: `cool.keeper.app.extension`
- **App name:** "Keeper – Saved Post Organizer" (no "Instagram" in the name; say "works with Instagram" in the description)
- **Build:** on Ryan's Mac with Xcode. Convert `extension/` with
  `xcrun safari-web-extension-converter extension --app-name "Keeper" --bundle-identifier cool.keeper.app`,
  then run on a plugged-in iPhone (and in Safari on the Mac) for testing; TestFlight and App Store uploads from Xcode.
  The same build covers Safari on iPhone, iPad and Mac.

## Secrets: only needed for automated builds later (GitHub → Settings → Secrets and variables → Actions; never in chat or the repo)

- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_KEY` (contents of the .p8 file)

Created in App Store Connect → Users and Access → Integrations → App Store Connect API, role App Manager.

## Still to decide

- Individual or Organization membership (decides the seller name on the App Store)
- Support email for the listing
