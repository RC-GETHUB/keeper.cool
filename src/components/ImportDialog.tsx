"use client";

import { ArrowLeftRight, ChevronDown, FileArchive, Loader2, Lock, Puzzle, Upload, X, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  ExtensionError,
  instagramAccount,
  logInToInstagram,
  readInstagram,
  switchInstagramAccount,
  type ExtensionState,
  type UsernameHint,
} from "@/lib/extension";
import { readExport } from "@/lib/import";
import { fromInstagramRead, type InstagramMedia } from "@/lib/instagram-read";
import type { MergeSummary } from "@/lib/library/ops";
import type { Bookmark, ImportResult, InstagramAccount } from "@/lib/types";
import { CollectionsFix, cleanUsername } from "./CollectionsFix";
import { DiagnosePanel } from "./DiagnosePanel";
import { ImportProgress, type LiveRead } from "./ImportProgress";
import { fmtCount, formatDate, ghostButton, plural, primaryButton } from "./ui";

interface Props {
  extension: ExtensionState;
  /** Start importing from Instagram straight away (the welcome screen's button). */
  autoStart?: boolean;
  onClose: () => void;
  /** Merges the import into the right account's library (which may mean switching to it). */
  onImport: (result: ImportResult) => MergeSummary | Promise<MergeSummary>;
  /** Cover images arrive in batches, during and after the import. */
  onThumbs: (items: { code: string; data: string }[]) => void;
  /**
   * An import from Instagram arrives page by page: start (which picks the
   * right account's library from the first page), each page, then the end.
   */
  onStreamStart: (account: InstagramAccount, firstIds: string[]) => Promise<void>;
  onStreamPage: (bookmarks: Bookmark[], account: InstagramAccount) => void;
  onStreamEnd: (result: ImportResult) => MergeSummary;
  /** How many saved posts the last import of this account found, to show "of about N" when Instagram won't say. */
  estimateFor?: (account: InstagramAccount) => number | null;
  /** The open library's account, in case Instagram won't say the username. Only used if it's the account logged in. */
  hint?: UsernameHint | null;
  /** The account name Keeper knows for the open library, to prefill "What's your username?". */
  usernameHint?: string | null;
  /** Reads collection names from the Saved page of `username` and files the library's posts into them. Resolves to how many. */
  onGetCollections: (username: string) => Promise<number>;
  /** Kept mounted (hidden) while an import runs, so reopening shows its progress. */
  hidden?: boolean;
  onRunningChange?: (running: boolean) => void;
  /** Opens the extension install guide over the app. */
  onShowExtension?: () => void;
  /** Brings in just the saves made since the last import, into the open library. Resolves to how many. */
  onQuickCheck?: () => Promise<number>;
  /** How many posts the open library holds, for the open library's own account. */
  libraryCount?: number;
}

type Status =
  | { state: "idle" }
  | { state: "reading" }
  /** Which Instagram account is about to be read: null while checking. */
  | { state: "confirm"; account: InstagramAccount | null; switching?: boolean }
  /** Checked for saves made since the last import: null while checking. */
  | { state: "quick"; added: number | null }
  | { state: "fetching"; live: LiveRead }
  | { state: "login"; waiting: boolean; message?: string }
  | { state: "done"; result: ImportResult; summary: MergeSummary; source: "file" | "instagram" }
  | { state: "error"; message: string };


