"use client";

import { FolderSearch, Loader2 } from "lucide-react";
import { useState } from "react";
import { plural, primaryButton } from "./ui";

/** "@name", "instagram.com/name/" or "name" → "name". */
export function cleanUsername(input: string): string {
  return input.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/.*$/, "");
}

/**
 * When Instagram won't say which account is logged in, Keeper can't open its
 * Saved page to read collection names. Asking for the username fixes that,
 * and the collections arrive in seconds because each post already carries
 * its collection ids.
 */
export function CollectionsFix({
  initial,
  onGetCollections,
}: {
  initial?: string | null;
  onGetCollections: (username: string) => Promise<number>;
}) {
  const [username, setUsername] = useState(initial ?? "");
  const [state, setState] = useState<{ busy: boolean; done?: number; error?: string }>({ busy: false });

  if (state.done !== undefined) {
    return (
      <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200">
        Added {plural(state.done, "collection")}.
      </p>
    );
  }
  return (
    <form
      className="space-y-2 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800"
      onSubmit={async (e) => {
        e.preventDefault();
        const name = cleanUsername(username);
        if (!name) return;
        setState({ busy: true });
        try {
          setState({ busy: false, done: await onGetCollections(name) });
        } catch (error) {
          setState({ busy: false, error: error instanceof Error ? error.message : String(error) });
        }
      }}
    >
      <label htmlFor="ig-username" className="block font-medium">
        What&apos;s your Instagram username?
      </label>
      <p className="text-xs text-neutral-500">Keeper reads your collections off its Saved page. It&apos;s the name after instagram.com/.</p>
      <div className="flex gap-2">
        <input
          id="ig-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="yourname"
          autoComplete="off"
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-2.5 py-1.5 outline-none focus:border-accent dark:border-neutral-700"
        />
        <button type="submit" disabled={state.busy || !username.trim()} className={primaryButton}>
          {state.busy ? <Loader2 className="size-4 animate-spin" /> : <FolderSearch className="size-4" />} Get collections
        </button>
      </div>
      {state.busy && <p className="text-xs text-neutral-500">Reading your Saved page (a small Instagram window opens for a moment)…</p>}
      {state.error && <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>}
    </form>
  );
}
