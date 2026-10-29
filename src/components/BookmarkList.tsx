"use client";

import { Copy, ExternalLink, Eye, FolderOpen, GripVertical, Pencil } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DuplicateReport } from "@/lib/library/duplicates";
import { displayName, kindLabel } from "@/lib/library/query";
import type { Bookmark, Library } from "@/lib/types";
import { InlineEdit, Thumb, formatDate, plural } from "./ui";

const ROW = 88;
const OVERSCAN = 10;
const EDGE = 64;

interface Props {
  lib: Library;
  ids: string[];
  /** Changes when the user switches view, to scroll back to the top. */
  viewKey: string;
  selected: Set<string>;
  onSelect: (id: string, index: number, range: boolean) => void;
  /** Reordering by drag works in custom order without a search. */
  canDrag: boolean;
  onMove: (ids: string[], toIndex: number) => void;
  /** Dropping bookmarks on a collection in the sidebar adds them to it. */
  onDropToCollection: (ids: string[], collectionId: string) => void;
  onRename: (id: string, title: string) => void;
  /** The bookmark open in the preview panel. */
  previewId: string | null;
  onPreview: (id: string) => void;
  membership: Map<string, string[]>;
  duplicates: DuplicateReport;
  showCollections: boolean;
  /** Duplicate badges, shown only where they're the point (the Possible duplicates view). */
  showDuplicates: boolean;
}

interface DragState {
  ids: string[];
  label: string;
  /** Where the rows would land in the list, or null when the pointer is outside it. */
  target: number | null;
  /** The sidebar collection under the pointer, if any. */
  collection: { id: string; name: string } | null;
  x: number;
  y: number;
}

/** The sidebar collection under the pointer (sidebar rows carry data-collection-id). */
function collectionAt(x: number, y: number): HTMLElement | null {
  return document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-collection-id]") ?? null;
}

