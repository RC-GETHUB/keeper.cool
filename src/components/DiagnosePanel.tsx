"use client";

import { Copy, Loader2, Stethoscope } from "lucide-react";
import { useState } from "react";
import { request } from "@/lib/extension";
import { ghostButton } from "./ui";

/**
 * Runs the extension's read-only check of which ways of reading Instagram
 * work for this account, and shows the report to screenshot or copy.
 */
export function DiagnosePanel({ usernameHint }: { usernameHint?: string | null }) {
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [report, setReport] = useState("");
  const [copied, setCopied] = useState(false);

  const run = async () => {
    setState("running");
    try {
      const result = await request<Record<string, unknown>>("diagnose", { usernameHint });
      setReport(JSON.stringify(result, null, 2));
    } catch (e) {
      setReport(`The check couldn't run: ${e instanceof Error ? e.message : String(e)}`);
    }
    setState("done");
  };

  if (state === "idle") {
    return (
      <button type="button" onClick={run} className={`${ghostButton} -ml-3`}>
        <Stethoscope className="size-4" /> Run a check, to help fix this
      </button>
    );
  }
  if (state === "running") {
    return (
      <p className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400" role="status">
        <Loader2 className="size-4 animate-spin text-accent" /> Checking how Instagram answers (about 30 seconds; a background tab may open
        briefly)…
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-neutral-600 dark:text-neutral-400">Send this to the Keeper team (a screenshot is fine). It holds no passwords or posts.</p>
      <pre className="max-h-64 overflow-auto rounded-lg bg-neutral-100 p-3 text-xs dark:bg-neutral-800" data-testid="diagnose-report">
        {report}
      </pre>
      <button
        type="button"
        className={`${ghostButton} -ml-3`}
        onClick={() => {
          navigator.clipboard.writeText(report).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        <Copy className="size-4" /> {copied ? "Copied" : "Copy report"}
      </button>
    </div>
  );
}
