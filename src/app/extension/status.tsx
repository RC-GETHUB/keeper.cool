"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useExtension } from "@/lib/extension";

/** Tells visitors whether the extension is already installed in this browser. */
export function ExtensionStatus() {
  const { status, version } = useExtension();
  if (status === "checking") {
    return (
      <p className="mt-6 flex items-center gap-2 text-sm text-neutral-500">
        <Loader2 className="size-4 animate-spin" /> Checking this browser…
      </p>
    );
  }
  if (status === "ready") {
    return (
      <p className="mt-6 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200">
        <CheckCircle2 className="size-4" /> Installed in this browser (version {version}). You&apos;re all set.
      </p>
    );
  }
  return null;
}
