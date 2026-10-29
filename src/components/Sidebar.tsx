"use client";

import { Bookmark as BookmarkIcon, Copy, Download, Folder, FolderPlus, GripVertical, Inbox, Pencil, Search, Trash2 } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { sortCollections, type CollectionSort, type Counts, type Scope } from "@/lib/library/query";
import type { Collection, Library } from "@/lib/types";
import { InlineEdit, fmtCount } from "./ui";

interface Props {
  lib: Library;
  counts: Counts;
  duplicateCount: number;
  scope: Scope;
  onScope: (scope: Scope) => void;
  onCreate: (name: string) => string | null;
  onRenameCollection: (id: string, name: string) => string | null;
  onDeleteCollection: (id: string) => void;
  /** Moves a collection to `toIndex` of the list as it is without it. */
  onMoveCollection: (id: string, toIndex: number) => void;
  /** Puts the collections in this order (a sort the user picked). */
  onOrderCollections: (ids: string[], sort: CollectionSort) => void;
  /** Puts the collections back in Instagram's order (when Keeper knows it). */
  onRestoreCollectionOrder?: () => void;
  onBackup: () => void;
  onReset: () => void;
}

function Item({
  active,
  icon,
  label,
  count,
  onClick,
  actions,
  handle,
  dimmed,
  id,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  count: number;
  onClick: () => void;
  actions?: ReactNode;
  handle?: ReactNode;
  dimmed?: boolean;
  id?: string;
}) {
  return (
    <div
      data-collection-id={id}
      className={`group flex items-center rounded-lg ${dimmed ? "opacity-40" : ""} ${
        active ? "bg-accent-soft text-accent dark:bg-accent/20 dark:text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
      }`}
    >
      {handle}
      <button
        type="button"
        onClick={onClick}
        className={`flex min-w-0 flex-1 items-center gap-2.5 py-2 pr-2.5 text-left text-sm ${handle ? "pl-0.5" : "pl-2.5"}`}
      >
        <span className="shrink-0 opacity-70">{icon}</span>
        <span className="truncate font-medium">{label}</span>
      </button>
      {actions && <span className="hidden shrink-0 items-center group-focus-within:flex group-hover:flex">{actions}</span>}
      <span className="shrink-0 pr-2.5 text-xs tabular-nums text-neutral-500 dark:text-neutral-400" data-testid={`count-${label}`}>
        {fmtCount.format(count)}
      </span>
    </div>
  );
}

const SORTS: { value: CollectionSort; label: string }[] = [
  { value: "custom", label: "Your order" },
  { value: "az", label: "A–Z" },
  { value: "za", label: "Z–A" },
  { value: "recent", label: "Recently added to" },
  { value: "newest", label: "Newest created" },
  { value: "oldest", label: "Oldest created" },
  { value: "size", label: "Most posts" },
];

/** The first post in the collection that has a cover image. */
function coverOf(lib: Library, c: Collection): string | undefined {
  for (const id of c.items.slice(0, 12)) {
    const url = lib.bookmarks[id]?.thumbnailUrl;
    if (url) return url;
  }
  return undefined;
}

function CollectionIcon({ cover }: { cover?: string }) {
  if (!cover) return <Folder className="size-4" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={cover} alt="" className="block size-5 rounded object-cover" />;
}

const iconButton =
  "rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";

