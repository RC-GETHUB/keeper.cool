// Makes a new Keeper version, the same number for the website and the extension:
//   npm run release -- 0.4.3 "What this version is about"
// It sets the version in package.json and extension/manifest.json, saves the
// extension build to releases/, commits, tags v<version> and rebuilds CHANGELOG.md.
// Then push with: git push origin main --tags
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

const [version, ...words] = process.argv.slice(2);
const label = words.join(" ").trim();
if (!/^\d+\.\d+\.\d+$/.test(version || "") || !label) {
  console.error('Usage: npm run release -- 0.4.3 "What this version is about"');
  process.exit(1);
}
const root = new URL("..", import.meta.url).pathname;
const run = (cmd, ...args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit" });
const setVersion = (file) => {
  const path = `${root}${file}`;
  const json = JSON.parse(readFileSync(path, "utf8"));
  json.version = version;
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
};
setVersion("package.json");
setVersion("extension/manifest.json");
run("node", "scripts/pack-extension.mjs");
copyFileSync(`${root}public/keeper-extension.zip`, `${root}releases/keeper-extension-${version}.zip`);
run("git", "add", "package.json", "extension/manifest.json", `releases/keeper-extension-${version}.zip`);
run("git", "commit", "-q", "-m", `Keeper ${version}: ${label}`);
run("git", "tag", "-a", `v${version}`, "-m", `Keeper ${version}: ${label}`);
run("node", "scripts/changelog.mjs");
run("git", "add", "CHANGELOG.md");
run("git", "commit", "-q", "-m", `Changelog for ${version}`);
console.log(`\nKeeper ${version} is tagged. Push it with: git push origin main --tags`);