let highlighted: HTMLElement | null = null;
function highlight(el: HTMLElement | null) {
  if (highlighted === el) return;
  highlighted?.removeAttribute("data-drop-target");
  el?.setAttribute("data-drop-target", "");
  highlighted = el;
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

  /** The drop slot in the list, or null when the pointer isn't over the list (or reordering is off). */
  const targetFor = (clientX: number, clientY: number) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    if (!canDrag || clientX < rect.left || clientX > rect.right || clientY < rect.top - EDGE || clientY > rect.bottom + EDGE) return null;
    const y = clientY - rect.top + el.scrollTop;
    return Math.max(0, Math.min(ids.length, Math.round(y / ROW)));
  };

  const dragUpdate = (clientX: number, clientY: number) => {
    const el = collectionAt(clientX, clientY);
    highlight(el);
    const id = el?.dataset.collectionId;
    const collection = id ? { id, name: lib.collections.find((c) => c.id === id)?.name ?? "" } : null;
    return { target: collection ? null : targetFor(clientX, clientY), collection };
  };

  // While dragging, the pointer is followed on the window, so the drag keeps
  // working when the row it started on scrolls out of view.
  const windowHandlers = useRef<{ move: (e: PointerEvent) => void; up: () => void; cancel: () => void } | null>(null);
  const stopListening = () => {
    const w = windowHandlers.current;
    if (!w) return;
    window.removeEventListener("pointermove", w.move);
    window.removeEventListener("pointerup", w.up);
    window.removeEventListener("pointercancel", w.cancel);
    windowHandlers.current = null;
  };

  const endDrag = (commit: boolean) => {
    const d = dragRef.current;
    if (!d) return;
    stopListening();
    cancelAnimationFrame(d.frame);
    dragRef.current = null;
    // The click that ends a drag is ignored; anything after it counts again.
    setTimeout(() => (suppressClick.current = false), 0);
    const { target, collection } = dragUpdate(d.clientX, d.clientY);
    highlight(null);
    setDrag(null);
    if (!commit) return;
    if (collection) {
      props.onDropToCollection(d.ids, collection.id);
      return;
    }
    if (target === null) return;
    // Where the group lands in the list as it is without the moving rows.
    const moving = new Set(d.ids);
    let toIndex = 0;
    for (let i = 0; i < target; i++) if (!moving.has(ids[i])) toIndex++;
    onMove(d.ids, toIndex);
  };

  const startDrag = (e: { clientX: number; clientY: number; preventDefault: () => void }, id: string) => {
    e.preventDefault();
    const moving = selected.has(id) ? ids.filter((x) => selected.has(x)) : [id];
    const label = moving.length > 1 ? plural(moving.length, "bookmark") : displayName(lib.bookmarks[id]);
    const state = { ids: moving, clientX: e.clientX, clientY: e.clientY, frame: 0 };
    dragRef.current = state;
    setDrag({ ids: moving, label, ...dragUpdate(e.clientX, e.clientY), x: e.clientX, y: e.clientY });

    // Scroll the list while the pointer is held near its top or bottom edge.
    const tick = () => {
      const d = dragRef.current;
      const el = scrollRef.current;
      if (!d || !el) return;
      const rect = el.getBoundingClientRect();
      const inside = d.clientX >= rect.left && d.clientX <= rect.right;
      let dy = 0;
      if (inside && d.clientY < rect.top + EDGE) dy = -Math.min(1, (rect.top + EDGE - d.clientY) / EDGE) * 20;
      else if (inside && d.clientY > rect.bottom - EDGE) dy = Math.min(1, (d.clientY - rect.bottom + EDGE) / EDGE) * 20;
      if (dy) {
        el.scrollTop += dy;
        setDrag((prev) => prev && { ...prev, ...dragUpdate(d.clientX, d.clientY) });
      }
      d.frame = requestAnimationFrame(tick);
    };
    state.frame = requestAnimationFrame(tick);

    stopListening();
    const w = {
      move: (ev: PointerEvent) => latest.current.moveDrag(ev),
      up: () => latest.current.endDrag(true),
      cancel: () => latest.current.endDrag(false),
    };
    window.addEventListener("pointermove", w.move);
    window.addEventListener("pointerup", w.up);
    window.addEventListener("pointercancel", w.cancel);
    windowHandlers.current = w;
  };

  // With a mouse, a row can be dragged from anywhere on it once the pointer
  // has moved a few pixels; a plain click still selects it. On touch screens
  // only the grip drags, so swiping still scrolls.
  const pending = useRef<{ id: string; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const rowDown = (e: React.PointerEvent, id: string) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, a, input, textarea")) return;
    pending.current = { id, x: e.clientX, y: e.clientY };
    const watch = (ev: PointerEvent) => {
      const p = pending.current;
      if (!p) return window.removeEventListener("pointermove", watch);
      if (Math.hypot(ev.clientX - p.x, ev.clientY - p.y) < 6) return;
      pending.current = null;
      window.removeEventListener("pointermove", watch);
      suppressClick.current = true;
      latest.current.startDrag(ev, p.id);
    };
    const release = () => {
      pending.current = null;
      window.removeEventListener("pointermove", watch);
      window.removeEventListener("pointerup", release);
    };
    window.addEventListener("pointermove", watch);
    window.addEventListener("pointerup", release);
  };

  const moveDrag = (e: { clientX: number; clientY: number }) => {
    const d = dragRef.current;
    if (!d) return;
    d.clientX = e.clientX;
    d.clientY = e.clientY;
    setDrag((prev) => prev && { ...prev, ...dragUpdate(e.clientX, e.clientY), x: e.clientX, y: e.clientY });
  };

  // Rows get handlers that never change identity, so a row only re-renders
  // when its own bookmark or state changes (not on every scroll or drag move).
  const callbacks = {
    rowDown,
    startDrag,
    moveDrag,
    endDrag,
    onMove,
    onSelect: props.onSelect,
    onRename: props.onRename,
    onPreview: props.onPreview,
  };
  const latest = useRef(callbacks);
  latest.current = callbacks;
  const handlers = useMemo<RowHandlers>(
    () => ({
      down: (e, id) => {
        if (e.button !== 0) return;
        latest.current.startDrag(e, id);
      },
      rowDown: (e, id) => latest.current.rowDown(e, id),
      clickGuard: (e) => {
        // A drag that started on the row shouldn't also select it.
        if (!suppressClick.current) return;
        suppressClick.current = false;
        e.stopPropagation();
        e.preventDefault();
      },
      select: (id, index, range) => latest.current.onSelect(id, index, range),
      moveTo: (id, index) => latest.current.onMove([id], index),
      rename: (id, title) => latest.current.onRename(id, title),
      preview: (id) => latest.current.onPreview(id),
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
        previewing={props.previewId === bookmark.id}
        dimmed={dragging?.has(bookmark.id) ?? false}
        collections={props.showCollections || props.duplicates.inCollections.has(bookmark.id) ? props.membership.get(bookmark.id) : undefined}
        showCollections={props.showCollections}
        inSeveral={props.showDuplicates && props.duplicates.inCollections.has(bookmark.id)}
        lookalikes={props.showDuplicates ? (props.duplicates.groupOf.get(bookmark.id)?.length ?? 1) - 1 : 0}
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
        {drag && drag.target !== null && (
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
          {drag.collection ? `Add ${drag.ids.length > 1 ? `${drag.label} ` : ""}to “${drag.collection.name}”` : drag.label}
        </div>
      )}
    </div>
  );
}

interface RowHandlers {
  down: (e: React.PointerEvent, id: string) => void;
  rowDown: (e: React.PointerEvent, id: string) => void;
  clickGuard: (e: React.MouseEvent) => void;
  select: (id: string, index: number, range: boolean) => void;
  moveTo: (id: string, index: number) => void;
  rename: (id: string, title: string) => void;
  preview: (id: string) => void;
  setRenaming: (id: string | null) => void;
}

const Row = memo(function Row({
  bookmark,
  index,
  count,
  selected: isSelected,
  canDrag,
  renaming,
  previewing,
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
  previewing: boolean;
  dimmed: boolean;
  collections?: string[];
  showCollections: boolean;
  inSeveral: boolean;
  lookalikes: number;
  handlers: RowHandlers;
}) {
  const name = displayName(bookmark);
  // Heading: the user's name for it, else who posted it. The caption gets its own lines below.
  const heading = bookmark.title ?? (bookmark.author ? `@${bookmark.author}` : name);
  const caption = bookmark.caption?.replace(/\s+/g, " ").trim();

  const details: string[] = [];
  if (bookmark.title && bookmark.author) details.push(`@${bookmark.author}`);
  details.push(kindLabel(bookmark));
  if (bookmark.savedAt) details.push(`Saved ${formatDate(bookmark.savedAt)}`);

  return (
    <div
      role="listitem"
      data-id={bookmark.id}
      onClick={(e) => h.select(bookmark.id, index, e.shiftKey)}
      onClickCapture={h.clickGuard}
      onPointerDown={(e) => h.rowDown(e, bookmark.id)}
      className={`group absolute inset-x-0 flex items-center gap-2 border-b select-none border-neutral-100 pr-2 pl-1 sm:gap-3 sm:pr-4 dark:border-neutral-900 ${
        isSelected ? "bg-accent-soft dark:bg-accent/15" : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
      } ${previewing ? "shadow-[inset_3px_0_0_var(--color-accent)]" : ""} ${dimmed ? "opacity-40" : ""}`}
      style={{ top: index * ROW, height: ROW }}
    >
      <button
        type="button"
        aria-label={canDrag ? `Drag to reorder ${name}` : `Drag ${name} onto a collection`}
        title={
          canDrag
            ? "Drag to reorder, or onto a collection in the sidebar to add it (↑ ↓ also move it)"
            : "Drag onto a collection in the sidebar to add it. To reorder, switch to Custom order and clear the search."
        }
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => h.down(e, bookmark.id)}
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
        className="hidden h-full w-7 shrink-0 touch-none items-center justify-center text-neutral-400 hover:text-neutral-700 pointer-coarse:flex dark:hover:text-neutral-200"
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
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          h.preview(bookmark.id);
        }}
        aria-label={`Preview ${name}`}
        title="Preview"
        className="shrink-0 rounded-lg focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Thumb bookmark={bookmark} />
      </button>
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
          <p className="flex items-center gap-1.5 text-sm font-medium" onDoubleClick={() => h.setRenaming(bookmark.id)} title={heading}>
            <span className="truncate">{heading}</span>
            {bookmark.isNew && (
              <span className="shrink-0 rounded bg-accent px-1 text-[10px] font-semibold text-white uppercase">New</span>
            )}
          </p>
        )}
        {caption && (
          <p className="line-clamp-2 text-xs leading-snug text-neutral-600 dark:text-neutral-400" title={bookmark.caption}>
            {caption}
          </p>
        )}
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-neutral-500">
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
      {/* Row tools appear on hover (always shown on touch screens). */}
      <span className="flex shrink-0 items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
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
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          h.preview(bookmark.id);
        }}
        aria-label={`Preview ${name}`}
        title="Preview"
        className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
      >
        <Eye className="size-4" />
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
      </span>
    </div>
  );
});
