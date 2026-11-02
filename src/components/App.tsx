"use client";

import {
  ArrowDownToLine,
  ArrowUpToLine,
  FolderMinus,
  FolderPlus,
  Loader2,
  Menu,
  Pause,
  Copy,
  Puzzle,
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
  copyBookmarks,
  applyOrder,
  createCollection,
  deleteCollection,
  emptyLibrary,
  mergeImport,
  moveCollection,
  moveItems,
  orderCollections,
  markSeen,
  canRestoreInstagramOrder,
  restoreCollectionOrder,
  restoreInstagramOrder,
  removeBookmarks,
  removeFromCollection,
  renameBookmark,
  renameCollection,
} from "@/lib/library/ops";
import { countLibrary, viewIds, type CollectionSort, type Scope, type SortMode } from "@/lib/library/query";
import { readCollections, readNewSaves, useExtension, type ExtensionState } from "@/lib/extension";
import { collectionsFromLibrary, mergeNewSaves } from "@/lib/instagram-read";
import { describe, entryLabel, identityOf, newLibraryId, routeImport, sameIdentity, type LibraryIndex } from "@/lib/libraries";
import { deleteLibrary, loadLibrary, openLibraries, saveIndex, saveLibrary } from "@/lib/storage";
import { syntheticImport } from "@/lib/synthetic";
import type { Bookmark, ImportResult, InstagramAccount, Library } from "@/lib/types";
import type { MergeSummary } from "@/lib/library/ops";
import { AccountMenu } from "./AccountMenu";
import { CollectionsFix } from "./CollectionsFix";
import { DiagnosePanel } from "./DiagnosePanel";
import { ExtensionGuide } from "./ExtensionGuide";
import { BookmarkList } from "./BookmarkList";
import { ImportDialog } from "./ImportDialog";
import { PreviewPanel } from "./PreviewPanel";
import { PushDialog } from "./PushDialog";
import { Sidebar } from "./Sidebar";
import { Popover, fmtCount, ghostButton, menuItem, plural, primaryButton } from "./ui";

type Arrangement = SortMode | "instagram";