export function ImportDialog({
  extension,
  autoStart,
  onClose,
  onImport,
  onThumbs,
  onStreamStart,
  onStreamPage,
  onStreamEnd,
  estimateFor,
  hint,
  usernameHint,
  onGetCollections,
  hidden,
  onRunningChange,
  onShowExtension,
  onQuickCheck,
  libraryCount = 0,
}: Props) {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [thumbs, setThumbs] = useState<{ done: number; total: number; finished: boolean } | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const hasExtension = extension.status === "ready";

  const handle = async (files: File[]) => {
    if (!files.length) return;
    setStatus({ state: "reading" });
    try {
      const result = await readExport(files);
      setStatus({ state: "done", result, summary: await onImport(result), source: "file" });
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : "Something went wrong reading that file." });
    }
  };

  const failed = (e: unknown) => {
    if (e instanceof ExtensionError && e.code === "login") {
      setStatus({ state: "login", waiting: false, message: e.message });
      return;
    }
    setStatus({
      state: "error",
      message: e instanceof ExtensionError || e instanceof Error ? e.message : "Something went wrong reading from Instagram.",
    });
  };

  /** Several accounts can be signed in on instagram.com: say which one is about to be read first. */
  const checkAccount = async () => {
    setStatus({ state: "confirm", account: null });
    try {
      setStatus({ state: "confirm", account: await instagramAccount() });
    } catch (e) {
      failed(e);
    }
  };

  const switchAccount = async (current: InstagramAccount) => {
    setStatus({ state: "confirm", account: current, switching: true });
    try {
      setStatus({ state: "confirm", account: await switchInstagramAccount(current) });
    } catch (e) {
      failed(e);
    }
  };

  const quickCheck = async () => {
    if (!onQuickCheck) return;
    setStatus({ state: "quick", added: null });
    try {
      setStatus({ state: "quick", added: await onQuickCheck() });
    } catch (e) {
      failed(e);
    }
  };

  const fromInstagram = async (chosen: UsernameHint | null) => {
    let live: LiveRead = { count: 0, total: null };
    const update = (patch: Partial<LiveRead>) => {
      live = { ...live, ...patch };
      setStatus({ state: "fetching", live });
    };
    update({});
    // Pages go into the library as they arrive, in order, after the first
    // one has picked which account's library they belong in.
    const pages: { chain: Promise<void> | null } = { chain: null };
    const toBookmarks = (media: InstagramMedia[], account: InstagramAccount) =>
      fromInstagramRead({ account, saved: media, collections: [] }).bookmarks;
    try {
      const read = await readInstagram((p) => {
        if (p.phase === "thumbs" || p.phase === "thumbs-done") {
          if (p.items?.length) onThumbs(p.items);
          setThumbs({ done: p.done ?? 0, total: p.total ?? 0, finished: p.phase === "thumbs-done" });
        } else if (p.phase === "account" && p.account) {
          update({ account: p.account, estimate: estimateFor?.(p.account) ?? null });
        } else if (p.phase === "page" && p.media && live.account) {
          const account = live.account;
          const bookmarks = toBookmarks(p.media, account);
          pages.chain = (pages.chain ?? onStreamStart(account, bookmarks.map((b) => b.id))).then(() => onStreamPage(bookmarks, account));
        } else if (p.phase === "saved") {
          update({ count: p.count ?? live.count, total: p.total ?? live.total, retryWait: undefined });
        } else if (p.phase === "collections") {
          update({ collections: { done: p.done ?? 0, total: p.total ?? 0, name: p.name }, retryWait: undefined });
        } else if (p.phase === "retry") {
          update({ retryWait: p.wait });
        }
      }, { hint: chosen ?? hint });
      await (pages.chain ?? onStreamStart(read.account, []));
      const result = fromInstagramRead(read);
      setStatus({ state: "done", result, summary: onStreamEnd(result), source: "instagram" });
    } catch (e) {
      // Whatever arrived before the problem stays in the library, and a retry carries on from there.
      await pages.chain?.catch(() => undefined);
      failed(e);
    }
  };

  const logIn = async () => {
    setStatus({ state: "login", waiting: true });
    try {
      await logInToInstagram();
      checkAccount();
    } catch (e) {
      setStatus({ state: "login", waiting: false, message: e instanceof Error ? e.message : undefined });
    }
  };

  const started = useRef(false);
  useEffect(() => {
    if (autoStart && hasExtension && !started.current) {
      started.current = true;
      checkAccount();
    }
  });

  const busy = status.state === "reading" || status.state === "fetching" || (status.state === "login" && status.waiting);
  useEffect(() => {
    onRunningChange?.(status.state === "fetching");
  }, [status.state, onRunningChange]);
  const exportOpen = !hasExtension || showExport;

  return (
    <div
      className={`fixed inset-0 z-40 items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4 ${hidden ? "hidden" : "flex"}`}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl dark:bg-neutral-900"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id="import-title" className="text-lg font-semibold">
            Import your Instagram saves
          </h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>

        {status.state === "done" ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200">
              <p className="font-medium">
                {status.summary.added > 0
                  ? `Added ${plural(status.summary.added, "bookmark")}.`
                  : "No new bookmarks — you're up to date."}
              </p>
              <ul className="mt-1 list-disc pl-5 text-emerald-800 dark:text-emerald-300">
                <li>
                  {plural(status.result.bookmarks.length, "saved post")}{" "}
                  {status.source === "file"
                    ? "found in the file"
                    : `on Instagram${status.result.account?.username ? ` (@${status.result.account.username})` : ""}`}
                </li>
                {status.summary.collectionsAdded > 0 && <li>{plural(status.summary.collectionsAdded, "new collection")}</li>}
                {/* On a first import every post is new; "updated" only means something on a later one. */}
                {status.summary.updated > 0 && status.summary.added < status.result.bookmarks.length && <li>{plural(status.summary.updated, "bookmark")} updated with new details</li>}
                {status.result.mergedDuplicates > 0 && (
                  <li>{plural(status.result.mergedDuplicates, "repeated entry", "repeated entries")} merged</li>
                )}
              </ul>
            </div>
            {status.source === "file" && <DateRangeHint result={status.result} />}
            {thumbs && (
              <div className="space-y-1.5 text-sm">
                <p className="text-neutral-600 dark:text-neutral-400">
                  {thumbs.finished
                    ? `Cover images added (${fmtCount.format(thumbs.done)}).`
                    : `Adding cover images: ${fmtCount.format(thumbs.done)} of ${fmtCount.format(thumbs.total)}. You can close this; it carries on.`}
                </p>
                <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                  <div className="h-full bg-accent transition-[width]" style={{ width: `${thumbs.total ? (100 * thumbs.done) / thumbs.total : 0}%` }} />
                </div>
              </div>
            )}
            {status.result.warnings.map((w) => (
              <p key={w} className="text-sm text-amber-700 dark:text-amber-300">
                {w}
              </p>
            ))}
            {status.source === "instagram" &&
              status.result.collections.length === 0 &&
              status.result.bookmarks.some((b) => b.igCollections?.length) && (
                <CollectionsFix initial={status.result.account?.username ?? usernameHint} onGetCollections={onGetCollections} />
              )}
            {status.source === "instagram" && status.result.warnings.length > 0 && <DiagnosePanel hint={hint} />}
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className={primaryButton}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {hasExtension ? (
              <div className="space-y-3 rounded-xl border border-accent/30 bg-accent-soft/60 p-4 dark:bg-accent/10">
                <div className="flex items-start gap-3">
                  <Zap className="mt-0.5 size-5 shrink-0 text-accent" />
                  <div className="text-sm">
                    <p className="font-semibold">Import straight from Instagram</p>
                    <p className="mt-0.5 text-neutral-600 dark:text-neutral-400">
                      Reads your saved posts, collections, captions and cover images from Instagram in this browser. Usually a few
                      minutes. Nothing on Instagram changes.
                    </p>
                  </div>
                </div>
                {status.state === "fetching" ? (
                  <ImportProgress live={status.live} />
                ) : status.state === "login" ? (
                  <div className="space-y-2 text-sm">
                    <p>
                      {status.waiting
                        ? "Log in to Instagram in the window that just opened. Keeper carries on as soon as you're in."
                        : (status.message ?? "You're not logged into Instagram in this browser yet.")}
                    </p>
                    {status.waiting ? (
                      <p className="flex items-center gap-2 text-neutral-600 dark:text-neutral-400" role="status">
                        <Loader2 className="size-4 animate-spin text-accent" /> Waiting for Instagram…
                      </p>
                    ) : (
                      <button type="button" onClick={logIn} className={`${primaryButton} w-full justify-center py-2`}>
                        Log in to Instagram
                      </button>
                    )}
                    <p className="text-xs text-neutral-500">You type your password into Instagram itself; Keeper never sees it.</p>
                  </div>
                ) : status.state === "confirm" ? (
                  <ConfirmAccount
                    key={status.account?.userId ?? "checking"}
                    account={status.account}
                    switching={Boolean(status.switching)}
                    known={status.account && hint?.userId === status.account.userId ? hint.username : null}
                    onStart={(account, username) => fromInstagram(username ? { userId: account.userId, username } : null)}
                    onSwitch={switchAccount}
                    // A library of this very account already exists: checking for new saves takes seconds.
                    quick={status.account && onQuickCheck && libraryCount > 0 && hint?.userId === status.account.userId ? { count: libraryCount, run: quickCheck } : null}
                  />
                ) : status.state === "quick" ? (
                  status.added === null ? (
                    <p className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400" role="status">
                      <Loader2 className="size-4 animate-spin text-accent" /> Looking for new saves…
                    </p>
                  ) : (
                    <div className="space-y-3 text-sm">
                      <p className="rounded-lg bg-emerald-50 p-3 font-medium text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200" data-testid="quick-result">
                        {status.added > 0 ? `Added ${plural(status.added, "new save")}. They're at the top.` : "No new saves. You're up to date."}
                      </p>
                      <div className="flex justify-end">
                        <button type="button" onClick={onClose} className={primaryButton}>
                          Done
                        </button>
                      </div>
                    </div>
                  )
                ) : (
                  <button type="button" onClick={checkAccount} disabled={busy} className={`${primaryButton} w-full justify-center py-2`}>
                    Import from Instagram
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={onShowExtension}
                className="flex w-full items-start gap-3 rounded-xl border border-neutral-200 p-4 text-left text-sm hover:border-accent dark:border-neutral-800"
              >
                <Puzzle className="mt-0.5 size-5 shrink-0 text-accent" />
                <span>
                  <span className="font-semibold">Skip the wait with the Keeper extension.</span>{" "}
                  <span className="text-neutral-600 dark:text-neutral-400">
                    One click imports everything, with cover images and captions. For Chrome on a computer. Get it →
                  </span>
                </span>
              </button>
            )}

            {hasExtension && (
              <button
                type="button"
                onClick={() => setShowExport((v) => !v)}
                className="flex items-center gap-1 text-sm font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                aria-expanded={showExport}
              >
                <ChevronDown className={`size-4 transition-transform ${showExport ? "" : "-rotate-90"}`} />
                Or upload Instagram&apos;s data export
              </button>
            )}

            {exportOpen && (
            <>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-neutral-700 dark:text-neutral-300">
              <li>
                Open Instagram&apos;s <b>Settings</b> (on instagram.com, it&apos;s under <b>More</b> at the bottom left), then <b>Accounts Center</b> (or <b>Meta Account</b>) <b>→ Your information and permissions → Export your information → Create export</b>.
              </li>
              <li>
                Pick your Instagram profile, then <b>Export to device</b>.
              </li>
              <li>
                Open <b>Customize information</b> and tick only <b>Saved</b>. Instagram ticks lots of other sections for you, so tap{" "}
                <b>Clear all</b> on every other section, then <b>Save</b>.
              </li>
              <li>
                Change <b>Date range</b> to <b>All time</b>. It starts on &ldquo;Last year&rdquo;, which leaves out older saves. Set{" "}
                <b>Format</b> to <b>JSON</b> (HTML works too) and <b>Media quality</b> to <b>Low</b>.
              </li>
              <li>
                Tap <b>Start export</b> and enter your Instagram password if asked. Instagram emails you when it&apos;s ready, usually
                within minutes when only Saved is ticked (Meta allows itself up to 30 days). The download works for 4 days.
              </li>
              <li>Download the zip and drop it below. No need to unzip it.</li>
            </ol>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                handle([...e.dataTransfer.files]);
              }}
              className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                over ? "border-accent bg-accent-soft dark:bg-accent/10" : "border-neutral-300 dark:border-neutral-700"
              }`}
            >
              {status.state === "reading" ? (
                <>
                  <Loader2 className="size-7 animate-spin text-accent" />
                  <p className="text-sm">Reading your saves…</p>
                </>
              ) : (
                <>
                  <FileArchive className="size-7 text-neutral-400" />
                  <p className="text-sm">Drop your Instagram zip here</p>
                  <button type="button" onClick={() => input.current?.click()} className={`${primaryButton} mt-1`}>
                    <Upload className="size-4" /> Choose file
                  </button>
                  <p className="text-xs text-neutral-500">.zip, or saved_posts / saved_collections .json or .html</p>
                </>
              )}
              <input
                ref={input}
                type="file"
                multiple
                accept=".zip,.json,.html,.htm,application/zip,application/json,text/html"
                className="hidden"
                data-testid="import-input"
                onChange={(e) => {
                  handle([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
              />
            </div>
            </>
            )}

            {status.state === "error" && (
              <>
                <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300">
                  {status.message}
                </p>
                {hasExtension && <DiagnosePanel hint={hint} />}
              </>
            )}

            <p className="flex items-start gap-2 text-xs text-neutral-500">
              <Lock className="mt-px size-3.5 shrink-0" />
              Everything is read on this device. Keeper keeps the post links, names, captions and small cover images, and
              nothing is uploaded.
            </p>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className={ghostButton}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const YEAR = 365 * 24 * 3600 * 1000;

/**
 * Instagram's export defaults to the last year. When the oldest save in the
 * file is about that old (or newer), say what the file covers and how to get
 * the rest, in case the date range was left as it was.
 */
function DateRangeHint({ result }: { result: ImportResult }) {
  let oldest = Infinity;
  let newest = -Infinity;
  for (const b of result.bookmarks) {
    if (b.savedAt === undefined) continue;
    oldest = Math.min(oldest, b.savedAt);
    newest = Math.max(newest, b.savedAt);
  }
  if (!Number.isFinite(oldest)) return null;
  const recentOnly = Date.now() - oldest < YEAR + 14 * 24 * 3600 * 1000;
  return (
    <div className="space-y-1 text-sm">
      <p className="text-neutral-600 dark:text-neutral-400">
        This file has saves from {formatDate(oldest)} to {formatDate(newest)}.
      </p>
      {recentOnly && (
        <p className="text-amber-700 dark:text-amber-300">
          Missing older saves? The export may have been set to &ldquo;Last year&rdquo;. Request a new one with Date range set to
          All time and import it too. Nothing here gets duplicated.
        </p>
      )}
    </div>
  );
}

/** "Import from @name?" before anything is read, with a way to switch accounts, or asks the username when Instagram won't say it. */
function ConfirmAccount({
  account,
  switching,
  known,
  onStart,
  onSwitch,
  quick,
}: {
  account: InstagramAccount | null;
  switching: boolean;
  /** The username Keeper already knows for this very account. */
  known: string | null;
  onStart: (account: InstagramAccount, username: string | null) => void;
  onSwitch: (account: InstagramAccount) => void;
  /** Offered when this account was imported before: just the new saves, in seconds. */
  quick: { count: number; run: () => void } | null;
}) {
  const [typed, setTyped] = useState(known ?? "");
  if (!account) {
    return (
      <p className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400" role="status">
        <Loader2 className="size-4 animate-spin text-accent" /> Checking which Instagram account is logged in…
      </p>
    );
  }
  if (switching) {
    return (
      <div className="space-y-1 text-sm" role="status">
        <p className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin text-accent" /> Waiting for you to switch accounts…
        </p>
        <p className="text-xs text-neutral-500">
          In the Instagram window, open your profile menu, choose <strong>Switch accounts</strong> and pick the account. Keeper
          notices straight away. Or close the window when you&apos;re done.
        </p>
      </div>
    );
  }
  const username = account.username ?? (cleanUsername(typed) || null);
  return (
    <form
      className="space-y-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        onStart(account, username);
      }}
    >
      {account.username ? (
        <p data-testid="import-account">
          Import the saved posts of <strong>@{account.username}</strong>?
        </p>
      ) : (
        <div className="space-y-1.5">
          <label htmlFor="import-username" className="block font-medium">
            Which account is this?
          </label>
          <p className="text-xs text-neutral-500">
            Instagram didn&apos;t say which of your accounts is logged in. Type its username (the name after instagram.com/) so
            Keeper can name this library and bring in your collections.
          </p>
          <input
            id="import-username"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="yourname"
            autoComplete="off"
            className="w-full rounded-lg border border-neutral-300 bg-transparent px-2.5 py-1.5 outline-none focus:border-accent dark:border-neutral-700"
          />
        </div>
      )}
      {quick && (
        <div className="space-y-2">
          <button type="button" onClick={quick.run} className={`${primaryButton} w-full justify-center py-2`}>
            Check for new saves
          </button>
          <p className="text-xs text-neutral-500">
            Takes a few seconds. Or read all {fmtCount.format(quick.count)} again (about {Math.max(1, Math.round(quick.count / 300))} min) if you
            unsaved posts on Instagram or something looks out of date:
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={`${quick ? ghostButton + " border border-neutral-300 dark:border-neutral-700" : primaryButton} flex-1 justify-center py-2`}>
          {quick ? "Read everything again" : "Start import"}
        </button>
        <button type="button" onClick={() => onSwitch(account)} className={ghostButton}>
          <ArrowLeftRight className="size-4" /> Use a different account
        </button>
      </div>
      <p className="text-xs text-neutral-500">Keeper reads whichever account is active on instagram.com in this browser.</p>
    </form>
  );
}
