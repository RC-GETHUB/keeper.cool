"use client";

import { Film, Image as ImageIcon, Tv } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Bookmark } from "@/lib/types";

export const fmtCount = new Intl.NumberFormat("en");
const fmtDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

export function formatDate(ms: number): string {
  return fmtDate.format(ms);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmtCount.format(n)} ${n === 1 ? one : many}`;
}

/**
 * A text field that edits in place. Enter or leaving the field saves,
 * Escape cancels. `onSave` returns an error message to keep editing.
 */
export function InlineEdit({
  value,
  placeholder,
  onSave,
  onCancel,
  className = "",
}: {
  value: string;
  placeholder?: string;
  onSave: (value: string) => string | null | void;
  onCancel: () => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const save = () => {
    if (done.current) return;
    const problem = onSave(draft);
    if (problem) {
      setError(problem);
      ref.current?.focus();
      return;
    }
    done.current = true;
  };

  return (
    <div className={`min-w-0 ${className}`} onClick={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        value={draft}
        placeholder={placeholder}
        maxLength={200}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            done.current = true;
            onCancel();
          }
          e.stopPropagation();
        }}
        onBlur={() => {
          // Clicking away saves; if the value can't be saved, drop the edit.
          if (done.current) return;
          done.current = true;
          if (onSave(draft)) onCancel();
        }}
        aria-invalid={!!error}
        className="w-full rounded-md border border-accent bg-white px-2 py-1 text-sm outline-none ring-2 ring-accent/20 dark:bg-neutral-900"
      />
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

const TILE_COLORS = ["#f97362", "#f59e0b", "#10b981", "#06b6d4", "#6366f1", "#a855f7", "#ec4899", "#84cc16"];

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** The post's image when we have one, otherwise a tile in the author's colour. */
export function Thumb({ bookmark }: { bookmark: Bookmark }) {
  const [failed, setFailed] = useState(false);
  const Icon = bookmark.kind === "reel" ? Film : bookmark.kind === "tv" ? Tv : ImageIcon;
  if (bookmark.thumbnailUrl && !failed) {
    return (
      <div className="relative size-16 shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={bookmark.thumbnailUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-16 rounded-lg object-cover"
        />
        {bookmark.kind !== "post" && (
          <Icon className="absolute right-1 bottom-1 size-3.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" aria-hidden />
        )}
      </div>
    );
  }
  const seed = bookmark.author ?? bookmark.id;
  return (
    <div
      className="relative flex size-16 shrink-0 items-center justify-center rounded-lg text-xl font-semibold text-white"
      style={{ background: TILE_COLORS[hash(seed) % TILE_COLORS.length] }}
      aria-hidden
    >
      {(bookmark.author?.[0] ?? "#").toUpperCase()}
      <Icon className="absolute right-1 bottom-1 size-3.5 opacity-80" />
    </div>
  );
}

/** A small menu that closes on outside click or Escape. */
export function Popover({
  open,
  onClose,
  children,
  align = "left",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: "left" | "right";
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      className={`absolute top-full z-30 mt-1 max-h-80 w-64 overflow-auto rounded-xl border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900 ${align === "right" ? "right-0" : "left-0"}`}
    >
      {children}
    </div>
  );
}

export const buttonClass =
  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40";
export const ghostButton = `${buttonClass} text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800`;
export const primaryButton = `${buttonClass} bg-accent text-white hover:bg-accent/90`;
export const menuItem =
  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800";
