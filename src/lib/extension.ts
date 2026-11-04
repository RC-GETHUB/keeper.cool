"use client";

import { useEffect, useState } from "react";
import type { InstagramMedia, InstagramRead } from "./instagram-read";
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
  phase: "account" | "saved" | "page" | "collections" | "thumbs" | "thumbs-done" | "retry";
  /** For "page": the posts on it. */
  media?: InstagramMedia[];
  /** For "retry": how long until the next try, in ms. */
  wait?: number;
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
const staleListeners = new Set<() => void>();
const installedListeners = new Set<() => void>();
let listening = false;

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data || data.keeper !== "extension") return;
    if (data.event === "stale") {
      // This page was open when the extension was updated: nothing will answer until it reloads.
      for (const [id, entry] of pending) {
        pending.delete(id);
        entry.reject(new ExtensionError("stale", "The Keeper extension was updated. Reload this page to reconnect."));
      }
      for (const fn of staleListeners) fn();
      return;
    }
    if (data.event === "installed") {
      // Installed (or connected) after this page loaded.
      for (const fn of installedListeners) fn();
      return;
    }
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
      const error = (data.error ?? {}) as { code?: string; message?: string; detail?: string };
      const message = error.message ?? "The extension couldn't do that.";
      entry.reject(new ExtensionError(error.code ?? "unknown", error.detail ? `${message} (Instagram said: ${error.detail})` : message));
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
  /** "stale": installed, but updated since this page loaded, so the page must reload. */
  status: "checking" | "missing" | "ready" | "stale";
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
    const onStale = () => alive && setState((s) => ({ ...s, status: "stale" }));
    jobListeners.add(onJob);
    staleListeners.add(onStale);
    // Installed while this page is open: the extension connects to it straight away.
    const onInstalled = () => alive && check();
    installedListeners.add(onInstalled);

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
      staleListeners.delete(onStale);
      installedListeners.delete(onInstalled);
      clearInterval(timer);
      clearInterval(poll);
    };
  }, []);

  return state;
}

/** A username Keeper already knows, and the account it belongs to (it's only used for that account). */
export interface UsernameHint {
  userId: string;
  username: string;
}

export function readInstagram(
  onProgress: (p: ReadProgress) => void,
  options: { thumbnails?: boolean; hint?: UsernameHint | null } = {},
): Promise<InstagramRead> {
  const hint = options.hint ?? null;
  return request<InstagramRead>(
    "read",
    { thumbnails: options.thumbnails ?? true, usernameHint: hint?.username, hintUserId: hint?.userId, pace: testPace() },
    (m) =>
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

// ---- The one Instagram window Keeper opens (to log in, or switch accounts).
// Instagram can't be shown inside Keeper (it refuses to be embedded), so it gets a
// small window of its own: only ever one, brought to the front, and closed by Keeper
// as soon as it's done or the user closes Keeper's dialog.

let igWindow: { popup: Window | null; stop: () => void } | null = null;

function openInstagramWindow(url: string): Window | null {
  closeInstagramWindow();
  const width = 460;
  const height = 720;
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
  const popup = window.open(url, "keeper-instagram", `popup,width=${width},height=${height},left=${left},top=${top}`);
  popup?.focus();
  return popup;
}

/** Brings Keeper's Instagram window back to the front, if it's open. */
export function showInstagramWindow() {
  if (igWindow?.popup && !igWindow.popup.closed) igWindow.popup.focus();
}

/** Closes Keeper's Instagram window and stops waiting on it. */
export function closeInstagramWindow() {
  const current = igWindow;
  igWindow = null;
  if (!current) return;
  current.stop();
  try {
    current.popup?.close();
  } catch {
    // Already gone.
  }
}

/** Polls the extension until `done` says so (or the window closes / 10 minutes pass). */
function watchWindow<T>(
  popup: Window | null,
  every: number,
  poll: (closed: boolean) => Promise<T | undefined>,
  onClosed: (lastError: unknown) => Error | unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let finished = false;
    const finish = (fn: () => void) => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      if (igWindow?.popup === popup) igWindow = null;
      try {
        popup?.close();
      } catch {
        // Already gone.
      }
      fn();
    };
    const timer = setInterval(async () => {
      const closed = !popup || popup.closed;
      try {
        const value = await poll(closed);
        if (value !== undefined) finish(() => resolve(value));
        else if (closed || Date.now() - started > 10 * 60_000) finish(() => reject(onClosed(null)));
      } catch (error) {
        if (closed || Date.now() - started > 10 * 60_000) finish(() => reject(onClosed(error)));
      }
    }, every);
    igWindow = { popup, stop: () => finish(() => reject(new ExtensionError("closed", "The Instagram window was closed."))) };
  });
}

/**
 * Opens Instagram's own login page in Keeper's Instagram window and resolves once
 * the extension sees a logged-in account (or rejects if the window is closed first).
 * Keeper never sees the password: it's typed into instagram.com.
 */
export function logInToInstagram(): Promise<InstagramAccount> {
  const popup = openInstagramWindow("https://www.instagram.com/accounts/login/");
  return watchWindow(
    popup,
    2500,
    () => instagramAccount(),
    () => new ExtensionError("login", "Instagram login was closed before you finished logging in."),
  );
}

/**
 * Opens instagram.com in Keeper's Instagram window so the user can switch to another
 * of their accounts (profile menu → Switch accounts). Resolves with the account
 * logged in once it changes, or when the window is closed.
 */
export function switchInstagramAccount(current: InstagramAccount): Promise<InstagramAccount> {
  const popup = openInstagramWindow("https://www.instagram.com/");
  return watchWindow(
    popup,
    2000,
    async (closed) => {
      const account = await instagramAccount();
      return account.userId !== current.userId || closed ? account : undefined;
    },
    (error) => error ?? new ExtensionError("closed", "The Instagram window was closed."),
  );
}

/** The account's collection names and ids (from the list, or the Saved page of `username`). */
export function readCollections(username: string | null): Promise<{ collections: { id: string; name: string; from?: "link" | "data" | "graph" }[] }> {
  return request("collections", { username });
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
