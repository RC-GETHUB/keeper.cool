"use client";

import { Loader2 } from "lucide-react";
import { useExtension } from "@/lib/extension";
import { DiagnosePanel } from "./DiagnosePanel";

/** The extension's check, available any time from the Help page. */
export function HelpCheck() {
  const { status } = useExtension();
  if (status === "checking") {
    return (
      <p className="flex items-center gap-2 text-neutral-500">
        <Loader2 className="size-4 animate-spin" /> Looking for the Keeper extension…
      </p>
    );
  }
  if (status !== "ready") {
    return (
      <p className="text-neutral-600 dark:text-neutral-400">
        {status === "stale" ? "The extension was updated: reload this page first." : "This needs the Keeper extension in this browser."}
      </p>
    );
  }
  return <DiagnosePanel label="Run a check" />;
}
