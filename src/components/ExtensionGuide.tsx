"use client";

import { Check, CheckCircle2, Copy, Download, Loader2, Puzzle, X } from "lucide-react";
import { useState } from "react";
import { useExtension } from "@/lib/extension";
import { primaryButton } from "./ui";

const code = "rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[13px] dark:bg-neutral-800";

/** Pages can't link to chrome://extensions, so offer to copy it instead. */
function CopyAddress() {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <span className={code}>chrome://extensions</span>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText("chrome://extensions").then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
        className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        aria-label="Copy chrome://extensions"
        title="Copy"
      >
        {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
      </button>
    </span>
  );
}

/** The install steps for the test version, shared by the floating guide and the /extension page. */
export function ExtensionSteps() {
  return (
    <ol className="list-decimal space-y-2.5 pl-5 text-sm leading-relaxed">
      <li>
        <a href="/keeper-extension.zip" download className="inline-flex items-center gap-1 font-semibold text-accent underline underline-offset-2">
          <Download className="size-3.5" /> Download keeper-extension.zip
        </a>{" "}
        and unzip it. You&apos;ll get a folder called <span className={code}>keeper-extension</span>.
      </li>
      <li>
        Open a new tab and go to <CopyAddress /> (paste it into the address bar).
      </li>
      <li>
        Turn on <b>Developer mode</b> (top right).
      </li>
      <li>
        Click <b>Load unpacked</b> and choose the <span className={code}>keeper-extension</span> folder.
      </li>
      <li>
        Come back to this tab. Keeper connects by itself. Optional: pin <b>Keeper</b> from Chrome&apos;s puzzle-piece menu.
      </li>
    </ol>
  );
}

/** Whether the extension is installed in this browser, live. */
export function ExtensionStatus({ className = "" }: { className?: string }) {
  const { status, version } = useExtension();
  if (status === "ready") {
    return (
      <p className={`flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200 ${className}`}>
        <CheckCircle2 className="size-4 shrink-0" /> Installed in this browser (version {version}). You&apos;re all set.
      </p>
    );
  }
  if (status === "stale") {
    return (
      <p className={`rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200 ${className}`}>
        The extension was updated. Reload this page to reconnect.
      </p>
    );
  }
  return (
    <p className={`flex items-center gap-2 text-sm text-neutral-500 ${className}`} role="status">
      <Loader2 className="size-4 animate-spin" /> {status === "checking" ? "Checking this browser…" : "Waiting for the extension…"}
    </p>
  );
}

/**
 * The install steps in a floating card over Keeper, so there's no page to
 * leave and come back from. It turns green as soon as the extension is in.
 */
export function ExtensionGuide({ onClose }: { onClose: () => void }) {
  const { status } = useExtension();
  return (
    <div
      role="dialog"
      aria-label="Install the Keeper extension"
      className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl border border-neutral-200 bg-white p-5 shadow-2xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[26rem] sm:rounded-2xl dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Puzzle className="size-5 text-accent" /> Install the Keeper extension
        </h2>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="Close">
          <X className="size-5" />
        </button>
      </div>
      {status === "ready" ? (
        <div className="space-y-3">
          <ExtensionStatus />
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            <b>Import</b> now shows <b>Import from Instagram</b>. Make sure you&apos;re logged into Instagram in this Chrome.
          </p>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className={primaryButton}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            For Chrome (or Edge, Brave, Arc) on a computer. Until it&apos;s in the Chrome Web Store, it&apos;s installed by hand: about a minute.
          </p>
          <ExtensionSteps />
          <ExtensionStatus className="pt-1" />
          <p className="text-xs text-neutral-500">
            Nothing happening after installing? Reload this page.{" "}
            <a href="/extension" target="_blank" rel="noreferrer" className="underline underline-offset-2">
              What the extension does
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
