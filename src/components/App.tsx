"use client";

import {
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  FolderMinus,
  FolderPlus,
  Loader2,
  Menu,
  Pause,
  RotateCcw,
  Search,
  Send,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { findDuplicates } from "@/lib/library/duplicates";
import {
  addToCollection,
  applyThumbnails,
  applyOrder,
  createCollection,
  deleteCollection,
  emptyLibrary,
  mergeImport,
  moveCollection,
  moveItems,
  orderCollections,
  canRestoreInstagramOrder,
  restoreCollectionOrder,
  restoreInstagramOrder,
  removeBookmarks,
  removeFromCollection,
  renameBookmark,
  renameCollection,
} from "@/lib/library/ops";
import { countLibrary, viewIds, type CollectionSort, type Scope, type SortMode } from "@/lib/library/query";
import { useExtension } from "@/lib/extension";
import { clearLibrary, loadLibrary, saveLibrary } from "@/lib/storage";
import { syntheticImport } from "@/lib/synthetic";
import type { ImportResult, Library } from "@/lib/types";
import { BookmarkList } from "./BookmarkList";
import { ImportDialog } from "./ImportDialog";
import { PreviewPanel } from "./PreviewPanel";
import { PushDialog } from "./PushDialog";
import { Sidebar } from "./Sidebar";
import { Popover, fmtCount, ghostButton, menuItem, plural, primaryButton } from "./ui";

const SORTS: { value: SortMode; label: string }[] = [
  { value: "custom", label: "Custom order" },
  { value: "az", label: "Name A–Z" },
  { value: "za", label: "Name Z–A" },
  { value: "newest", label: "Newest saved" },
  { value: "oldest", label: "Oldest saved" },
];

const HISTORY = 50;

const COLLECTION_SORT_NAMES: Record<CollectionSort, string> = {
  custom: "",
  az: "A–Z",
  za: "Z–A",
  recent: "by most recently added to",
  newest: "newest first",
  oldest: "oldest first",
  size: "by most posts",
};

export function App() {
  const [lib, setLib] = useState<Library | null>(null);
  const [history, setHistory] = useState<Library[]>([]);
  const [scope, setScope] = useState<Scope>({ type: "all" });
  const [sort, setSort] = useState<SortMode>("custom");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const extension = useExtension();
  const [drawer, setDrawer] = useState(false);
  const [addMenu, setAddMenu] = useState(false);
  const [toast, setToast] = useState<{ message: string; undo: boolean } | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Load once, then save (debounced) after every change.
  useEffect(() => {
    loadLibrary()
      .then((stored) => setLib(stored ?? emptyLibrary()))
      .catch(() => setLib(emptyLibrary()));
  }, []);
  const loaded = useRef<Library | null>(null);
  useEffect(() => {
    if (!lib) return;
    if (!loaded.current) {
      loaded.current = lib;
      return;
    }
    const timer = setTimeout(() => {
      saveLibrary(lib).then(
        () => setSaveError(false),
        () => setSaveError(true),
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [lib]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const commit = useCallback(
    (next: Library, message?: string) => {
      if (!lib || next === lib) return;
      setHistory((h) => [...h.slice(-(HISTORY - 1)), lib]);
      setLib(next);
      if (message) setToast({ message, undo: true });
    },
    [lib],
  );

  const undo = useCallback(() => {
    if (!history.length) return;
    setLib(history[history.length - 1]);
    setHistory(history.slice(0, -1));
    setToast({ message: "Undone", undo: false });
  }, [history]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey && !typing) {
        e.preventDefault();
        undo();
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape" && !typing) {
        setSelected(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  // A deleted collection can't stay open.
  useEffect(() => {
    if (lib && scope.type === "collection" && !lib.collections.some((c) => c.id === scope.id)) setScope({ type: "all" });
  }, [lib, scope]);

  const duplicates = useMemo(() => findDuplicates(lib ?? emptyLibrary()), [lib?.bookmarks, lib?.collections, lib?.order]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => countLibrary(lib ?? emptyLibrary()), [lib?.order, lib?.collections]); // eslint-disable-line react-hooks/exhaustive-deps
  const ids = useMemo(
    () => (lib ? viewIds(lib, { scope, sort, query: deferredQuery, duplicates }) : []),
    [lib, scope, sort, deferredQuery, duplicates],
  );
  const membership = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const c of lib?.collections ?? []) {
      for (const id of c.items) {
        const names = map.get(id);
        if (names) names.push(c.name);
        else map.set(id, [c.name]);
      }
    }
    return map;
  }, [lib?.collections]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lib) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  const collectionId = scope.type === "collection" ? scope.id : null;
  const ordered = scope.type === "all" || scope.type === "collection";
  const canDrag = ordered && sort === "custom" && !deferredQuery;
  const scopeName =
    scope.type === "all"
      ? "All bookmarks"
      : scope.type === "unfiled"
        ? "Not in a collection"
        : scope.type === "duplicates"
          ? "Possible duplicates"
          : (lib.collections.find((c) => c.id === scope.id)?.name ?? "");
  const scopeTotal =
    scope.type === "all"
      ? counts.total
      : scope.type === "unfiled"
        ? counts.unfiled
        : scope.type === "duplicates"
          ? duplicates.flagged.size
          : (counts.collections[scope.id] ?? 0);
  const selection = ids.filter((id) => selected.has(id));
  const viewKey = JSON.stringify([scope, sort]);

  const changeScope = (next: Scope) => {
    setScope(next);
    setSelected(new Set());
    anchor.current = null;
    setDrawer(false);
  };

  const select = (id: string, index: number, range: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (range && anchor.current !== null) {
        const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
        for (let i = a; i <= b; i++) next.add(ids[i]);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchor.current = index;
  };

  const importResult = (result: ImportResult) => {
    const { library, summary } = mergeImport(lib, result);
    commit(library);
    return summary;
  };

  const loadSample = (size: number) => {
    commit(mergeImport(lib, syntheticImport(size, { collections: 8 })).library, `Loaded ${plural(size, "sample bookmark")}`);
  };

  const backup = () => {
    const blob = new Blob([JSON.stringify(lib)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `keeper-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const reset = () =>
    setConfirming({
      title: "Delete your library?",
      message: "This removes every bookmark, name and collection from Keeper on this device. Your Instagram account isn't touched.",
      action: "Delete library",
      run: () =>
        clearLibrary()
          .catch(() => undefined)
          .finally(() => {
            loaded.current = null;
            setHistory([]);
            setLib(emptyLibrary());
            changeScope({ type: "all" });
          }),
    });

  const tryCollection = (fn: () => Library, message?: string): string | null => {
    try {
      commit(fn(), message);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "That didn't work.";
    }
  };

  const empty = counts.total === 0;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2.5 sm:gap-3 sm:px-4 dark:border-neutral-800">
        <button type="button" onClick={() => setDrawer(true)} className="rounded-md p-1.5 md:hidden" aria-label="Open collections">
          <Menu className="size-5" />
        </button>
        <div className="flex shrink-0 items-baseline gap-2">
          <span className="text-lg font-bold tracking-tight">
            keeper<span className="text-accent">.cool</span>
          </span>
          {!empty && (
            <span className="hidden text-xs text-neutral-500 sm:inline" data-testid="total-count">
              {plural(counts.total, "bookmark")}
            </span>
          )}
        </div>
        <label className="relative ml-auto flex max-w-md min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute left-2.5 size-4 text-neutral-400" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search bookmarks"
            aria-label="Search bookmarks"
            disabled={empty}
            className="w-full rounded-lg border border-neutral-200 bg-neutral-50 py-1.5 pr-8 pl-8 text-sm outline-none focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20 disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-900 dark:focus:bg-neutral-950"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="absolute right-2 text-neutral-400" aria-label="Clear search">
              <X className="size-4" />
            </button>
          )}
        </label>
        <button type="button" onClick={undo} disabled={!history.length} className={`${ghostButton} px-2`} title="Undo (Ctrl/⌘ Z)" aria-label="Undo">
          <Undo2 className="size-4" />
        </button>
        <button type="button" onClick={() => setImportOpen(true)} className={`${ghostButton} px-2 sm:px-3`} aria-label="Import">
          <Upload className="size-4" /> <span className="hidden sm:inline">Import</span>
        </button>
        <div className="hidden lg:block">
          {extension.job && ["running", "waiting", "paused", "blocked"].includes(extension.job.status) ? (
            <button type="button" onClick={() => setPushOpen(true)} className={primaryButton} title="Push progress">
              {extension.job.status === "blocked" || extension.job.status === "paused" ? (
                <Pause className="size-4" />
              ) : (
                <Loader2 className="size-4 animate-spin" />
              )}
              Pushing {fmtCount.format(extension.job.done)}/{fmtCount.format(extension.job.total)}
            </button>
          ) : extension.status === "ready" ? (
            <button type="button" onClick={() => setPushOpen(true)} disabled={empty} className={primaryButton}>
              <Send className="size-4" /> Push to Instagram
            </button>
          ) : (
            <a href="/extension" className={primaryButton} title="Pushing to Instagram needs the Keeper extension">
              <Send className="size-4" /> Push to Instagram
            </a>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {drawer && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setDrawer(false)} />}
        <aside
          className={`fixed inset-y-0 left-0 z-30 w-72 border-r border-neutral-200 bg-white transition-transform md:static md:z-auto md:w-64 md:translate-x-0 dark:border-neutral-800 dark:bg-neutral-950 ${
            drawer ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <Sidebar
            lib={lib}
            counts={counts}
            duplicateCount={duplicates.flagged.size}
            scope={scope}
            onScope={changeScope}
            onCreate={(name) =>
              tryCollection(() => {
                const created = createCollection(lib, name);
                return created.library;
              }, `Created “${name.trim()}”`)
            }
            onRenameCollection={(id, name) => tryCollection(() => renameCollection(lib, id, name))}
            onDeleteCollection={(id) => {
              const c = lib.collections.find((x) => x.id === id);
              if (!c) return;
              setConfirming({
                title: `Delete “${c.name}”?`,
                message: `Its ${plural(c.items.length, "bookmark")} stay in All bookmarks. You can undo this.`,
                action: "Delete collection",
                run: () => commit(deleteCollection(lib, id), `Deleted “${c.name}”`),
              });
            }}
            onMoveCollection={(id, to) => commit(moveCollection(lib, id, to))}
            onOrderCollections={(ids, sort) => commit(orderCollections(lib, ids), `Sorted collections ${COLLECTION_SORT_NAMES[sort]}`)}
            onRestoreCollectionOrder={
              lib.instagramCollectionOrder ? () => commit(restoreCollectionOrder(lib), "Collections back in Instagram's order") : undefined
            }
            onBackup={backup}
            onReset={reset}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {empty ? (
            <Welcome onImport={() => setImportOpen(true)} onSample={loadSample} />
          ) : (
            <>
              <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b border-neutral-200 px-3 py-2 sm:px-4 dark:border-neutral-800">
                <input
                  type="checkbox"
                  aria-label="Select all shown"
                  className="ml-8 size-4 accent-accent"
                  checked={ids.length > 0 && selection.length === ids.length}
                  ref={(el) => {
                    if (el) el.indeterminate = selection.length > 0 && selection.length < ids.length;
                  }}
                  onChange={() => setSelected(selection.length === ids.length ? new Set() : new Set(ids))}
                />
                {selection.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="mr-1 text-sm font-medium">{fmtCount.format(selection.length)} selected</span>
                    <div className="relative">
                      <button type="button" className={ghostButton} onClick={() => setAddMenu(true)}>
                        <FolderPlus className="size-4" /> <span className="hidden sm:inline">Add to collection</span>
                      </button>
                      <AddToCollectionMenu
                        open={addMenu}
                        onClose={() => setAddMenu(false)}
                        lib={lib}
                        exclude={collectionId}
                        onPick={(id, name) => {
                          commit(addToCollection(lib, id, selection), `Added ${plural(selection.length, "bookmark")} to “${name}”`);
                          setAddMenu(false);
                        }}
                        onCreate={(name) =>
                          tryCollection(() => {
                            const created = createCollection(lib, name, selection);
                            setAddMenu(false);
                            return created.library;
                          }, `Created “${name.trim()}” with ${plural(selection.length, "bookmark")}`)
                        }
                      />
                    </div>
                    {collectionId && (
                      <button
                        type="button"
                        className={ghostButton}
                        onClick={() => {
                          commit(removeFromCollection(lib, collectionId, selection), `Removed ${plural(selection.length, "bookmark")} from “${scopeName}”`);
                          setSelected(new Set());
                        }}
                      >
                        <FolderMinus className="size-4" /> <span className="hidden sm:inline">Remove from collection</span>
                      </button>
                    )}
                    {ordered && sort === "custom" && (
                      <>
                        <button type="button" className={ghostButton} title="Move to top" onClick={() => commit(moveItems(lib, collectionId, selection, 0))}>
                          <ArrowUpToLine className="size-4" /> <span className="hidden lg:inline">Top</span>
                        </button>
                        <button
                          type="button"
                          className={ghostButton}
                          title="Move to bottom"
                          onClick={() => commit(moveItems(lib, collectionId, selection, Number.MAX_SAFE_INTEGER))}
                        >
                          <ArrowDownToLine className="size-4" /> <span className="hidden lg:inline">Bottom</span>
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className={`${ghostButton} text-red-600 dark:text-red-400`}
                      title="Remove from Keeper"
                      onClick={() => {
                        commit(removeBookmarks(lib, selection), `Removed ${plural(selection.length, "bookmark")}`);
                        setSelected(new Set());
                      }}
                    >
                      <Trash2 className="size-4" /> <span className="hidden sm:inline">Remove</span>
                    </button>
                    <button type="button" className={`${ghostButton} px-2`} onClick={() => setSelected(new Set())} aria-label="Clear selection">
                      <X className="size-4" />
                    </button>
                  </div>
                ) : (
                  <div className="min-w-0">
                    <h1 className="truncate text-sm font-semibold">{scopeName}</h1>
                    <p className="text-xs text-neutral-500" data-testid="view-count">
                      {deferredQuery ? `${fmtCount.format(ids.length)} of ${fmtCount.format(scopeTotal)} match` : plural(scopeTotal, "bookmark")}
                    </p>
                  </div>
                )}
                <div className="ml-auto flex items-center gap-2">
                  {ordered && canRestoreInstagramOrder(lib, collectionId) && (
                    <button
                      type="button"
                      className={ghostButton}
                      title="Put this list back in the order Instagram had it at your last import"
                      onClick={() => {
                        const next = restoreInstagramOrder(lib, collectionId);
                        setSort("custom");
                        if (next === lib) setToast({ message: "Already in Instagram's order", undo: false });
                        else commit(next, "Back in Instagram's order");
                      }}
                    >
                      <RotateCcw className="size-4" /> <span className="hidden xl:inline">Instagram&apos;s order</span>
                    </button>
                  )}
                  {ordered && sort !== "custom" && (
                    <button
                      type="button"
                      className={ghostButton}
                      title="Make this the custom order (the order that gets pushed to Instagram)"
                      onClick={() => {
                        commit(applyOrder(lib, collectionId, ids), `Saved ${SORTS.find((s) => s.value === sort)!.label} as your order`);
                        setSort("custom");
                      }}
                    >
                      <Check className="size-4" /> <span className="hidden sm:inline">Keep this order</span>
                    </button>
                  )}
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortMode)}
                    aria-label="Sort"
                    className="rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-800 dark:bg-neutral-900"
                  >
                    {SORTS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {ids.length === 0 ? (
                <p className="p-8 text-center text-sm text-neutral-500">
                  {deferredQuery
                    ? `Nothing matches “${deferredQuery}”.`
                    : scope.type === "duplicates"
                      ? "No duplicates found. Posts filed in several collections and look-alike posts show up here."
                      : scope.type === "collection"
                        ? "This collection is empty. Select bookmarks and use Add to collection."
                        : "Nothing here."}
                </p>
              ) : (
                <BookmarkList
                  lib={lib}
                  ids={ids}
                  viewKey={viewKey}
                  selected={selected}
                  onSelect={select}
                  canDrag={canDrag}
                  onMove={(moving, toIndex) => commit(moveItems(lib, collectionId, moving, toIndex))}
                  onDropToCollection={(moving, id) => {
                    const c = lib.collections.find((x) => x.id === id);
                    const already = c ? moving.filter((x) => c.items.includes(x)).length : 0;
                    const next = addToCollection(lib, id, moving);
                    if (next === lib) setToast({ message: `Already in “${c?.name}”`, undo: false });
                    else commit(next, `Added ${plural(moving.length - already, "bookmark")} to “${c?.name}”`);
                  }}
                  onRename={(id, title) => commit(renameBookmark(lib, id, title))}
                  membership={membership}
                  duplicates={duplicates}
                  showCollections={scope.type !== "collection"}
                  previewId={previewId}
                  onPreview={setPreviewId}
                />
              )}
            </>
          )}
        </main>

        {previewId && lib.bookmarks[previewId] && (
          <PreviewPanel
            bookmark={lib.bookmarks[previewId]}
            collections={membership.get(previewId) ?? []}
            index={ids.indexOf(previewId)}
            count={ids.length}
            onStep={(delta) => {
              const next = ids[ids.indexOf(previewId) + delta];
              if (next) setPreviewId(next);
            }}
            onClose={() => setPreviewId(null)}
          />
        )}
      </div>

      {importOpen && (
        <ImportDialog
          extension={extension}
          onClose={() => setImportOpen(false)}
          onImport={importResult}
          onThumbs={(items) => setLib((prev) => prev && applyThumbnails(prev, items))}
        />
      )}
      {pushOpen && <PushDialog lib={lib} extension={extension} onMerge={(next) => commit(next)} onClose={() => setPushOpen(false)} />}
      {confirming && <ConfirmDialog {...confirming} onClose={() => setConfirming(null)} />}

      {(toast || saveError) && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <div role="status" className="pointer-events-auto flex items-center gap-3 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900">
            {saveError ? "Couldn't save on this device. Check your browser storage settings." : toast!.message}
            {toast?.undo && !saveError && (
              <button type="button" onClick={undo} className="font-semibold text-violet-300 dark:text-accent">
                Undo
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface Confirmation {
  title: string;
  message: string;
  action: string;
  run: () => void;
}

function ConfirmDialog({ title, message, action, run, onClose }: Confirmation & { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-900"
      >
        <h2 id="confirm-title" className="font-semibold">
          {title}
        </h2>
        <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={ghostButton} onClick={onClose} autoFocus>
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
            onClick={() => {
              run();
              onClose();
            }}
          >
            {action}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddToCollectionMenu({
  open,
  onClose,
  lib,
  exclude,
  onPick,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  lib: Library;
  exclude: string | null;
  onPick: (id: string, name: string) => void;
  onCreate: (name: string) => string | null;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Popover open={open} onClose={onClose}>
      {lib.collections
        .filter((c) => c.id !== exclude)
        .map((c) => (
          <button key={c.id} type="button" className={menuItem} onClick={() => onPick(c.id, c.name)}>
            <span className="truncate">{c.name}</span>
            <span className="ml-auto text-xs text-neutral-500">{fmtCount.format(c.items.length)}</span>
          </button>
        ))}
      <form
        className="mt-1 border-t border-neutral-200 p-1.5 dark:border-neutral-800"
        onSubmit={(e) => {
          e.preventDefault();
          const problem = onCreate(name);
          setError(problem);
          if (!problem) setName("");
        }}
      >
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="New collection…"
          className="w-full rounded-md border border-neutral-200 bg-transparent px-2 py-1 text-sm outline-none focus:border-accent dark:border-neutral-700"
        />
        {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </form>
    </Popover>
  );
}

function Welcome({ onImport, onSample }: { onImport: () => void; onSample: (size: number) => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold tracking-tight">Your saves, finally in order.</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          Bring in your Instagram saved posts, then sort them A–Z or by hand, rename them, file them into collections, search them
          and spot duplicates.
        </p>
        <button type="button" onClick={onImport} className={`${primaryButton} mt-6 px-5 py-2.5 text-base`}>
          <Upload className="size-5" /> Import from Instagram
        </button>
        <div className="mt-6 text-xs text-neutral-500">
          Just looking?{" "}
          <button type="button" className="font-medium text-accent underline-offset-2 hover:underline" onClick={() => onSample(500)}>
            Try 500 sample bookmarks
          </button>{" "}
          ·{" "}
          <button type="button" className="font-medium text-accent underline-offset-2 hover:underline" onClick={() => onSample(10_000)}>
            10,000
          </button>{" "}
          ·{" "}
          <button type="button" className="font-medium text-accent underline-offset-2 hover:underline" onClick={() => onSample(50_000)}>
            50,000
          </button>
        </div>
      </div>
    </div>
  );
}
