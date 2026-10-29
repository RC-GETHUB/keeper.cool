"use client";

import { useEffect, useState } from "react";
import type { InstagramRead } from "./instagram-read";
import type { PushStep } from "./push";
import type { InstagramAccount } from "./types";

// Talks to the Keeper browser extension through window messages, which the
// extension's bridge script relays (see extension/bridge.js).

export interface JobSummary {
  id: string;
  status: "running" | "waiting" | "paused" | "blocked" | "done" | "cancelled";
  message: string | null;
  done: number;
  total: number;
  account: InstagramAccount;
  nextAt: number | null;
  skipped: { code: string; reason: string }[];
  pendingUrl: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface ReadProgress {
  phase: "account" | "saved" | "collections" | "thumbs" | "thumbs-done";
  account?: InstagramAccount;
  count?: number;
  done?: number;
  total?: number;
  name?: string;
  items?: { code: string; data: string }[];
}

export class ExtensionError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type Listener = (message: Record<string, unknown>) => void;

const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; onEvent?: Listener }>();
const jobListeners = new Set<(job: JobSummary | null) => void>();
let listening = false;

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data || data.keeper !== "extension") return;
    if (data.event === "job") {
      for (const fn of jobListeners) fn(data.job as JobSummary | null);
      return;
    }
    const entry = typeof data.id === "string" ? pending.get(data.id) : undefined;
    if (!entry) return;
    if (data.event) {
      entry.onEvent?.(data);
      return;
    }
    // Keep listening for events that follow the answer (cover images after a read).
    if (!entry.onEvent) pending.delete(data.id as string);
    if (data.ok) entry.resolve(data.result);
    else {
      const error = (data.error ?? {}) as { code?: string; message?: string };
      entry.reject(new ExtensionError(error.code ?? "unknown", error.message ?? "The extension couldn't do that."));
    }
  });
}

export function request<T>(type: string, payload?: unknown, onEvent?: Listener): Promise<T> {
  listen();
  const id = Math.random().toString(36).slice(2);
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onEvent });
    window.postMessage({ keeper: "page", id, type, payload }, location.origin);
  });
}

export function installedVersion(): string | null {
  if (typeof document === "undefined") return null;
  return document.documentElement.dataset.keeperExtension ?? null;
}

export interface ExtensionState {
  status: "checking" | "missing" | "ready";
  version: string | null;
  job: JobSummary | null;
}

/** Whether the extension is installed, and the state of any push. */
export function useExtension(): ExtensionState {
  const [state, setState] = useState<ExtensionState>({ status: "checking", version: null, job: null });

  useEffect(() => {
    listen();
    let alive = true;
    const onJob = (job: JobSummary | null) => alive && setState((s) => ({ ...s, job }));
    jobListeners.add(onJob);

    const check = () => {
      if (!installedVersion()) return false;
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), 3000));
      Promise.race([request<{ version: string; job: JobSummary | null }>("hello"), timeout]).then((hello) => {
        if (!alive) return;
        setState(hello ? { status: "ready", version: hello.version, job: hello.job } : { status: "missing", version: null, job: null });
      });
      return true;
    };
    // The bridge marks the page as soon as it loads; give it a moment.
    let tries = 0;
    const timer = setInterval(() => {
      if (check() || ++tries > 10) {
        clearInterval(timer);
        if (!installedVersion() && alive) setState({ status: "missing", version: null, job: null });
      }
    }, 150);

    // Keep the job status fresh while a push runs.
    const poll = setInterval(() => {
      if (installedVersion()) request<JobSummary | null>("push:status").then(onJob, () => {});
    }, 15_000);

    return () => {
      alive = false;
      jobListeners.delete(onJob);
      clearInterval(timer);
      clearInterval(poll);
    };
  }, []);

  return state;
}

export function readInstagram(onProgress: (p: ReadProgress) => void, options: { thumbnails?: boolean } = {}): Promise<InstagramRead> {
  return request<InstagramRead>("read", { thumbnails: options.thumbnails ?? true, pace: testPace() }, (m) =>
    onProgress(m as unknown as ReadProgress),
  );
}

/** Posts saved on Instagram since Keeper last looked: reads until it reaches one of `known`. */
export function readNewSaves(known: string[], onThumbs: (items: { code: string; data: string }[]) => void): Promise<InstagramRead> {
  return request<InstagramRead>("read", { known, thumbnails: true, pace: testPace() }, (m) => {
    const p = m as unknown as ReadProgress;
    if (p.items?.length) onThumbs(p.items);
  });
}

/** The Instagram account logged in in this browser (fails with code "login" if none). */
export function instagramAccount(): Promise<InstagramAccount> {
  return request<InstagramAccount>("account");
}

/**
 * Opens Instagram's own login page in a small window and resolves once the
 * extension sees a logged-in account (or rejects if the window is closed
 * first). Keeper never sees the password: it's typed into instagram.com.
 */
export function logInToInstagram(): Promise<InstagramAccount> {
  const width = 460;
  const height = 720;
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
  const popup = window.open(
    "https://www.instagram.com/accounts/login/",
    "keeper-instagram-login",
    `popup,width=${width},height=${height},left=${left},top=${top}`,
  );
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const account = await instagramAccount();
        clearInterval(timer);
        popup?.close();
        resolve(account);
      } catch {
        if ((popup && popup.closed) || Date.now() - started > 10 * 60_000) {
          clearInterval(timer);
          reject(new ExtensionError("login", "Instagram login was closed before you finished logging in."));
        }
      }
    }, 2500);
  });
}

export function startPush(steps: PushStep[], account: InstagramAccount): Promise<JobSummary> {
  return request<JobSummary>("push:start", { steps, account, pace: testPace() });
}

export function controlPush(action: "pause" | "resume" | "cancel"): Promise<JobSummary | null> {
  return request<JobSummary | null>(`push:${action}`);
}

/** Keeper's automated tests run the extension at test speed; the extension only honours this on localhost. */
function testPace(): "test" | undefined {
  try {
    return localStorage.getItem("keeper:test-pace") === "1" ? "test" : undefined;
  } catch {
    return undefined;
  }
}
