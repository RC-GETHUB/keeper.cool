"use client";

import { ChevronLeft, ChevronRight, ExternalLink, FolderOpen, X } from "lucide-react";
import { useEffect } from "react";
import { displayName, kindLabel } from "@/lib/library/query";
import type { Bookmark } from "@/lib/types";
import { formatDate } from "./ui";

interface Props {
  bookmark: Bookmark;
  collections: string[];
  /** Position in the current list, for the previous/next buttons. */
  index: number;
  count: number;
  onStep: (delta: number) => void;
  onClose: () => void;
}

function embedUrl(bookmark: Bookmark): string {
  const segment = bookmark.kind === "post" ? "p" : bookmark.kind;
  return `https://www.instagram.com/${segment}/${bookmark.id}/embed/captioned/`;
}

/**
 * Shows the post itself through Instagram's public embed, so a bookmark can
 * be recognised even when the import had no image or caption. Private posts
 * and posts with embedding turned off show Instagram's own "unavailable" card.
 */
export function PreviewPanel({ bookmark, collections, index, count, onStep, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" || e.key === "k") onStep(-1);
      else if (e.key === "ArrowRight" || e.key === "j") onStep(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onStep]);

  const name = displayName(bookmark);
  const details = [bookmark.author && `@${bookmark.author}`, kindLabel(bookmark), bookmark.savedAt && `Saved ${formatDate(bookmark.savedAt)}`]
    .filter(Boolean)
    .join(" · ");
  const navButton =
    "rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-30 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={onClose} />
      <aside
        aria-label="Preview"
        className="fixed inset-x-0 bottom-0 z-40 flex h-[85dvh] flex-col rounded-t-2xl border-neutral-200 bg-white shadow-xl lg:static lg:z-auto lg:h-auto lg:w-[400px] lg:shrink-0 lg:rounded-none lg:border-l lg:shadow-none dark:border-neutral-800 dark:bg-neutral-950"
      >
        <div className="flex items-start gap-2 border-b border-neutral-200 p-3 dark:border-neutral-800">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold" title={name}>
              {name}
            </p>
            <p className="truncate text-xs text-neutral-500">{details}</p>
            {collections.length > 0 && (
              <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-neutral-500">
                <FolderOpen className="size-3 shrink-0" /> {collections.join(", ")}
              </p>
            )}
          </div>
          <button type="button" className={navButton} onClick={() => onStep(-1)} disabled={index <= 0} aria-label="Previous" title="Previous (←)">
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" className={navButton} onClick={() => onStep(1)} disabled={index >= count - 1} aria-label="Next" title="Next (→)">
            <ChevronRight className="size-4" />
          </button>
          <a href={bookmark.url} target="_blank" rel="noreferrer" className={navButton} aria-label="Open on Instagram" title="Open on Instagram">
            <ExternalLink className="size-4" />
          </a>
          <button type="button" className={navButton} onClick={onClose} aria-label="Close preview" title="Close (Esc)">
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-50 p-3 dark:bg-neutral-900">
          <iframe
            key={bookmark.id}
            src={embedUrl(bookmark)}
            title={`Instagram post ${name}`}
            className="mx-auto block h-[640px] w-full max-w-[380px] rounded-lg border-0 bg-white"
            loading="lazy"
            allowFullScreen
          />
        </div>
      </aside>
    </>
  );
}
