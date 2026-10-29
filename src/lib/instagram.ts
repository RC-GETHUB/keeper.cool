import type { PostKind } from "./types";

// Matches /p/, /reel/, /reels/ and /tv/ links, including the newer
// instagram.com/<username>/p/<code>/ form and instagr.am short links.
const POST_URL =
  /^(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\/(?:[A-Za-z0-9._]{1,30}\/)?(p|reels?|tv)\/([A-Za-z0-9_-]{5,})/i;

export interface PostRef {
  id: string;
  kind: PostKind;
  url: string;
}

export function parsePostUrl(raw: string): PostRef | null {
  const m = POST_URL.exec(raw.trim());
  if (!m) return null;
  const segment = m[1].toLowerCase();
  const kind: PostKind = segment === "p" ? "post" : segment === "tv" ? "tv" : "reel";
  const id = m[2];
  return { id, kind, url: postUrl(id, kind) };
}

export function postUrl(id: string, kind: PostKind): string {
  return `https://www.instagram.com/${kind === "post" ? "p" : kind}/${id}/`;
}

const USERNAME = /^[A-Za-z0-9._]{1,30}$/;

export function isUsername(value: string): boolean {
  return USERNAME.test(value) && !/^\.|\.$/.test(value);
}

/**
 * Meta's exports write UTF-8 bytes as if each were its own character
 * ("cafÃ©" for "café"). Undo that when the string is clearly affected,
 * and leave it alone otherwise.
 */
export function fixMojibake(value: string): string {
  if (!/[\u0080-ÿ]/.test(value) || /[^\u0000-ÿ]/.test(value)) return value;
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return value;
  }
}

/** Export timestamps are in seconds; everything in Keeper is in ms. */
export function toMs(timestamp: number): number {
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
}