export function Sidebar({
  lib,
  counts,
  duplicateCount,
  scope,
  onScope,
  onCreate,
  onRenameCollection,
  onDeleteCollection,
  onMoveCollection,
  onOrderCollections,
  onRestoreCollectionOrder,
  onBackup,
  onReset,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  // Choosing a sort reorders the collections for good (it can be undone);
  // the menu remembers which one was applied until the user drags.
  const [sort, setSort] = useState<CollectionSort | "instagram">("custom");
  const shown = useMemo(() => sortCollections(lib.collections, "custom", filter), [lib.collections, filter]);
  const many = lib.collections.length > 8;
  const canDrag = !filter;
  const applySort = (next: CollectionSort | "instagram") => {
    setSort(next);
    if (next === "instagram") onRestoreCollectionOrder?.();
    else if (next !== "custom") onOrderCollections(sortCollections(lib.collections, next).map((c) => c.id), next);
  };

  // Dragging: the target is the gap before the collection under the pointer.
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; target: number } | null>(null);
  const targetFor = (clientY: number) => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-collection-id]") ?? [])];
    const i = rows.findIndex((row) => {
      const r = row.getBoundingClientRect();
      return clientY < r.top + r.height / 2;
    });
    return i < 0 ? rows.length : i;
  };
  const dropAt = (id: string, target: number) => {
    const from = lib.collections.findIndex((c) => c.id === id);
    const to = target > from ? target - 1 : target;
    if (to !== from) {
      onMoveCollection(id, to);
      setSort("custom");
    }
  };

  const handleFor = (id: string, index: number, name: string) =>
    canDrag ? (
      <button
        type="button"
        aria-label={`Drag to reorder ${name}`}
        title="Drag to reorder (or focus and use ↑ ↓)"
        className="flex h-8 w-5 shrink-0 touch-none items-center justify-center text-neutral-300 hover:text-neutral-600 dark:text-neutral-700 dark:hover:text-neutral-300"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag({ id, target: targetFor(e.clientY) });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          // Scroll the sidebar when dragging near its edges.
          const nav = listRef.current?.closest("nav");
          if (nav) {
            const r = nav.getBoundingClientRect();
            if (e.clientY < r.top + 40) nav.scrollTop -= 12;
            else if (e.clientY > r.bottom - 40) nav.scrollTop += 12;
          }
          setDrag({ id, target: targetFor(e.clientY) });
        }}
        onPointerUp={() => {
          if (drag) dropAt(drag.id, drag.target);
          setDrag(null);
        }}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => {
          const to = e.key === "ArrowUp" ? index - 1 : e.key === "ArrowDown" ? index + 1 : -1;
          if (to < 0 || to >= lib.collections.length) return;
          e.preventDefault();
          onMoveCollection(id, to);
          setSort("custom");
          requestAnimationFrame(() =>
            listRef.current?.querySelector<HTMLElement>(`[data-collection-id="${id}"] button`)?.focus(),
          );
        }}
      >
        <GripVertical className="size-3.5" />
      </button>
    ) : null;

  return (
    <nav className="flex h-full flex-col gap-4 overflow-y-auto p-3" aria-label="Collections">
      <div className="space-y-0.5">
        <Item
          active={scope.type === "all"}
          icon={<BookmarkIcon className="size-4" />}
          label="All bookmarks"
          count={counts.total}
          onClick={() => onScope({ type: "all" })}
        />
        <Item
          active={scope.type === "unfiled"}
          icon={<Inbox className="size-4" />}
          label="Not in a collection"
          count={counts.unfiled}
          onClick={() => onScope({ type: "unfiled" })}
        />
        <Item
          active={scope.type === "duplicates"}
          icon={<Copy className="size-4" />}
          label="Possible duplicates"
          count={duplicateCount}
          onClick={() => onScope({ type: "duplicates" })}
        />
      </div>

      <div className="space-y-0.5">
        <div className="flex items-center justify-between px-2.5 pb-1">
          <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            Collections <span className="font-normal">({lib.collections.length})</span>
          </h2>
          <button type="button" onClick={() => setAdding(true)} className={iconButton} aria-label="New collection" title="New collection">
            <FolderPlus className="size-4" />
          </button>
        </div>
        {adding && (
          <div className="px-1 pb-1">
            <InlineEdit
              value=""
              placeholder="Collection name"
              onSave={(name) => {
                if (!name.trim()) return void setAdding(false);
                const error = onCreate(name);
                if (!error) setAdding(false);
                return error;
              }}
              onCancel={() => setAdding(false)}
            />
          </div>
        )}
        {lib.collections.length > 1 && (
          <div className="flex flex-wrap gap-1.5 px-1 pb-1.5">
            {many && (
              <label className="relative min-w-0 flex-1 basis-28">
                <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-neutral-400" />
                <input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Find a collection"
                  aria-label="Find a collection"
                  className="w-full rounded-md border border-neutral-200 bg-transparent py-1 pr-2 pl-7 text-xs outline-none focus:border-accent dark:border-neutral-800"
                />
              </label>
            )}
            <select
              value={sort}
              onChange={(e) => applySort(e.target.value as CollectionSort | "instagram")}
              aria-label="Sort collections"
              className={`rounded-md border border-neutral-200 bg-white px-1 py-1 text-xs dark:border-neutral-800 dark:bg-neutral-950 ${many ? "" : "flex-1"}`}
            >
              {SORTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              {onRestoreCollectionOrder && <option value="instagram">Instagram&apos;s order</option>}
            </select>
          </div>
        )}
        {filter && shown.length === 0 && <p className="px-2.5 py-1 text-xs text-neutral-500">No collection matches “{filter}”.</p>}
        <div ref={listRef} className="relative space-y-0.5">
        {shown.map((c, index) =>
          renaming === c.id ? (
            <div key={c.id} className="px-1 py-0.5">
              <InlineEdit
                value={c.name}
                onSave={(name) => {
                  const error = onRenameCollection(c.id, name);
                  if (!error) setRenaming(null);
                  return error;
                }}
                onCancel={() => setRenaming(null)}
              />
            </div>
          ) : (
            <div key={c.id} className="relative">
            {drag && drag.target === index && <div className="pointer-events-none absolute inset-x-1 -top-px z-10 h-0.5 rounded bg-accent" />}
            <Item
              id={c.id}
              handle={handleFor(c.id, index, c.name)}
              dimmed={drag?.id === c.id}
              active={scope.type === "collection" && scope.id === c.id}
              icon={<CollectionIcon cover={coverOf(lib, c)} />}
              label={c.name}
              count={counts.collections[c.id] ?? 0}
              onClick={() => onScope({ type: "collection", id: c.id })}
              actions={
                <>
                  <button type="button" className={iconButton} onClick={() => setRenaming(c.id)} aria-label={`Rename ${c.name}`} title="Rename">
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className={iconButton}
                    onClick={() => onDeleteCollection(c.id)}
                    aria-label={`Delete ${c.name}`}
                    title="Delete collection (bookmarks stay)"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </>
              }
            />
            </div>
          ),
        )}
        {drag && drag.target === shown.length && <div className="pointer-events-none h-0.5 rounded bg-accent" />}
        </div>
        {lib.collections.length === 0 && !adding && (
          <p className="px-2.5 py-1 text-xs text-neutral-500">No collections yet.</p>
        )}
      </div>

      <div className="mt-auto space-y-0.5 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <button type="button" onClick={onBackup} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900">
          <Download className="size-3.5" /> Download a backup
        </button>
        <button type="button" onClick={onReset} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10">
          <Trash2 className="size-3.5" /> Delete my library
        </button>
      </div>
    </nav>
  );
}
