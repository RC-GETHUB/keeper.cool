// Rebuilds CHANGELOG.md from the release tags (v0.4.1, …): every version with
// its date and what changed (the commit titles in it). Run by `npm run release`.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const tags = git("tag", "-l", "v*", "--sort=-v:refname").split("\n").filter(Boolean);
const lines = [
  "# Keeper versions",
  "",
  "Every version of Keeper (website + extension), newest first. Each one is a git tag, so the",
  "code can be looked at or restored exactly as it was, and its extension build is saved in",
  "`releases/keeper-extension-<version>.zip`. How to go back to one: see docs/HANDBOOK.md.",
  "",
];
tags.forEach((tag, i) => {
  const previous = tags[i + 1];
  const date = git("log", "-1", "--format=%ad", "--date=short", tag);
  const label = git("tag", "-l", "--format=%(contents:subject)", tag);
  const range = previous ? `${previous}..${tag}` : tag;
  const changes = git("log", "--format=%s", "--no-merges", range).split("\n").filter(Boolean);
  lines.push(`## ${tag.slice(1)} — ${date}${label && label !== `Keeper ${tag.slice(1)}` ? ` — ${label.replace(/^Keeper [\d.]+:?\s*/, "")}` : ""}`, "");
  for (const change of changes) lines.push(`- ${change}`);
  lines.push("");
});
writeFileSync(new URL("../CHANGELOG.md", import.meta.url), lines.join("\n"));
console.log(`CHANGELOG.md: ${tags.length} versions`);
