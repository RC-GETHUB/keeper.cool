"use client";

import { FileArchive, Loader2, Lock, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { readExport } from "@/lib/import";
import type { MergeSummary } from "@/lib/library/ops";
import type { ImportResult } from "@/lib/types";
import { ghostButton, plural, primaryButton } from "./ui";

interface Props {
  onClose: () => void;
  onImport: (result: ImportResult) => MergeSummary;
}

type Status =
  | { state: "idle" }
  | { state: "reading" }
  | { state: "done"; result: ImportResult; summary: MergeSummary }
  | { state: "error"; message: string };

export function ImportDialog({ onClose, onImport }: Props) {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const handle = async (files: File[]) => {
    if (!files.length) return;
    setStatus({ state: "reading" });
    try {
      const result = await readExport(files);
      setStatus({ state: "done", result, summary: onImport(result) });
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : "Something went wrong reading that file." });
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
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
                <li>{plural(status.result.bookmarks.length, "saved post")} found in the file</li>
                {status.summary.collectionsAdded > 0 && <li>{plural(status.summary.collectionsAdded, "new collection")}</li>}
                {status.summary.updated > 0 && <li>{plural(status.summary.updated, "bookmark")} updated with new details</li>}
                {status.result.mergedDuplicates > 0 && (
                  <li>{plural(status.result.mergedDuplicates, "repeated entry", "repeated entries")} merged</li>
                )}
              </ul>
            </div>
            {status.result.warnings.map((w) => (
              <p key={w} className="text-sm text-amber-700 dark:text-amber-300">
                {w}
              </p>
            ))}
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className={primaryButton}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-neutral-700 dark:text-neutral-300">
              <li>
                Open Instagram&apos;s <b>Settings</b> (on instagram.com, it&apos;s under <b>More</b> at the bottom left), then <b>Accounts Center</b> (or <b>Meta Account</b>) <b>→ Your information and permissions → Export your information → Create export</b>.
              </li>
              <li>
                Pick your Instagram profile, then <b>Export to device</b>.
              </li>
              <li>
                Choose only your <b>saved posts and collections</b> for a small, quick export. Set the date range to <b>All time</b>, the format to <b>JSON</b> (HTML works too) and media quality to <b>low</b>, then tap <b>Start export</b>.
              </li>
              <li>
                Instagram emails you when it&apos;s ready. That&apos;s often within the hour, but Meta says it can take up to 30 days. The download link works for 4 days.
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

            {status.state === "error" && (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300">
                {status.message}
              </p>
            )}

            <p className="flex items-start gap-2 text-xs text-neutral-500">
              <Lock className="mt-px size-3.5 shrink-0" />
              Your file is read on this device. Only the saved-post links, usernames and dates are kept, and nothing is uploaded.
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
