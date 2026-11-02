"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { InstagramAccount } from "@/lib/types";
import { fmtCount } from "./ui";

/** What's known so far about an import from Instagram. */
export interface LiveRead {
  account?: InstagramAccount;
  /** Saved posts read so far. */
  count: number;
  /** All saved posts on the account, when Instagram says. */
  total: number | null;
  /** Otherwise, how many the last import of this account found: shown as "about". */
  estimate?: number | null;
  collections?: { done: number; total: number; name?: string };
  /** Set while waiting to retry after Instagram was busy, in ms. */
  retryWait?: number;
}

/**
 * Counts smoothly up to `target` instead of jumping a page at a time, so a
 * long import looks as busy as it is. Jumps straight there when the user
 * prefers reduced motion.
 */
function useCountUp(target: number, duration = 1400): number {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = current.current;
    if (reduce || target <= from) {
      current.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      current.current = Math.round(from + (target - from) * k);
      setValue(current.current);
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

function timeLeft(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 1) return "Less than a minute left";
  if (minutes < 60) return `About ${minutes} min left`;
  return `About ${Math.round((ms / 3_600_000) * 2) / 2} hours left`;
}

export function ImportProgress({ live }: { live: LiveRead }) {
  const shown = useCountUp(live.count);
  const estimated = !live.total && Boolean(live.estimate);
  const known = live.total ?? live.estimate ?? null;
  const total = known ? Math.max(known, live.count) : null;
  const percent = total ? Math.min(100, (100 * shown) / total) : null;

  // Time left, from the pace since the first page arrived.
  const first = useRef<{ count: number; at: number } | null>(null);
  if (!first.current && live.count > 0) first.current = { count: live.count, at: Date.now() };
  const read = first.current ? live.count - first.current.count : 0;
  const elapsed = first.current ? Date.now() - first.current.at : 0;
  const eta = total && read >= 20 && elapsed > 0 ? ((total - live.count) * elapsed) / read : null;

  const collections = live.collections;
  const readingCollections = collections && collections.total > 0 && live.count > 0 && (!total || live.count >= total);

  return (
    <div className="space-y-2 text-sm" role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
        <Loader2 className="size-3.5 animate-spin text-accent" />
        {live.account ? `Connected to ${live.account.username ? `@${live.account.username}` : "Instagram"}` : "Connecting to Instagram…"}
      </p>

      <div>
        <p className="flex items-baseline justify-between gap-2">
          <span className="font-semibold tabular-nums" data-testid="import-count">
            {total
              ? `${fmtCount.format(shown)} of ${estimated ? "about " : ""}${fmtCount.format(total)} saved posts`
              : `${fmtCount.format(shown)} saved posts so far`}
          </span>
          {percent !== null && <span className="text-xs text-neutral-500 tabular-nums">{Math.floor(percent)}%</span>}
        </p>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          {percent !== null ? (
            <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
          ) : (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-accent/60" />
          )}
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          {eta !== null ? `${timeLeft(eta)} · ` : ""}Your library fills in as they arrive.
        </p>
      </div>

      {!readingCollections && collections && collections.total > 0 && (
        <p className="text-xs text-neutral-600 dark:text-neutral-400" data-testid="import-collections">
          {fmtCount.format(collections.total)} collections found. Their posts are matched up after the saved posts.
        </p>
      )}

      {readingCollections && collections && (
        <div>
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            Matching posts to collections: {fmtCount.format(collections.done)} of {fmtCount.format(collections.total)}
            {collections.name ? ` (${collections.name})` : ""}
          </p>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div className="h-full rounded-full bg-accent/70" style={{ width: `${(100 * collections.done) / collections.total}%` }} />
          </div>
        </div>
      )}

      {live.retryWait !== undefined && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Instagram is busy, so Keeper is waiting a moment. Trying again in {Math.max(1, Math.round(live.retryWait / 1000))} s…
        </p>
      )}
    </div>
  );
}
