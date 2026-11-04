# Keeper (keeper.cool)

Read [docs/HANDBOOK.md](docs/HANDBOOK.md) first: what Keeper is, where everything
lives, how it works, what we learned about Instagram, how to test, how versions and
backups work, and the current next steps. Version history: [CHANGELOG.md](CHANGELOG.md).

Ground rules:
- The owner isn't a developer: plain words, exact clicks, ask for screenshots.
- Keep the app simple and uniform; everything inside the app; say what's happening.
- Never lose data or progress: run types, unit tests and `node scripts/extension-e2e.mjs`
  before pushing; release with `npm run release -- <version> "<label>"` and push tags.
- Keep docs/HANDBOOK.md current when something changes.
- Secrets never go in code, chat or commits.
