"use client";

import { Check, ChevronDown, Plus, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import { entryLabel, type LibraryIndex } from "@/lib/libraries";
import { Popover, fmtCount, menuItem } from "./ui";

interface Props {
  index: LibraryIndex;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}

/** Shows whose library is open and switches between Instagram accounts. */
export function AccountMenu({ index, onSwitch, onAdd, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const active = index.entries.find((e) => e.id === index.active) ?? index.entries[0];
  return (
    <div className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex max-w-44 items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
        aria-label={`Account: ${entryLabel(active)}. Switch account`}
        data-testid="account-menu"
      >
        <UserRound className="size-4 shrink-0 text-neutral-400" />
        <span className="truncate">{entryLabel(active)}</span>
        <ChevronDown className="size-3.5 shrink-0 text-neutral-400" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)}>
        <p className="px-2.5 pt-1.5 pb-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase">Instagram accounts</p>
        {index.entries.map((entry) => (
          <div key={entry.id} className="group flex items-center">
            <button
              type="button"
              className={`${menuItem} flex-1`}
              onClick={() => {
                setOpen(false);
                if (entry.id !== index.active) onSwitch(entry.id);
              }}
            >
              <span className="w-4 shrink-0">{entry.id === index.active && <Check className="size-4 text-accent" />}</span>
              <span className="truncate">{entryLabel(entry)}</span>
              <span className="ml-auto text-xs text-neutral-500 tabular-nums">{fmtCount.format(entry.count)}</span>
            </button>
            {entry.id !== index.active && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onRemove(entry.id);
                }}
                className="mr-1 hidden rounded p-1 text-neutral-400 group-hover:block hover:text-red-600"
                aria-label={`Delete ${entryLabel(entry)}'s library`}
                title="Delete this library"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className={`${menuItem} mt-1 border-t border-neutral-200 pt-2 dark:border-neutral-800`}
          onClick={() => {
            setOpen(false);
            onAdd();
          }}
        >
          <Plus className="size-4" /> Add another account
        </button>
      </Popover>
    </div>
  );
}
