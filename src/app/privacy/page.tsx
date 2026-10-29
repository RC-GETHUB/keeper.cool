import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Keeper and the Keeper extension do with your data.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-sm leading-relaxed sm:py-14">
      <Link href="/" className="text-lg font-bold tracking-tight">
        keeper<span className="text-accent">.cool</span>
      </Link>
      <h1 className="mt-8 text-3xl font-bold tracking-tight">Privacy</h1>
      <p className="mt-2 text-neutral-500">Last updated October 29, 2026</p>

      <div className="mt-6 space-y-6 text-neutral-700 dark:text-neutral-300 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-neutral-900 dark:[&_h2]:text-neutral-100">
        <section>
          <h2>The short version</h2>
          <p>
            Keeper organizes your Instagram saved posts. Your library is stored in your own browser, on your own device. Keeper
            doesn&apos;t sell, share or upload it, and never sees your Instagram password.
          </p>
        </section>

        <section>
          <h2>What Keeper stores</h2>
          <p>
            For each saved post: its link and Instagram id, the username of who posted it, its caption, a small cover image, when you
            saved it, and anything you add in Keeper (names, order, collections). This is kept in your browser&apos;s storage
            (IndexedDB) for keeper.cool. Deleting your library in Keeper, or clearing site data in your browser, removes it.
          </p>
        </section>

        <section>
          <h2>Instagram export files</h2>
          <p>
            If you upload Instagram&apos;s data export, Keeper reads it in your browser and keeps only the saved-post details above.
            The file itself is never uploaded.
          </p>
        </section>

        <section>
          <h2>The Keeper browser extension</h2>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              It works only on instagram.com, Instagram&apos;s image servers, and keeper.cool. It reads your saved posts and collections
              from your logged-in Instagram tab and hands them to Keeper in the same browser.
            </li>
            <li>
              When you choose to sync, it saves and unsaves posts and adds them to collections on your account, only after you ask and
              agree, and only to make Instagram match the order you set in Keeper.
            </li>
            <li>
              It uses your existing Instagram login in the browser. It never reads, stores or sends your password, and your session
              never leaves your computer.
            </li>
            <li>It keeps the progress of a sync in the extension&apos;s local storage so it can resume after Chrome restarts.</li>
            <li>It doesn&apos;t collect browsing history, analytics or anything from other websites, and it doesn&apos;t load remote code.</li>
          </ul>
        </section>

        <section>
          <h2>What we never do</h2>
          <p>
            Sell your data, use it for advertising, share it with third parties, or use it for anything other than organizing your saved
            posts.
          </p>
        </section>

        <section>
          <h2>Changes</h2>
          <p>
            When Keeper adds accounts (so your library follows you between devices), this page will be updated to explain what is
            stored on our servers and how to delete it, before that feature is turned on.
          </p>
        </section>

        <section>
          <h2>Instagram</h2>
          <p>Keeper is not affiliated with, endorsed by or sponsored by Instagram or Meta.</p>
        </section>
      </div>
    </main>
  );
}
