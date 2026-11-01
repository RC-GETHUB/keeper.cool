# Apple (Safari extension for iPhone, iPad and Mac)

Planned after the desktop extension test and accounts.

- **Team ID:** 2T9UACJ42T
- **Bundle IDs (to register):**
  - App: `cool.keeper.app`
  - Safari extension inside it: `cool.keeper.app.extension`
- **App name:** "Keeper – Saved Post Organizer" (no "Instagram" in the name; say "works with Instagram" in the description)
- **Build:** converted from `extension/` with Xcode's Safari web extension converter, built and signed on a macOS build server (GitHub Actions) or a Mac, installed for testing through TestFlight.

## Secrets (GitHub → Settings → Secrets and variables → Actions; never in chat or the repo)

- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_KEY` (contents of the .p8 file)

Created in App Store Connect → Users and Access → Integrations → App Store Connect API, role App Manager.

## Still to decide

- Individual or Organization membership (decides the seller name on the App Store)
- Build on a Mac, or on GitHub's macOS servers
- Support email for the listing