/** "Arrange" sets the order for good (undoable); there's one order per list, the one dragging edits and Sync sends to Instagram. */
const ARRANGEMENTS: { value: Arrangement; label: string; done: string }[] = [
  { value: "custom", label: "Your order", done: "" },
  { value: "az", label: "Name A–Z", done: "Arranged A–Z" },
  { value: "za", label: "Name Z–A", done: "Arranged Z–A" },
  { value: "newest", label: "Newest saved first", done: "Newest saved first" },
  { value: "oldest", label: "Oldest saved first", done: "Oldest saved first" },
  { value: "instagram", label: "Instagram's order", done: "Back in Instagram's order" },
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
  // Which arrangement was last applied to the open list, until the user drags.
  const [arranged, setArranged] = useState<Arrangement>("custom");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [autoImport, setAutoImport] = useState(false);
  // An import keeps running (and its window stays mounted, hidden) when the window is closed.
  const [importRunning, setImportRunning] = useState(false);
  // Keeps the window (and its summary) around after an import that ran while it was closed.
  const [importAlive, setImportAlive] = useState(false);
  const importOpenRef = useRef(importOpen);
  importOpenRef.current = importOpen;
  const onImportRunning = useCallback((running: boolean) => {
    setImportRunning((was) => {
      if (was && !running && !importOpenRef.current) {
        setToast({ message: "Import finished. Click Import to see the summary.", undo: false });
      }
      return running;
    });
    if (running) setImportAlive(true);
  }, []);
  const extension = useExtension();
  const [drawer, setDrawer] = useState(false);
  const [addMenu, setAddMenu] = useState(false);
  const [toast, setToast] = useState<{ message: string; undo: boolean } | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [copyMenu, setCopyMenu] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // One library per Instagram account. Load the open one, then save it
  // (debounced) after every change, keeping the index's summary current.
  const [index, setIndex] = useState<LibraryIndex | null>(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  const skipSave = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cover images by post, so ones that arrive while switching libraries still land.
  const thumbs = useRef(new Map<string, string>());

  useEffect(() => {
    openLibraries()
      .then(({ index: loadedIndex, lib: loadedLib }) => {
        setIndex(loadedIndex);
        setLib(loadedLib);
      })
      .catch(() => {
        const id = newLibraryId();
        const fresh = emptyLibrary();
        setIndex({ version: 1, active: id, entries: [describe(id, fresh, Date.now())] });
        setLib(fresh);
      });
  }, []);

  const persist = useCallback(async (id: string, l: Library) => {
    try {
      await saveLibrary(id, l);
      setSaveError(false);
      const current = indexRef.current;
      const entry = current?.entries.find((e) => e.id === id);
      if (!current || !entry) return;
      const next = describe(id, l, entry.createdAt);
      if (next.count !== entry.count || next.username !== entry.username || next.userId !== entry.userId) {
        const updated = { ...current, entries: current.entries.map((e) => (e.id === id ? next : e)) };
        indexRef.current = updated;
        setIndex(updated);
        await saveIndex(updated);
      }
    } catch {
      setSaveError(true);
    }
  }, []);

  useEffect(() => {
    if (!lib || !index) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    const id = index.active;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      persist(id, lib);
    }, 400);
  }, [lib]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Saves the open library now (before switching away from it). */
  const flush = async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (lib && index) await persist(index.active, lib);
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  // With the extension, pick up posts saved on Instagram since the last
  // visit: once per page load, and not while a sync is running.
  const libRef = useRef(lib);
  libRef.current = lib;
  const refreshed = useRef(false);
  // The import arriving page by page (see streamStart).
  const stream = useRef<{ flagNew: boolean; inserted: number; added: number } | null>(null);
  const rememberThumbs = (items: { code: string; data: string }[]) => {
    for (const { code, data } of items) thumbs.current.set(code, data);
    setLib((prev) => prev && applyThumbnails(prev, items));
  };
  useEffect(() => {
    const current = libRef.current;
    if (refreshed.current || !current?.instagram || current.order.length === 0 || extension.status !== "ready") return;
    if (extension.job && (extension.job.status === "running" || extension.job.status === "waiting")) return;
    refreshed.current = true;
    const known = (current.instagramOrder?.length ? current.instagramOrder : current.order).slice(0, 60);
    readNewSaves(known, rememberThumbs).then(
      (read) => {
        const latest = libRef.current;
        if (!latest || read.account.userId !== latest.instagram?.userId) return;
        const { library, added } = mergeNewSaves(latest, read);
        if (!added) return;
        setHistory((h) => [...h.slice(-(HISTORY - 1)), latest]);
        setLib(library);
        setToast({ message: `${plural(added, "new save")} from Instagram`, undo: true });
      },
      () => {
        // Not logged in, offline or Instagram busy: try again next visit.
      },
    );
  }, [lib, extension.status, extension.job]);

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
  // Posts know which Instagram collections they're in, but the collections themselves didn't come in.
  const collectionsMissing = useMemo(
    () => Boolean(lib) && !lib!.collections.some((c) => c.instagramId) && Object.values(lib!.bookmarks).some((b) => b.igCollections?.length),
    [lib?.bookmarks, lib?.collections], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const counts = useMemo(() => countLibrary(lib ?? emptyLibrary()), [lib?.order, lib?.collections, lib?.bookmarks]); // eslint-disable-line react-hooks/exhaustive-deps
  const ids = useMemo(
    () => (lib ? viewIds(lib, { scope, sort: "custom", query: deferredQuery, duplicates }) : []),
    [lib, scope, deferredQuery, duplicates],
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

  // The open library's entry, kept live (the stored index catches up on save).
  const accounts = useMemo(
    () =>
      index && lib
        ? { ...index, entries: index.entries.map((e) => (e.id === index.active ? describe(e.id, lib, e.createdAt) : e)) }
        : index,
    [index, lib],
  );

  if (!lib || !index) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  const collectionId = scope.type === "collection" ? scope.id : null;
  const ordered = scope.type === "all" || scope.type === "collection";
  const canDrag = ordered && !deferredQuery;
  const scopeName =
    scope.type === "all"
      ? "All bookmarks"
      : scope.type === "unfiled"
        ? "Not in a collection"
        : scope.type === "new"
          ? "New since your last import"
          : scope.type === "duplicates"
            ? "Possible duplicates"
            : (lib.collections.find((c) => c.id === scope.id)?.name ?? "");
  const scopeTotal =
    scope.type === "all"
      ? counts.total
      : scope.type === "unfiled"
        ? counts.unfiled
        : scope.type === "new"
          ? counts.fresh
          : scope.type === "duplicates"
            ? duplicates.flagged.size
            : (counts.collections[scope.id] ?? 0);
  const selection = ids.filter((id) => selected.has(id));
  const viewKey = JSON.stringify([scope, arranged]);

  const changeScope = (next: Scope) => {
    // Opening a new collection counts as seeing it.
    if (next.type === "collection" && lib.collections.find((c) => c.id === next.id)?.isNew) {
      setLib(markSeen(lib, [next.id]));
    }
    setScope(next);
    setArranged("custom");
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

  /** Opens another account's library. Returns it, so callers can keep working with it. */
  const switchLibrary = async (id: string, message?: string): Promise<Library> => {
    await flush();
    const loadedLib = (await loadLibrary(id)) ?? emptyLibrary();
    const withThumbs = applyThumbnails(loadedLib, [...thumbs.current].map(([code, data]) => ({ code, data })));
    const nextIndex = { ...indexRef.current!, active: id };
    indexRef.current = nextIndex;
    setIndex(nextIndex);
    saveIndex(nextIndex).catch(() => undefined);
    skipSave.current = withThumbs === loadedLib;
    setLib(withThumbs);
    setHistory([]);
    setScope({ type: "all" });
    setArranged("custom");
    setSelected(new Set());
    setPreviewId(null);
    setQuery("");
    refreshed.current = false;
    const entry = nextIndex.entries.find((e) => e.id === id);
    setToast({ message: message ?? `Switched to ${entry ? entryLabel(entry) : "that account"}`, undo: false });
    return withThumbs;
  };

  /** Adds an empty library for another Instagram account and opens it. */
  const addLibrary = async (): Promise<Library> => {
    await flush();
    const id = newLibraryId();
    const fresh = emptyLibrary();
    await saveLibrary(id, fresh);
    const nextIndex = { ...indexRef.current!, entries: [...indexRef.current!.entries, describe(id, fresh, Date.now())] };
    indexRef.current = nextIndex;
    setIndex(nextIndex);
    return switchLibrary(id, "Added a new account. Import its saves to fill it.");
  };

  const removeLibrary = (id: string) => {
    const entry = index.entries.find((e) => e.id === id);
    if (!entry || id === index.active) return;
    setConfirming({
      title: `Delete ${entryLabel(entry)}'s library?`,
      message: `This removes its ${plural(entry.count, "bookmark")}, names and collections from Keeper on this device. The Instagram account isn't touched.`,
      action: "Delete library",
      run: async () => {
        await deleteLibrary(id).catch(() => undefined);
        const nextIndex = { ...indexRef.current!, entries: indexRef.current!.entries.filter((e) => e.id !== id) };
        indexRef.current = nextIndex;
        setIndex(nextIndex);
        await saveIndex(nextIndex).catch(() => undefined);
        setToast({ message: `Deleted ${entryLabel(entry)}'s library`, undo: false });
      },
    });
  };

  /** Asks where an import from another account should go. */
  const askWhere = (username: string | null) =>
    new Promise<"new" | "here">((resolve) =>
      setChoice({
        title: username ? `These are @${username}'s saves` : "These saves are from another Instagram account",
        message: `The open library (${entryLabel(index.entries.find((e) => e.id === index.active)!)}) already has other saves. Keeper keeps each Instagram account in its own library.`,
        primary: { label: username ? `New library for @${username}` : "New library for this account", run: () => resolve("new") },
        secondary: { label: "Add to the open library", run: () => resolve("here") },
      }),
    );

  /** Brings an import into the right account's library, switching or creating one when it's another account's. */
  const importResult = async (result: ImportResult): Promise<MergeSummary> => {
    const incoming = { userId: result.account?.userId, username: result.account?.username ?? result.sourceUsername };
    const route = routeImport(index, lib, incoming, result.bookmarks.map((b) => b.id));
    let target = lib;
    let elsewhere = false;
    if (route.kind === "switch") {
      target = await switchLibrary(route.id);
      elsewhere = true;
    } else if (route.kind === "ask" && (await askWhere(incoming.username ?? null)) === "new") {
      target = await addLibrary();
      elsewhere = true;
    }
    const { library, summary } = mergeImport(target, result);
    if (elsewhere) setLib(library);
    else commit(library);
    return summary;
  };

  // An import from the extension arrives page by page, so the library fills
  // in while it reads. The whole import is one Undo step.

  const streamStart = async (account: InstagramAccount, firstIds: string[]) => {
    const current = libRef.current!;
    const route = routeImport(index, current, { userId: account.userId, username: account.username }, firstIds);
    let target = current;
    if (route.kind === "switch") target = await switchLibrary(route.id);
    else if (route.kind === "ask" && (await askWhere(account.username ?? null)) === "new") target = await addLibrary();
    else setHistory((h) => [...h.slice(-(HISTORY - 1)), current]);
    if (!target.importing) target = { ...target, importBase: target.order.length };
    libRef.current = target;
    // Flag New only if an earlier import finished; a library still part-way
    // through its first import (it stopped and this carries on) isn't "new".
    // A resumed import's earlier pages sit at the top; new pages go below them.
    const alreadyIn = target.order.length - (target.importBase ?? target.order.length);
    stream.current = {
      flagNew: Boolean(target.lastImportAt) || (target.order.length > 0 && !target.importing),
      inserted: Math.max(0, alreadyIn),
      added: 0,
    };
  };

  const streamPage = (bookmarks: Bookmark[], account: InstagramAccount) => {
    const session = stream.current;
    const current = libRef.current;
    if (!session || !current) return;
    const page: ImportResult = { bookmarks, collections: [], mergedDuplicates: 0, skipped: 0, warnings: [], account, partial: true };
    const merged = mergeImport(current, page, { flagNew: session.flagNew, insertAt: session.inserted });
    const library: Library = merged.library.importing ? merged.library : { ...merged.library, importing: true };
    session.inserted += merged.summary.added;
    session.added += merged.summary.added;
    libRef.current = library;
    setLib(library);
  };

  const streamEnd = (result: ImportResult): MergeSummary => {
    const session = stream.current;
    stream.current = null;
    const merged = mergeImport(libRef.current!, result, { flagNew: session?.flagNew });
    // Counted from where the import began, including any earlier attempt that stopped part-way.
    const { importBase, ...library } = merged.library;
    const added = importBase !== undefined ? library.order.length - importBase : (session?.added ?? 0) + merged.summary.added;
    libRef.current = library;
    setLib(library);
    return { ...merged.summary, added };
  };

  /** Reads collection names off the Saved page of `username` and files the library's posts into them. */
  const getCollections = async (username: string): Promise<number> => {
    const { collections } = await readCollections(username);
    if (!collections.length) {
      throw new Error(`Keeper couldn't find any collections on @${username}'s Saved page. Check the username, and that Instagram in this browser is logged into that account.`);
    }
    const current = libRef.current!;
    // Remember the username for this library.
    const named: Library = current.instagram
      ? { ...current, instagram: { ...current.instagram, username: current.instagram.username ?? username } }
      : { ...current, exportUsername: current.exportUsername ?? username };
    const { library, summary } = mergeImport(named, collectionsFromLibrary(named, collections), { flagNew: false });
    commit(library, `Added ${plural(summary.collectionsAdded, "collection")}`);
    return summary.collectionsAdded;
  };

  /** Just the saves made since the last import, into the open library. */
  const quickCheck = async (): Promise<number> => {
    const current = libRef.current!;
    const known = (current.instagramOrder?.length ? current.instagramOrder : current.order).slice(0, 60);
    const read = await readNewSaves(known, rememberThumbs);
    const latest = libRef.current!;
    if (read.account.userId !== latest.instagram?.userId) throw new Error("Instagram in this browser is logged into a different account now.");
    const { library, added } = mergeNewSaves(latest, read);
    if (added) commit(library, `${plural(added, "new save")} from Instagram`);
    return added;
  };

  /** Copies bookmarks into another account's library, to be saved there by its next Sync. */
  const copyTo = async (id: string, ids: string[]) => {
    await flush();
    const target = (await loadLibrary(id)) ?? emptyLibrary();
    const collectionName = scope.type === "collection" ? lib.collections.find((c) => c.id === scope.id)?.name : undefined;
    const { library, copied } = copyBookmarks(target, lib, ids, collectionName);
    await persist(id, library);
    const entry = index.entries.find((e) => e.id === id);
    const label = entry ? entryLabel(entry) : "that account";
    setToast({
      message: copied
        ? `Copied ${plural(copied, "bookmark")} to ${label}${collectionName ? ` (in “${collectionName}”)` : ""}. Open ${label} and Sync to save them on Instagram.`
        : `${label} already has ${ids.length === 1 ? "it" : "them"}.`,
      undo: false,
    });
  };

  const loadSample = (size: number) => {
    commit(mergeImport(lib, syntheticImport(size, { collections: 8, covers: true })).library, `Loaded ${plural(size, "sample bookmark")}`);
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
      title: "Empty this library?",
      message: "This removes every bookmark, name and collection in this account's library from Keeper on this device. Your Instagram account isn't touched.",
      action: "Empty library",
      run: () => {
        setHistory([]);
        setLib(emptyLibrary());
        changeScope({ type: "all" });
      },
    });

  const arrange = (mode: Arrangement) => {
    setArranged(mode);
    if (mode === "custom") return;
    const next =
      mode === "instagram"
        ? restoreInstagramOrder(lib, collectionId)
        : applyOrder(lib, collectionId, viewIds(lib, { scope, sort: mode, query: "", duplicates }));
    const label = ARRANGEMENTS.find((a) => a.value === mode)!;
    if (next === lib) setToast({ message: `Already in that order`, undo: false });
    else commit(next, label.done);
  };

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
      <header className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2.5 sm:gap-3 sm:px-4 dark:border-neutral-800">
        <button type="button" onClick={() => setDrawer(true)} className="rounded-md p-1.5 md:hidden" aria-label="Open collections">
          <Menu className="size-5" />
        </button>
        <div className="flex shrink-0 items-baseline gap-2">
          <span className="text-lg font-bold tracking-tight">
            keeper<span className="text-accent">.cool</span>
          </span>
        </div>
        <AccountMenu index={accounts!} onSwitch={(id) => switchLibrary(id)} onAdd={() => addLibrary()} onRemove={removeLibrary} />
        {/* On a phone the search gets its own row under the header. */}
        <label className="relative order-last flex w-full items-center sm:order-none sm:ml-auto sm:w-auto sm:max-w-md sm:min-w-0 sm:flex-1">
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
        <button type="button" onClick={undo} disabled={!history.length} className={`${ghostButton} px-2 max-sm:hidden`} title="Undo (Ctrl/⌘ Z)" aria-label="Undo">
          <Undo2 className="size-4" />
        </button>
        <button type="button" onClick={() => setImportOpen(true)} className={`${ghostButton} px-2 max-sm:ml-auto sm:px-3`} aria-label="Import">
          {importRunning ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}{" "}
          <span className="hidden sm:inline">{importRunning ? "Importing…" : "Import"}</span>
        </button>
        <div className="hidden lg:block">
          {extension.job && ["running", "waiting", "paused", "blocked"].includes(extension.job.status) ? (
            <button type="button" onClick={() => setPushOpen(true)} className={primaryButton} title="Sync progress">
              {extension.job.status === "blocked" || extension.job.status === "paused" ? (
                <Pause className="size-4" />
              ) : (
                <Loader2 className="size-4 animate-spin" />
              )}
              Syncing {fmtCount.format(extension.job.done)}/{fmtCount.format(extension.job.total)}
            </button>
          ) : extension.status === "ready" ? (
            <button type="button" onClick={() => setPushOpen(true)} disabled={empty} className={primaryButton}>
              <Send className="size-4" /> Sync to Instagram
            </button>
          ) : (
            <button type="button" onClick={() => setGuideOpen(true)} className={primaryButton} title="Syncing to Instagram needs the Keeper extension">
              <Send className="size-4" /> Sync to Instagram
            </button>
          )}
        </div>
      </header>

      {extension.status === "stale" && (
        <div role="alert" className="flex items-center justify-center gap-3 bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
          The Keeper extension was updated. Reload this page to reconnect.
          <button type="button" onClick={() => location.reload()} className="rounded-md bg-amber-900 px-2.5 py-1 font-medium text-white dark:bg-amber-200 dark:text-amber-950">
            Reload
          </button>
        </div>
      )}
      {collectionsMissing && extension.status === "ready" && !importRunning && (
        <div role="status" className="flex flex-wrap items-center justify-center gap-3 bg-accent-soft px-4 py-2 text-sm dark:bg-accent/15">
          Your Instagram collections aren&apos;t in Keeper yet.
          <button type="button" onClick={() => setCollectionsOpen(true)} className={primaryButton}>
            Get collections
          </button>
        </div>
      )}
      {guideOpen && <ExtensionGuide onClose={() => setGuideOpen(false)} />}
      {collectionsOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => setCollectionsOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Get your Instagram collections"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl dark:bg-neutral-900"
          >
            <h2 className="text-lg font-semibold">Get your Instagram collections</h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Your posts already know which collections they&apos;re in. Keeper only needs the collections&apos; names, from your
              Saved page: a small Instagram window opens for a moment and closes by itself.
            </p>
            <CollectionsFix initial={identityOf(lib).username} onGetCollections={getCollections} />
            <DiagnosePanel
              hint={lib.instagram?.userId && lib.instagram.username ? { userId: lib.instagram.userId, username: lib.instagram.username } : null}
            />
            <div className="flex justify-end">
              <button type="button" onClick={() => setCollectionsOpen(false)} className={ghostButton}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
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
            onExtension={() => setGuideOpen(true)}
            onReset={reset}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {empty ? (
            <Welcome
              extension={extension}
              onImport={() => {
                setAutoImport(true);
                setImportOpen(true);
              }}
              onExport={() => setImportOpen(true)}
              onExtension={() => setGuideOpen(true)}
              onSample={loadSample}
            />
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
                    {index.entries.length > 1 && (
                      <div className="relative">
                        <button type="button" className={ghostButton} onClick={() => setCopyMenu(true)} title="Copy to another Instagram account">
                          <Copy className="size-4" /> <span className="hidden sm:inline">Copy to…</span>
                        </button>
                        <Popover open={copyMenu} onClose={() => setCopyMenu(false)}>
                          <p className="px-2.5 pt-1.5 pb-1 text-xs text-neutral-500">Copy to another account&apos;s library</p>
                          {accounts!.entries
                            .filter((e) => e.id !== index.active)
                            .map((e) => (
                              <button
                                key={e.id}
                                type="button"
                                className={menuItem}
                                onClick={() => {
                                  setCopyMenu(false);
                                  copyTo(e.id, selection);
                                }}
                              >
                                {entryLabel(e)}
                                <span className="ml-auto text-xs text-neutral-500">{fmtCount.format(e.count)}</span>
                              </button>
                            ))}
                        </Popover>
                      </div>
                    )}
                    {ordered && (
                      <>
                        <button
                          type="button"
                          className={ghostButton}
                          title="Move to top"
                          onClick={() => {
                            commit(moveItems(lib, collectionId, selection, 0));
                            setArranged("custom");
                          }}
                        >
                          <ArrowUpToLine className="size-4" /> <span className="hidden lg:inline">Top</span>
                        </button>
                        <button
                          type="button"
                          className={ghostButton}
                          title="Move to bottom"
                          onClick={() => {
                            commit(moveItems(lib, collectionId, selection, Number.MAX_SAFE_INTEGER));
                            setArranged("custom");
                          }}
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
                  {scope.type === "new" && selection.length === 0 && (
                    <button
                      type="button"
                      className={ghostButton}
                      onClick={() => {
                        commit(markSeen(lib), "Marked everything as seen");
                        changeScope({ type: "all" });
                      }}
                    >
                      Mark all as seen
                    </button>
                  )}
                  {ordered && (
                    <select
                      value={arranged}
                      onChange={(e) => arrange(e.target.value as Arrangement)}
                      aria-label="Sort"
                      title="Arrange this list. It becomes your order: drag to fine-tune, Undo to go back."
                      className="rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-800 dark:bg-neutral-900"
                    >
                      {ARRANGEMENTS.filter((a) => a.value !== "instagram" || canRestoreInstagramOrder(lib, collectionId)).map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.value === "custom" ? a.label : `Arrange: ${a.label}`}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {ids.length === 0 ? (
                <p className="p-8 text-center text-sm text-neutral-500">
                  {deferredQuery
                    ? `Nothing matches “${deferredQuery}”.`
                    : scope.type === "new"
                      ? "Nothing new. Posts and collections that arrive with a later import show up here."
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
                  onMove={(moving, toIndex) => {
                    commit(moveItems(lib, collectionId, moving, toIndex));
                    setArranged("custom");
                  }}
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
                  showDuplicates={scope.type === "duplicates"}
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

      {(importOpen || importAlive) && (
        <ImportDialog
          hidden={!importOpen}
          onRunningChange={onImportRunning}
          onGetCollections={getCollections}
          onShowExtension={() => setGuideOpen(true)}
          libraryCount={lib.instagram && !lib.importing ? lib.order.length : 0}
          onQuickCheck={quickCheck}
          extension={extension}
          autoStart={autoImport}
          onClose={() => {
            setImportOpen(false);
            setAutoImport(false);
            // A running import carries on out of sight; a finished one can go.
            if (!importRunning) setImportAlive(false);
          }}
          onImport={importResult}
          onThumbs={rememberThumbs}
          onStreamStart={streamStart}
          onStreamPage={streamPage}
          onStreamEnd={streamEnd}
          hint={lib.instagram?.userId && lib.instagram.username ? { userId: lib.instagram.userId, username: lib.instagram.username } : null}
          usernameHint={identityOf(lib).username ?? null}
          estimateFor={(account) => {
            // The library of this account, or the open one if it holds an import whose account wasn't known yet.
            const entry = accounts!.entries.find((e) => sameIdentity(e, account));
            if (entry?.count) return entry.count;
            const own = identityOf(lib);
            return !own.userId && !own.username && lib.order.length ? lib.order.length : null;
          }}
        />
      )}
      {pushOpen && <PushDialog lib={lib} extension={extension} onMerge={(next) => commit(next)} onClose={() => setPushOpen(false)} />}
      {confirming && <ConfirmDialog {...confirming} onClose={() => setConfirming(null)} />}
      {choice && <ChoiceDialog {...choice} onClose={() => setChoice(null)} />}

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

interface Choice {
  title: string;
  message: string;
  primary: { label: string; run: () => void };
  secondary: { label: string; run: () => void };
}

function ChoiceDialog({ title, message, primary, secondary, onClose }: Choice & { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="choice-title" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-900">
        <h2 id="choice-title" className="font-semibold">
          {title}
        </h2>
        <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">{message}</p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            className={`${primaryButton} justify-center py-2`}
            onClick={() => {
              primary.run();
              onClose();
            }}
            autoFocus
          >
            {primary.label}
          </button>
          <button
            type="button"
            className={`${ghostButton} justify-center`}
            onClick={() => {
              secondary.run();
              onClose();
            }}
          >
            {secondary.label}
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

function Welcome({
  extension,
  onImport,
  onExport,
  onExtension,
  onSample,
}: {
  extension: ExtensionState;
  onImport: () => void;
  onExport: () => void;
  onExtension: () => void;
  onSample: (size: number) => void;
}) {
  const ready = extension.status === "ready";
  // The extension needs Chrome on a computer: on a phone, lead with Instagram's export instead.
  // Worked out after the first render, so the page the server sent matches.
  const [phone, setPhone] = useState(false);
  const [bench, setBench] = useState(false);
  useEffect(() => {
    setPhone(/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)));
    setBench(new URLSearchParams(location.search).has("bench"));
  }, []);
  const steps = phone
    ? [
        { label: "Ask Instagram for a copy of your saves", done: false },
        { label: "Bring the file into Keeper", done: false },
        { label: "Sort, rename and file them your way", done: false },
      ]
    : [
        { label: "Add Keeper to Chrome", done: ready },
        { label: "Bring in your saves", done: false },
        { label: "Arrange them, then sync to Instagram", done: false },
      ];
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold tracking-tight text-balance">Your Instagram saves, finally in order.</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          Sort them A–Z or by hand, rename them, file them into collections, find anything, and put the new order back on Instagram.
        </p>
        <ol className="mx-auto mt-6 max-w-xs space-y-2 text-left text-sm">
          {steps.map((step, i) => (
            <li key={step.label} className="flex items-center gap-3">
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  step.done ? "bg-emerald-500 text-white" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                }`}
              >
                {step.done ? "✓" : i + 1}
              </span>
              <span className={step.done ? "text-neutral-500 line-through" : ""}>{step.label}</span>
            </li>
          ))}
        </ol>
        {phone && !ready ? (
          <>
            <button type="button" onClick={onExport} className={`${primaryButton} mt-6 px-5 py-2.5 text-base`}>
              <Upload className="size-5" /> Bring in your saves
            </button>
            <p className="mt-3 text-sm text-neutral-500">
              Tip: on a computer with Chrome, the Keeper extension does this in one click, and can sync your order back to Instagram.
            </p>
          </>
        ) : ready ? (
          <button type="button" onClick={onImport} className={`${primaryButton} mt-6 px-5 py-2.5 text-base`}>
            <Upload className="size-5" /> Import from Instagram
          </button>
        ) : (
          <button type="button" onClick={onExtension} className={`${primaryButton} mt-6 px-5 py-2.5 text-base`}>
            <Puzzle className="size-5" /> Add Keeper to Chrome
          </button>
        )}
        {!ready && !phone && (
          <p className="mt-4 text-sm">
            <button type="button" onClick={onExport} className="font-medium text-accent underline-offset-2 hover:underline">
              On a phone or another browser? Upload Instagram&apos;s export instead
            </button>
          </p>
        )}
        <div className="mt-8 text-xs text-neutral-500">
          Just looking?{" "}
          <button type="button" className="font-medium text-accent underline-offset-2 hover:underline" onClick={() => onSample(500)}>
            Try it with sample bookmarks
          </button>
          {bench && (
            <>
              {" "}
              ·{" "}
              <button type="button" className="font-medium text-accent underline-offset-2 hover:underline" onClick={() => onSample(10_000)}>
                10,000
              </button>{" "}
              ·{" "}
              <button type="button" className="font-medium text-accent underline-offset-2 hover:underline" onClick={() => onSample(50_000)}>
                50,000
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
