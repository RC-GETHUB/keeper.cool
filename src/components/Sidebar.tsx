"use client";

import { Bookmark as BookmarkIcon, Copy, Download, Folder, FolderPlus, Inbox, Pencil, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Counts, Scope } from "@/lib/library/query";
import type { Library } from "@/lib/types";
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
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  count: number;
  onClick: () => void;
  actions?: ReactNode;
}) {
  return (
    <div
      className={`group flex items-center rounded-lg ${
        active ? "bg-accent-soft text-accent dark:bg-accent/20 dark:text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
      }`}
    >
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left text-sm">
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
  onBackup,
  onReset,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);

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
        {lib.collections.map((c) =>
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
            <Item
              key={c.id}
              active={scope.type === "collection" && scope.id === c.id}
              icon={<Folder className="size-4" />}
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
          ),
        )}
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
