import type { Metadata } from "next";
import Link from "next/link";
import { ExtensionStatus, ExtensionSteps } from "@/components/ExtensionGuide";

export const metadata: Metadata = {
  title: "Keeper extension",
  description: "Import your Instagram saves in one click, and sync your order back to Instagram.",
};

const code = "rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[13px] dark:bg-neutral-800";

export default function ExtensionPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <Link href="/" className="text-lg font-bold tracking-tight">
        keeper<span className="text-accent">.cool</span>
      </Link>
      <h1 className="mt-8 text-3xl font-bold tracking-tight text-balance">The Keeper extension</h1>
      <p className="mt-3 text-neutral-600 dark:text-neutral-400">
        It brings your Instagram saved posts into Keeper in one click, with cover images and captions, and puts your new order back on
        Instagram when you&apos;re ready. It works in Chrome (and Edge, Brave or Arc) on a computer, using the Instagram account you&apos;re
        logged into there.
      </p>

      <ExtensionStatus className="mt-6" />

      <h2 className="mt-10 text-lg font-semibold">Install the test version</h2>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Until it&apos;s in the Chrome Web Store, install it by hand. It takes about a minute.
      </p>
      <div className="mt-4">
        <ExtensionSteps />
      </div>
      <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
        To update it later, download the zip again, replace the folder, and click the reload arrow on the extension in{" "}
        <span className={code}>chrome://extensions</span>.
      </p>

      <h2 className="mt-10 text-lg font-semibold">What it does with your account</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
        <li>
          <b>Importing only reads.</b> It loads your saved posts and collections the way your Saved page does, at about the speed of
          scrolling. Nothing on Instagram changes.
        </li>
        <li>
          <b>Syncing changes your saves, slowly.</b> Instagram can&apos;t move a saved post, so Keeper unsaves and re-saves the posts that
          need to move, about one a minute, and stops if Instagram says to slow down. It only starts when you ask and tick the
          consent box.
        </li>
        <li>
          <b>Your login stays in your browser.</b> Keeper never sees your password, and your session never leaves this computer.
        </li>
        <li>
          Instagram doesn&apos;t officially support tools like this, so try syncing on a spare account first.
        </li>
      </ul>
      <p className="mt-6 text-sm text-neutral-600 dark:text-neutral-400">
        More in the{" "}
        <Link href="/privacy" className="font-medium text-accent underline underline-offset-2">
          privacy policy
        </Link>
        .
      </p>
    </main>
  );
}
