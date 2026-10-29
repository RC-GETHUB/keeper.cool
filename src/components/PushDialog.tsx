"use client";

import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Pause, Play, Send, X } from "lucide-react";
import { useState } from "react";
import { controlPush, ExtensionError, readInstagram, startPush, type ExtensionState, type JobSummary, type ReadProgress } from "@/lib/extension";
import { fromInstagramRead, type InstagramRead } from "@/lib/instagram-read";
import { mergeImport } from "@/lib/library/ops";
import { estimateDuration, formatDuration, planPush, type PushPlan } from "@/lib/push";
import type { Library } from "@/lib/types";
import { fmtCount, ghostButton, plural, primaryButton } from "./ui";

interface Props {
  lib: Library;
  extension: ExtensionState;
  /** Saves new Instagram saves found while checking into the library. */
  onMerge: (lib: Library) => void;
  onClose: () => void;
}

type Stage =
  | { stage: "intro" }
  | { stage: "checking"; progress: ReadProgress | null }
  | { stage: "plan"; read: InstagramRead; plan: PushPlan; copy: boolean }
  | { stage: "starting" }
  | { stage: "error"; message: string };

const ACTIVE = new Set(["running", "waiting", "paused", "blocked"]);

function handle(account: { username: string | null; userId: string }) {
  return account.username ? `@${account.username}` : `account ${account.userId}`;
}

