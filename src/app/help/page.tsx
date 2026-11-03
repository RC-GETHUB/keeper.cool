import type { Metadata } from "next";
import Link from "next/link";
import { HelpCheck } from "@/components/HelpCheck";
import { SUPPORT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Help",
  description: "Answers to common questions about Keeper, and how to reach us.",
};

const QUESTIONS: { q: string; a: React.ReactNode }[] = [
  {
    q: "Import from Instagram doesn't show up",
    a: (
      <>
        It needs the Keeper extension, in Chrome (or Edge, Brave, Arc) on a computer. Click <b>Add Keeper to Chrome</b> on Keeper&apos;s
        welcome screen, or <b>Extension</b> at the bottom of the menu. On a phone, use <b>Import</b> → Instagram&apos;s data export instead.
      </>
    ),
  },
  {
    q: "It says I'm not logged into Instagram",
    a: (
      <>
        Keeper uses the Instagram account you&apos;re logged into in the same browser. Click <b>Log in to Instagram</b> when Keeper asks,
        log in in the window that opens, and Keeper carries on by itself. It never sees your password.
      </>
    ),
  },
  {
    q: "It imported the wrong Instagram account",
    a: (
      <>
        Keeper reads whichever account is active on instagram.com. Before an import starts it shows the account&apos;s name: click{" "}
        <b>Use a different account</b> to switch. Each account gets its own library; switch between them from the name at the top left.
      </>
    ),
  },
  {
    q: "My collections are missing",
    a: (
      <>
        If a bar at the top says your collections aren&apos;t in Keeper yet, click <b>Get collections</b>. It takes a few seconds. If it
        still doesn&apos;t work, click <b>Run a check</b> in that window and email us the report.
      </>
    ),
  },
  {
    q: "The import is slow",
    a: (
      <>
        Keeper reads your saves at about the speed of scrolling, so Instagram stays happy: a few thousand take 10 to 15 minutes. You
        can keep using your computer, and the tab&apos;s title shows how far along it is. Next time, <b>Check for new saves</b> takes
        seconds.
      </>
    ),
  },
  {
    q: "Is exporting to Instagram safe?",
    a: (
      <>
        Instagram can&apos;t move a saved post, so Export unsaves and re-saves the posts that need to move, about one a minute, and stops
        if Instagram says to slow down. It only starts when you ask and tick the box. Instagram doesn&apos;t officially support tools
        like this, so try it on a spare account first.
      </>
    ),
  },
  {
    q: "I messed up my order",
    a: (
      <>
        Click the undo arrow at the top (or press Ctrl/⌘ Z). To start over, choose <b>Instagram&apos;s order</b> from the sort menu
        above your list.
      </>
    ),
  },
  {
    q: "Where is my library kept?",
    a: (
      <>
        In this browser, on this computer. Keeper doesn&apos;t upload it. Use <b>Download a backup</b> at the bottom of the menu to keep
        a copy. More in the{" "}
        <Link href="/privacy" className="font-medium text-accent underline underline-offset-2">
          privacy policy
        </Link>
        .
      </>
    ),
  },
];

export default function HelpPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-sm leading-relaxed sm:py-14">
      <Link href="/" className="text-lg font-bold tracking-tight">
        keeper<span className="text-accent">.cool</span>
      </Link>
      <h1 className="mt-8 text-3xl font-bold tracking-tight">Help</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">
        Something not working, or an idea? Email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}?subject=Keeper`} className="font-medium text-accent underline underline-offset-2">
          {SUPPORT_EMAIL}
        </a>
        . A screenshot helps.
      </p>
      <div className="mt-8 space-y-6">
        {QUESTIONS.map(({ q, a }) => (
          <section key={q}>
            <h2 className="mb-1 text-base font-semibold">{q}</h2>
            <p className="text-neutral-700 dark:text-neutral-300">{a}</p>
          </section>
        ))}
      </div>
      <section className="mt-10 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="mb-1 text-base font-semibold">Something not working with Instagram?</h2>
        <p className="mb-3 text-neutral-700 dark:text-neutral-300">
          Run a check: it tries each way Keeper reads Instagram (reading only, nothing changes) and makes a short report to send us. It
          holds no passwords or posts.
        </p>
        <HelpCheck />
      </section>
      <p className="mt-10 text-xs text-neutral-500">Keeper is not affiliated with, endorsed by or sponsored by Instagram or Meta.</p>
    </main>
  );
}
