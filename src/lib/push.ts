import { codeToPk, type InstagramMedia } from "./instagram-read";

// Instagram shows saved posts newest-saved first and has no way to move
// one. The only lever is to unsave a post and save it again, which puts it
// on top. So to make Instagram match the order in Keeper:
//  - posts at the bottom of the Keeper order that are already in the right
//    order on Instagram are left alone;
//  - everything above them is re-saved, bottom-most first, so the last one
//    re-saved ends up on top.
// Unsaving also takes a post out of its collections, so each re-save puts
// the post back into the collections it was in.

export interface PushStep {
  code: string;
  mediaId: string;
  /** "resave" for posts already saved here; "save" for posts this account hasn't saved (copying a library to another account). */
  action: "resave" | "save";
  /** Instagram collection ids to put the post back into after re-saving. */
  collections: string[];
}

export interface PushPlan {
  /** In the order to run them. */
  steps: PushStep[];
  /** Posts already in the right place, left untouched. */
  unchanged: number;
  /** Posts in Keeper that aren't saved on this account and won't be saved (see `saveMissing`). */
  notSaved: string[];
  /** Posts saved on Instagram that aren't in Keeper. They stay saved and end up below the re-saved posts. */
  onlyOnInstagram: number;
  /** Total Instagram actions (unsave, save, add to collection). */
  actions: number;
}

export interface PlanOptions {
  /** Save posts this account hasn't saved yet, instead of skipping them. Used when copying a library to another account. */
  saveMissing?: boolean;
  /** Posts to save even though this account hasn't saved them (copied in from another account's library). */
  saveCodes?: Set<string>;
  /** Media ids Keeper already knows, by shortcode; used before working one out from the shortcode. */
  mediaIds?: Map<string, string>;
}

/**
 * @param target Keeper's order, top first (shortcodes).
 * @param current What's saved on Instagram right now, newest first.
 */
export function planPush(target: string[], current: InstagramMedia[], options: PlanOptions = {}): PushPlan {
  const position = new Map(current.map((m, i) => [m.code, i]));
  const media = new Map(current.map((m) => [m.code, m]));
  const notSaved: string[] = [];
  const order: string[] = [];
  for (const code of new Set(target)) {
    if (position.has(code) || options.saveMissing || options.saveCodes?.has(code)) order.push(code);
    else notSaved.push(code);
  }

  // Walk up from the bottom while each post sits above the one below it on
  // Instagram too. Those can stay where they are.
  let below = Infinity;
  let firstKept = order.length;
  for (let i = order.length - 1; i >= 0; i--) {
    const at = position.get(order[i]);
    if (at === undefined || at >= below) break;
    below = at;
    firstKept = i;
  }

  const steps: PushStep[] = [];
  for (let i = firstKept - 1; i >= 0; i--) {
    const code = order[i];
    const existing = media.get(code);
    steps.push({
      code,
      mediaId: existing?.pk ?? options.mediaIds?.get(code) ?? codeToPk(code),
      action: existing ? "resave" : "save",
      collections: existing?.collectionIds ?? [],
    });
  }

  const inTarget = new Set(target);
  return {
    steps,
    unchanged: order.length - firstKept,
    notSaved,
    onlyOnInstagram: current.filter((m) => !inTarget.has(m.code)).length,
    actions: steps.reduce((n, s) => n + (s.action === "resave" ? 2 : 1) + s.collections.length, 0),
  };
}

/**
 * The pace the extension keeps when changing things on Instagram. Slow on
 * purpose: bursts of saves are what get accounts temporarily blocked.
 * Keep in step with PACE in extension/background.js.
 */
export const PACE = {
  /** Seconds between posts. */
  secondsBetweenPosts: [40, 75] as const,
  maxActionsPerHour: 120,
  maxActionsPerDay: 500,
};

/** Rough time to run a plan, in ms, allowing for the hourly and daily limits. */
export function estimateDuration(plan: PushPlan): number {
  if (plan.steps.length === 0) return 0;
  const [min, max] = PACE.secondsBetweenPosts;
  const perPost = ((min + max) / 2) * 1000;
  const actionsPerPost = plan.actions / plan.steps.length;
  const postsPerHour = Math.min(3_600_000 / perPost, PACE.maxActionsPerHour / actionsPerPost);
  const postsPerDay = PACE.maxActionsPerDay / actionsPerPost;
  const fullDays = Math.floor(plan.steps.length / postsPerDay);
  const rest = plan.steps.length - fullDays * postsPerDay;
  return fullDays * 86_400_000 + (rest / postsPerHour) * 3_600_000;
}

export function formatDuration(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round((ms / 86_400_000) * 2) / 2;
  return `${days} day${days === 1 ? "" : "s"}`;
}