export function PushDialog({ lib, extension, onMerge, onClose }: Props) {
  const [stage, setStage] = useState<Stage>({ stage: "intro" });
  const [consent, setConsent] = useState(false);
  const [copyConsent, setCopyConsent] = useState(false);
  const [startedId, setStartedId] = useState<string | null>(null);
  const job = extension.job;
  // Follow a push that's under way, or the one just started here, never an older finished one.
  const showJob = job && (ACTIVE.has(job.status) || job.id === startedId) ? job : null;

  const check = async () => {
    setStage({ stage: "checking", progress: null });
    try {
      const read = await readInstagram((p) => setStage({ stage: "checking", progress: p }), { thumbnails: false });
      const onInstagram = new Set(read.saved.map((m) => m.code));
      const overlap = lib.order.length ? lib.order.filter((id) => onInstagram.has(id)).length / lib.order.length : 0;
      const same = lib.instagram ? lib.instagram.userId === read.account.userId : overlap >= 0.5;
      if (same) {
        // Bring in anything saved on Instagram since the last import, so the
        // plan covers everything that's there now.
        const merged = mergeImport(lib, fromInstagramRead(read)).library;
        onMerge(merged);
        setStage({ stage: "plan", read, plan: planPush(merged.order, read.saved), copy: false });
      } else {
        setStage({ stage: "plan", read, plan: planPush(lib.order, read.saved, { saveMissing: true }), copy: true });
      }
    } catch (e) {
      setStage({ stage: "error", message: e instanceof ExtensionError || e instanceof Error ? e.message : "Couldn't read from Instagram." });
    }
  };

  const start = async (read: InstagramRead, plan: PushPlan) => {
    setStage({ stage: "starting" });
    try {
      const started = await startPush(plan.steps, read.account);
      setStartedId(started.id);
    } catch (e) {
      setStage({ stage: "error", message: e instanceof Error ? e.message : "Couldn't start syncing." });
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="push-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl dark:bg-neutral-900"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id="push-title" className="text-lg font-semibold">
            Sync to Instagram
          </h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>

        {showJob ? (
          <JobView job={showJob} onClose={onClose} />
        ) : stage.stage === "intro" || stage.stage === "error" ? (
          <div className="space-y-4 text-sm">
            <p className="text-neutral-700 dark:text-neutral-300">
              Sync puts your Keeper order on Instagram, so your Saved page there matches. It works slowly in the background (about a
              post a minute) to keep your account safe. Keep Chrome open while it runs; you can pause any time.
            </p>
            <details className="group rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800">
              <summary className="cursor-pointer font-medium text-neutral-700 dark:text-neutral-300">How it works</summary>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-neutral-600 dark:text-neutral-400">
                <li>
                  Instagram can&apos;t move a saved post, so Keeper unsaves each post that needs to move and saves it again (which puts
                  it on top), then puts it back in its collections. Posts already in place are left alone.
                </li>
                <li>It does at most 500 Instagram actions a day. Moving a few posts takes minutes; re-sorting thousands takes days.</li>
                <li>Keeper works in an Instagram tab in the background. You can keep using your computer.</li>
                <li>If Instagram says &ldquo;try again later&rdquo;, Keeper stops straight away and tells you.</li>
                <li>
                  Instagram doesn&apos;t officially support tools like this, so there&apos;s a small chance it temporarily limits your
                  account.
                </li>
              </ul>
            </details>
            <label className="flex items-start gap-2.5 rounded-lg bg-neutral-50 p-3 dark:bg-neutral-800/60">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 accent-accent" />
              <span>I understand Keeper will re-save posts on my Instagram account.</span>
            </label>
            {stage.stage === "error" && (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800 dark:bg-red-500/10 dark:text-red-300">
                {stage.message}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className={ghostButton}>
                Cancel
              </button>
              <button type="button" onClick={check} disabled={!consent} className={primaryButton}>
                Continue
              </button>
            </div>
          </div>
        ) : stage.stage === "checking" || stage.stage === "starting" ? (
          <p className="flex items-center gap-2 py-6 text-sm" role="status">
            <Loader2 className="size-4 animate-spin text-accent" />
            {stage.stage === "starting"
              ? "Starting…"
              : !stage.progress || stage.progress.phase === "account"
                ? "Reading what's saved on Instagram now…"
                : stage.progress.phase === "saved"
                  ? `Reading what's saved on Instagram now: ${fmtCount.format(stage.progress.count ?? 0)} posts…`
                  : `Reading collections: ${fmtCount.format(stage.progress.done ?? 0)} of ${fmtCount.format(stage.progress.total ?? 0)}…`}
          </p>
        ) : (
          <PlanView
            lib={lib}
            read={stage.read}
            plan={stage.plan}
            copy={stage.copy}
            copyConsent={copyConsent}
            onCopyConsent={setCopyConsent}
            onStart={() => start(stage.read, stage.plan)}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

function PlanView({
  lib,
  read,
  plan,
  copy,
  copyConsent,
  onCopyConsent,
  onStart,
  onClose,
}: {
  lib: Library;
  read: InstagramRead;
  plan: PushPlan;
  copy: boolean;
  copyConsent: boolean;
  onCopyConsent: (v: boolean) => void;
  onStart: () => void;
  onClose: () => void;
}) {
  const nothing = plan.steps.length === 0;
  const saves = plan.steps.filter((s) => s.action === "save").length;
  return (
    <div className="space-y-4 text-sm">
      <p className="text-neutral-600 dark:text-neutral-400">
        Instagram account: <b className="text-neutral-900 dark:text-neutral-100">{handle(read.account)}</b>
      </p>

      {copy && (
        <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <p className="flex items-start gap-2 font-medium">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {lib.instagram
              ? `This library came from ${handle(lib.instagram)}, but Instagram is logged into ${handle(read.account)}.`
              : `Most of this library isn't saved on ${handle(read.account)}.`}
          </p>
          <p>Keeper will save your library into {handle(read.account)} in your order. Posts from private accounts it can&apos;t see are skipped.</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={copyConsent} onChange={(e) => onCopyConsent(e.target.checked)} className="mt-0.5 size-4 accent-accent" />
            <span>Yes, save my library into {handle(read.account)}.</span>
          </label>
        </div>
      )}

      {nothing ? (
        <p className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200">
          <CheckCircle2 className="size-4" /> Instagram already matches your order. Nothing to do.
        </p>
      ) : (
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <p className="text-2xl font-semibold tabular-nums">{fmtCount.format(plan.steps.length)}</p>
          <p className="text-neutral-600 dark:text-neutral-400">
            {copy && saves ? `posts to save (${fmtCount.format(saves)} new to this account)` : "posts will move on Instagram"}
            {plan.unchanged > 0 && `, ${fmtCount.format(plan.unchanged)} already in place`}
          </p>
          <p className="mt-2">
            About <b>{formatDuration(estimateDuration(plan))}</b> · {plural(plan.actions, "Instagram action")}
          </p>
        </div>
      )}

      {plan.notSaved.length > 0 && (
        <p className="text-neutral-600 dark:text-neutral-400">
          {plural(plan.notSaved.length, "post")} in Keeper {plan.notSaved.length === 1 ? "isn't" : "aren't"} saved on Instagram any
          more, so {plan.notSaved.length === 1 ? "it's" : "they're"} left out.
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={ghostButton}>
          {nothing ? "Close" : "Not now"}
        </button>
        {!nothing && (
          <button type="button" onClick={onStart} disabled={copy && !copyConsent} className={primaryButton}>
            <Send className="size-4" /> Start sync
          </button>
        )}
      </div>
    </div>
  );
}

function JobView({ job, onClose }: { job: JobSummary; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const act = async (action: "pause" | "resume" | "cancel") => {
    setBusy(true);
    try {
      await controlPush(action);
    } finally {
      setBusy(false);
    }
  };
  const percent = job.total ? (100 * job.done) / job.total : 0;
  const stopped = job.status === "paused" || job.status === "blocked";
  const active = job.status === "running" || job.status === "waiting";
  const next = job.nextAt ? new Date(job.nextAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;

  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="mb-1.5 flex justify-between">
          <span className="font-medium">
            {job.status === "done" ? "Finished" : job.status === "cancelled" ? "Cancelled" : `Post ${fmtCount.format(job.done + (active ? 1 : 0))} of ${fmtCount.format(job.total)}`}
          </span>
          <span className="text-neutral-500 tabular-nums">{Math.floor(percent)}%</span>
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-neutral-500">on {handle(job.account)}</p>
      </div>

      {job.status === "blocked" ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-red-800 dark:bg-red-500/10 dark:text-red-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {job.message}
        </p>
      ) : job.message ? (
        <p className="text-neutral-600 dark:text-neutral-400">{job.message}</p>
      ) : active ? (
        <p className="text-neutral-600 dark:text-neutral-400">
          Working through your posts{next ? `; next one around ${next}` : ""}. Keep Chrome open. You can close this window.
        </p>
      ) : null}

      {job.pendingUrl && (
        <p className="rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          One post is unsaved right now and will be saved again when you resume.{" "}
          <a href={job.pendingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline">
            Open it <ExternalLink className="size-3" />
          </a>{" "}
          to save it yourself instead.
        </p>
      )}

      {job.skipped.length > 0 && (
        <p className="text-neutral-600 dark:text-neutral-400">{plural(job.skipped.length, "post")} skipped because they&apos;re no longer available.</p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {(active || stopped) && (
          <button type="button" onClick={() => act("cancel")} disabled={busy} className={`${ghostButton} text-red-600 dark:text-red-400`}>
            Stop sync
          </button>
        )}
        {active && (
          <button type="button" onClick={() => act("pause")} disabled={busy} className={ghostButton}>
            <Pause className="size-4" /> Pause
          </button>
        )}
        {stopped && (
          <button type="button" onClick={() => act("resume")} disabled={busy} className={primaryButton}>
            <Play className="size-4" /> Resume
          </button>
        )}
        <button type="button" onClick={onClose} className={active || stopped ? ghostButton : primaryButton}>
          Close
        </button>
      </div>
    </div>
  );
}
