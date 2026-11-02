// Zips extension/ into public/keeper-extension.zip so the site can offer it
// for download while the extension isn't in the Chrome Web Store yet.
// Runs before `next dev` and `next build`.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { zipSync } from "fflate";

const root = new URL("..", import.meta.url).pathname;
const source = join(root, "extension");
const files = {};
const add = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) add(path);
    else files[`keeper-extension/${relative(source, path)}`] = readFileSync(path);
  }
};
add(source);
mkdirSync(join(root, "public"), { recursive: true });
writeFileSync(join(root, "public", "keeper-extension.zip"), zipSync(files, { level: 9 }));
const { version } = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
console.log(`Packed extension ${version} (${Object.keys(files).length} files) into public/keeper-extension.zip`);

// The Chrome Web Store upload: manifest.json at the top of the zip, and
// without localhost (only used while developing Keeper).
const store = {};
for (const [path, data] of Object.entries(files)) {
  const inner = path.replace(/^keeper-extension\//, "");
  if (inner !== "manifest.json") {
    store[inner] = data;
    continue;
  }
  const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
  const local = (m) => !m.startsWith("http://localhost");
  manifest.host_permissions = manifest.host_permissions.filter(local);
  for (const script of manifest.content_scripts) script.matches = script.matches.filter(local);
  store[inner] = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + "\n");
}
writeFileSync(join(root, "public", "keeper-extension-store.zip"), zipSync(store, { level: 9 }));
console.log(`Packed the Chrome Web Store upload into public/keeper-extension-store.zip`);

// The listing's pictures in one download: icon, promo tile and screenshots.
const images = { "icon-128.png": readFileSync(join(source, "icons", "icon-128.png")) };
for (const name of readdirSync(join(root, "store"))) {
  if (name.endsWith(".png")) images[name] = readFileSync(join(root, "store", name));
}
writeFileSync(join(root, "public", "keeper-store-images.zip"), zipSync(images, { level: 0 }));
console.log(`Packed ${Object.keys(images).length} listing images into public/keeper-store-images.zip`);
