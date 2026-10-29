"use client";

import { Copy, ExternalLink, FolderOpen, GripVertical, Pencil } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DuplicateReport } from "@/lib/library/duplicates";
import { displayName, kindLabel } from "@/lib/library/query";
import type { Bookmark, Library } from "@/lib/types";
import { InlineEdit, Thumb, formatDate, plural } from "./ui";

const ROW = 64;
const OVERSCAN = 10;
const EDGE = 64;

interface Props {
  lib: Library;
  ids: string[];
  /** Changes when the user switches view, to scroll back to the top. */
  viewKey: string;
  selected: Set<string>;
  onSelect: (id: string, index: number, range: boolean) => void;
  canDrag: boolean;
  onMove: (ids: string[], toIndex: number) => void;
  onRename: (id: string, title: string) => void;
  membership: Map<string, string[]>;
  duplicates: DuplicateReport;
  showCollections: boolean;
}

interface DragState {
  ids: string[];
  label: string;
  target: number;
  x: number;
  y: number;
}

/**
 * The bookmark list. Only the rows on screen are rendered, so 50,000
 * bookmarks scroll as smoothly as 50. Rows are a fixed height, which also
 * lets dragging work out the drop position with arithmetic alone.
 */
export function BookmarkList(props: Props) {
  const { lib, ids, viewKey, selected, canDrag, onMove } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(800);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<{ ids: string[]; clientX: number; clientY: number; frame: number } | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const resize = new ResizeObserver(() => setHeight(el.clientHeight));
    resize.observe(el);
    setHeight(el.clientHeight);
    return () => resize.disconnect();
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [viewKey]);

  const targetFor = (clientY: number) => {
    const el = scrollRef.current!;
    const y = clientY - el.getBoundingClientRect().top + el.scrollTop;
    return Math.max(0, Math.min(ids.length, Math.round(y / ROW)));
  };

  const endDrag = (commit: boolean) => {
    const d = dragRef.current;
    if (!d) return;
    cancelAnimationFrame(d.frame);
    dragRef.current = null;
    const target = targetFor(d.clientY);
    setDrag(null);
    if (!commit) return;
    // Where the group lands in the list as it is without the moving rows.
    const moving = new Set(d.ids);
    let toIndex = 0;
    for (let i = 0; i < target; i++) if (!moving.has(ids[i])) toIndex++;
    onMove(d.ids, toIndex);
  };

  const startDrag = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0 || !canDrag) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const moving = selected.has(id) ? ids.filter((x) => selected.has(x)) : [id];
    const label = moving.length > 1 ? plural(moving.length, "bookmark") : displayName(lib.bookmarks[id]);
    const state = { ids: moving, clientX: e.clientX, clientY: e.clientY, frame: 0 };
    dragRef.current = state;
    setDrag({ ids: moving, label, target: targetFor(e.clientY), x: e.clientX, y: e.clientY });

    // Scroll while the pointer is held near the top or bottom edge.
    const tick = () => {
      const d = dragRef.current;
      const el = scrollRef.current;
      if (!d || !el) return;
      const rect = el.getBoundingClientRect();
      let dy = 0;
      if (d.clientY < rect.top + EDGE) dy = -Math.min(1, (rect.top + EDGE - d.clientY) / EDGE) * 20;
      else if (d.clientY > rect.bottom - EDGE) dy = Math.min(1, (d.clientY - rect.bottom + EDGE) / EDGE) * 20;
      if (dy) {
        el.scrollTop += dy;
        setDrag((prev) => prev && { ...prev, target: targetFor(d.clientY) });
      }
      d.frame = requestAnimationFrame(tick);
    };
    state.frame = requestAnimationFrame(tick);
  };

  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    d.clientX = e.clientX;
    d.clientY = e.clientY;
    setDrag((prev) => prev && { ...prev, target: targetFor(e.clientY), x: e.clientX, y: e.clientY });
  };

  // Rows get handlers that never change identity, so a row only re-renders
  // when its own bookmark or state changes (not on every scroll or drag move).
  const callbacks = { startDrag, moveDrag, endDrag, onMove, onSelect: props.onSelect, onRename: props.onRename };
  const latest = useRef(callbacks);
  latest.current = callbacks;
  const handlers = useMemo<RowHandlers>(
    () => ({
      down: (e, id) => latest.current.startDrag(e, id),
      move: (e) => latest.current.moveDrag(e),
      up: () => latest.current.endDrag(true),
      cancel: () => latest.current.endDrag(false),
      select: (id, index, range) => latest.current.onSelect(id, index, range),
      moveTo: (id, index) => latest.current.onMove([id], index),
      rename: (id, title) => latest.current.onRename(id, title),
      setRenaming,
    }),
    [],
  );

  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && endDrag(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const start = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const end = Math.min(ids.length, Math.ceil((scrollTop + height) / ROW) + OVERSCAN);
  const dragging = drag ? new Set(drag.ids) : null;

  const rows = [];
  for (let i = start; i < end; i++) {
    const bookmark = lib.bookmarks[ids[i]];
    if (!bookmark) continue;
    rows.push(
      <Row
        key={bookmark.id}
        bookmark={bookmark}
        index={i}
        count={ids.length}
        selected={selected.has(bookmark.id)}
        canDrag={canDrag}
        renaming={renaming === bookmark.id}
        dimmed={dragging?.has(bookmark.id) ?? false}
        collections={props.showCollections || props.duplicates.inCollections.has(bookmark.id) ? props.membership.get(bookmark.id) : undefined}
        showCollections={props.showCollections}
        inSeveral={props.duplicates.inCollections.has(bookmark.id)}
        lookalikes={(props.duplicates.groupOf.get(bookmark.id)?.length ?? 1) - 1}
        handlers={handlers}
      />,
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
      data-testid="bookmark-list"
    >
      <div style={{ height: ids.length * ROW }} className="relative" role="list" aria-rowcount={ids.length}>
        {rows}
        {drag && (
          <div
            className="pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded bg-accent"
            style={{ top: drag.target * ROW - 1 }}
          />
        )}
      </div>
      {drag && (
        <div
          className="pointer-events-none fixed z-50 max-w-64 truncate rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-lg"
          style={{ left: drag.x + 14, top: drag.y + 10 }}
        >
          {drag.label}
        </div>
      )}
    </div>
  );
}

interface RowHandlers {
  down: (e: React.PointerEvent, id: string) => void;
  move: (e: React.PointerEvent) => void;
  up: () => void;
  cancel: () => void;
  select: (id: string, index: number, range: boolean) => void;
  moveTo: (id: string, index: number) => void;
  rename: (id: string, title: string) => void;
  setRenaming: (id: string | null) => void;
}

const Row = memo(function Row({
  bookmark,
  index,
  count,
  selected: isSelected,
  canDrag,
  renaming,
  dimmed,
  collections = [],
  showCollections,
  inSeveral,
  lookalikes,
  handlers: h,
}: {
  bookmark: Bookmark;
  index: number;
  count: number;
  selected: boolean;
  canDrag: boolean;
  renaming: boolean;
  dimmed: boolean;
  collections?: string[];
  showCollections: boolean;
  inSeveral: boolean;
  lookalikes: number;
  handlers: RowHandlers;
}) {
  const name = displayName(bookmark);

  const details: string[] = [];
  if (bookmark.author && name !== `@${bookmark.author}`) details.push(`@${bookmark.author}`);
  details.push(kindLabel(bookmark));
  if (bookmark.savedAt) details.push(`Saved ${formatDate(bookmark.savedAt)}`);

  return (
    <div
      role="listitem"
      data-id={bookmark.id}
      onClick={(e) => h.select(bookmark.id, index, e.shiftKey)}
      className={`absolute inset-x-0 flex items-center gap-2 border-b border-neutral-100 pr-2 pl-1 sm:gap-3 sm:pr-4 dark:border-neutral-900 ${
        isSelected ? "bg-accent-soft dark:bg-accent/15" : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
      } ${dimmed ? "opacity-40" : ""}`}
      style={{ top: index * ROW, height: ROW }}
    >
      <button
        type="button"
        aria-label={canDrag ? `Drag to reorder ${name}` : "Reordering works in Custom order without a search"}
        title={canDrag ? "Drag to reorder (or focus and use ↑ ↓)" : "Switch to Custom order and clear the search to reorder"}
        disabled={!canDrag}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => h.down(e, bookmark.id)}
        onPointerMove={h.move}
        onPointerUp={h.up}
        onPointerCancel={h.cancel}
        onKeyDown={(e) => {
          if (!canDrag) return;
          const to = e.key === "ArrowUp" ? index - 1 : e.key === "ArrowDown" ? index + 1 : -1;
          if (to < 0 || to >= count) return;
          e.preventDefault();
          h.moveTo(bookmark.id, to);
          const target = e.currentTarget.closest("[role=list]");
          requestAnimationFrame(() =>
            target?.querySelector<HTMLElement>(`[data-id="${bookmark.id}"] button`)?.focus(),
          );
        }}
        className="flex h-full w-7 shrink-0 touch-none items-center justify-center text-neutral-400 hover:text-neutral-700 disabled:cursor-default disabled:opacity-25 dark:hover:text-neutral-200"
      >
        <GripVertical className="size-4" />
      </button>
      <input
        type="checkbox"
        checked={isSelected}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => h.select(bookmark.id, index, (e.nativeEvent as MouseEvent).shiftKey)}
        aria-label={`Select ${name}`}
        className="size-4 shrink-0 accent-accent"
      />
      <Thumb bookmark={bookmark} />
      <div className="min-w-0 flex-1">
        {renaming ? (
          <InlineEdit
            value={bookmark.title ?? ""}
            placeholder={name}
            onSave={(value) => {
              h.rename(bookmark.id, value);
              h.setRenaming(null);
            }}
            onCancel={() => h.setRenaming(null)}
          />
        ) : (
          <p className="truncate text-sm font-medium" onDoubleClick={() => h.setRenaming(bookmark.id)} title={name}>
            {name}
          </p>
        )}
        <p className="flex items-center gap-1.5 truncate text-xs text-neutral-500">
          <span className="truncate">{details.join(" · ")}</span>
          {showCollections && collections.length > 0 && (
            <span className="hidden items-center gap-1 truncate sm:inline-flex">
              <FolderOpen className="size-3 shrink-0" />
              {collections.slice(0, 2).join(", ")}
              {collections.length > 2 && ` +${collections.length - 2}`}
            </span>
          )}
          {inSeveral && (
            <span
              className="shrink-0 rounded bg-amber-100 px-1.5 py-px font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
              title={`Filed in: ${collections.join(", ")}`}
            >
              In {collections.length} collections
            </span>
          )}
          {lookalikes > 0 && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded bg-rose-100 px-1.5 py-px font-medium text-rose-800 dark:bg-rose-500/15 dark:text-rose-300"
              title="Looks like the same content as another saved post"
            >
              <Copy className="size-3" />
              {plural(lookalikes, "look-alike")}
            </span>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          h.setRenaming(bookmark.id);
        }}
        aria-label={`Rename ${name}`}
        title="Rename"
        className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
      >
        <Pencil className="size-4" />
      </button>
      <a
        href={bookmark.url}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        aria-label="Open on Instagram"
        title="Open on Instagram"
        className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
      >
        <ExternalLink className="size-4" />
      </a>
    </div>
  );
});
