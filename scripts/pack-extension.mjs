// Zips extension/ into public/keeper-extension.zip so the site can offer it
// for download while the extension isn't in the Chrome Web Store yet.
// Runs before `next dev` and `next build`.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";

const root = new URL("..", import.meta.url).pathname;
const source = join(root, "extension");
const files = {};
for (const name of readdirSync(source)) files[`keeper-extension/${name}`] = readFileSync(join(source, name));
mkdirSync(join(root, "public"), { recursive: true });
writeFileSync(join(root, "public", "keeper-extension.zip"), zipSync(files, { level: 9 }));
const { version } = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
console.log(`Packed extension ${version} (${Object.keys(files).length} files) into public/keeper-extension.zip`);
