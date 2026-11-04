"use client";

// A clickable mockup of the simpler Keeper ("a 10-year-old with 3 Instagram
// accounts"). Everything here is pretend: no Instagram, no extension, no saving.
// It's for trying the flow before building it into the real app.

import { ArrowDown, ArrowLeft, ArrowUp, Check, Download, Hand, MoreHorizontal, Plus, Undo2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Account = { handle: string; color: string; saves: number; imported: boolean; mark: string };
type Post = { id: string; emoji: string; tint: string; author: string; caption: string; folder: string; fresh?: boolean };
type Status =
  | { kind: "ok"; text: string }
  | { kind: "getting"; done: number; total: number }
  | { kind: "checking" }
  | { kind: "sending"; left: number }
  | { kind: "wait"; text: string };

const ACCOUNTS: Account[] = [
  { handle: "ryancramer", color: "from-fuchsia-500 to-orange-400", saves: 4410, imported: true, mark: "RC" },
  { handle: "rcctest", color: "from-sky-500 to-emerald-400", saves: 212, imported: false, mark: "T" },
  { handle: "rcstudio", color: "from-violet-500 to-pink-500", saves: 38, imported: false, mark: "S" },
];

const SAMPLE: [string, string, string, string, string][] = [
  ["🍝", "from-amber-200 to-rose-300", "chef.maria", "Creamy garlic pasta in 15 minutes", "Recipes"],
  ["🏝️", "from-sky-200 to-teal-300", "jo_travels", "Hidden beach in Portugal nobody talks about", "Travel"],
  ["🎨", "from-pink-200 to-violet-300", "ana.draws", "Paint a sunset with just 3 colours", "Art"],
  ["🪴", "from-lime-200 to-green-300", "the.plant.lady", "How I keep my monstera happy", "Home"],
  ["🏋️", "from-orange-200 to-amber-300", "fitwithkai", "5-minute morning stretch", "Workouts"],
  ["🌮", "from-yellow-200 to-orange-300", "chef.maria", "Street tacos at home", "Recipes"],
  ["🛋️", "from-indigo-200 to-sky-300", "minimal.homes", "Small living room, big ideas", "Home"],
  ["🗻", "from-slate-200 to-sky-300", "jo_travels", "Sunrise hike, worth the 4am alarm", "Travel"],
  ["✏️", "from-rose-200 to-pink-300", "ana.draws", "Draw hands the easy way", "Art"],
  ["🥗", "from-emerald-200 to-lime-300", "greenbowl", "The only salad dressing you need", "Recipes"],
  ["🧘", "from-teal-200 to-cyan-300", "fitwithkai", "Breathing trick for falling asleep", "Workouts"],
  ["🎸", "from-red-200 to-orange-300", "riffs.daily", "Learn this riff in a day", "Music"],
];

const FOLDERS = ["All", "Recipes", "Travel", "Art", "Home", "Workouts", "Music"];

function makePosts(handle: string): Post[] {
  return SAMPLE.map(([emoji, tint, author, caption, folder], i) => ({ id: `${handle}-${i}`, emoji, tint, author, caption, folder }));
}

function Avatar({ account, size = "lg" }: { account: Account; size?: "lg" | "sm" }) {
  const box = size === "lg" ? "size-24 text-4xl" : "size-9 text-base";
  return (
    <span className={`flex ${box} shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${account.color} font-bold text-white shadow-sm`}>
      {account.mark}
    </span>
  );
}

const big =
  "flex flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl px-3 py-4 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40";

export function Mockup() {
  const [accounts, setAccounts] = useState<Account[]>(ACCOUNTS);
  const [instagramOn, setInstagramOn] = useState("ryancramer");
  const [open, setOpen] = useState<string | null>(null);
  const [switching, setSwitching] = useState<{ to: string; then: "open" | "add" } | null>(null);
  const [posts, setPosts] = useState<Record<string, Post[]>>({ ryancramer: makePosts("ryancramer") });
  const [history, setHistory] = useState<Record<string, Post[][]>>({});
  const [changed, setChanged] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<Record<string, Status>>({ ryancramer: { kind: "ok", text: "All up to date" } });
  const [folder, setFolder] = useState("All");
  const [confirmExport, setConfirmExport] = useState(false);
  const [more, setMore] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => clearInterval(t)), []);

  const account = accounts.find((a) => a.handle === open) ?? null;
  const list = (open && posts[open]) || [];
  const shown = folder === "All" ? list : list.filter((p) => p.folder === folder);
  const now = (open && status[open]) || { kind: "ok", text: "Not brought in yet" };
  const busy = now.kind === "getting" || now.kind === "checking" || now.kind === "sending";

  const tell = (text: string) => {
    setNote(text);
    window.setTimeout(() => setNote(null), 2600);
  };

  const choose = (handle: string) => {
    if (handle !== instagramOn) setSwitching({ to: handle, then: "open" });
    else {
      setOpen(handle);
      setFolder("All");
    }
  };

  const finishSwitch = () => {
    if (!switching) return;
    if (switching.then === "add") {
      const handle = "newaccount";
      setAccounts((a) => [...a, { handle, color: "from-amber-500 to-red-500", saves: 120, imported: false, mark: "N" }]);
      setInstagramOn(handle);
      setOpen(handle);
    } else {
      setInstagramOn(switching.to);
      setOpen(switching.to);
    }
    setFolder("All");
    setSwitching(null);
  };

  const edit = (next: Post[]) => {
    if (!open) return;
    setHistory((h) => ({ ...h, [open]: [...(h[open] ?? []), list] }));
    setPosts((p) => ({ ...p, [open]: next }));
    setChanged((c) => ({ ...c, [open]: (c[open] ?? 0) + 1 }));
  };
  const move = (id: string, by: number) => {
    const i = list.findIndex((p) => p.id === id);
    const j = Math.max(0, Math.min(list.length - 1, i + by));
    if (i === j) return;
    const next = [...list];
    const [item] = next.splice(i, 1);
    next.splice(j, 0, item);
    edit(next);
  };
  const undo = () => {
    if (!open || !history[open]?.length) return;
    const previous = history[open][history[open].length - 1];
    setHistory((h) => ({ ...h, [open]: h[open].slice(0, -1) }));
    setPosts((p) => ({ ...p, [open]: previous }));
    setChanged((c) => ({ ...c, [open]: Math.max(0, (c[open] ?? 1) - 1) }));
    tell("Undone");
  };

  const getSaves = () => {
    if (!open || !account) return;
    const handle = open;
    if (!account.imported) {
      let done = 0;
      setStatus((s) => ({ ...s, [handle]: { kind: "getting", done, total: account.saves } }));
      const t = window.setInterval(() => {
        done = Math.min(account.saves, done + Math.ceil(account.saves / 14));
        setStatus((s) => ({ ...s, [handle]: { kind: "getting", done, total: account.saves } }));
        if (done >= account.saves) {
          clearInterval(t);
          setPosts((p) => ({ ...p, [handle]: makePosts(handle) }));
          setAccounts((a) => a.map((x) => (x.handle === handle ? { ...x, imported: true } : x)));
          setStatus((s) => ({ ...s, [handle]: { kind: "ok", text: "All up to date" } }));
        }
      }, 280);
      timers.current.push(t);
    } else {
      setStatus((s) => ({ ...s, [handle]: { kind: "checking" } }));
      const t = window.setTimeout(() => {
        const fresh: Post = { id: `${handle}-new-${Date.now()}`, emoji: "🍰", tint: "from-pink-200 to-amber-200", author: "bakewithlu", caption: "No-bake cheesecake in a jar", folder: "Recipes", fresh: true };
        setPosts((p) => ({ ...p, [handle]: [fresh, ...(p[handle] ?? [])] }));
        setAccounts((a) => a.map((x) => (x.handle === handle ? { ...x, saves: x.saves + 1 } : x)));
        setStatus((s) => ({ ...s, [handle]: { kind: "ok", text: "1 new save, it's at the top" } }));
      }, 1400);
      timers.current.push(t);
    }
  };

  const sendBack = () => {
    if (!open) return;
    const handle = open;
    setConfirmExport(false);
    let left = Math.max(1, changed[handle] ?? 1);
    setStatus((s) => ({ ...s, [handle]: { kind: "sending", left } }));
    const t = window.setInterval(() => {
      left -= 1;
      if (left > 0) setStatus((s) => ({ ...s, [handle]: { kind: "sending", left } }));
      else {
        clearInterval(t);
        setChanged((c) => ({ ...c, [handle]: 0 }));
        setStatus((s) => ({ ...s, [handle]: { kind: "ok", text: "Instagram matches your order" } }));
      }
    }, 1200);
    timers.current.push(t);
  };

  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
        Mockup v0.5 · pretend data, nothing here touches Instagram ·{" "}
        <a href="/" className="font-medium underline">
          back to the real Keeper
        </a>
      </div>

      {!account ? (
        <main className="mx-auto flex max-w-3xl flex-col items-center px-4 py-12 text-center">
          <p className="text-lg font-bold">
            keeper<span className="text-accent">.cool</span>
          </p>
          <h1 className="mt-8 text-3xl font-bold tracking-tight">Whose saves are we organizing?</h1>
          <p className="mt-2 text-neutral-500">Tap a face. (The real app shows each account&apos;s Instagram profile photo.)</p>
          <div className="mt-10 flex flex-wrap justify-center gap-8">
            {accounts.map((a) => (
              <button key={a.handle} type="button" onClick={() => choose(a.handle)} className="group flex w-32 flex-col items-center gap-2">
                <span className="rounded-full ring-accent ring-offset-4 ring-offset-neutral-50 transition group-hover:ring-4 dark:ring-offset-neutral-950">
                  <Avatar account={a} />
                </span>
                <span className="font-semibold">@{a.handle}</span>
                <span className="text-sm text-neutral-500">{a.imported ? `${a.saves.toLocaleString()} saves` : "Not brought in yet"}</span>
              </button>
            ))}
            <button type="button" onClick={() => setSwitching({ to: "a new account", then: "add" })} className="group flex w-32 flex-col items-center gap-2">
              <span className="flex size-24 items-center justify-center rounded-full border-2 border-dashed border-neutral-300 text-neutral-400 transition group-hover:border-accent group-hover:text-accent dark:border-neutral-700">
                <Plus className="size-10" />
              </span>
              <span className="font-semibold">Add account</span>
            </button>
          </div>
        </main>
      ) : (
        <main className="mx-auto max-w-4xl px-4 pb-16">
          <header className="flex items-center gap-3 py-4">
            <button type="button" onClick={() => setOpen(null)} className="flex items-center gap-1 rounded-xl px-2 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800">
              <ArrowLeft className="size-4" /> Accounts
            </button>
            <Avatar account={account} size="sm" />
            <span className="min-w-0 truncate font-semibold">@{account.handle}</span>
            <button type="button" onClick={undo} disabled={!history[account.handle]?.length} className="ml-auto flex items-center gap-1.5 rounded-xl border border-neutral-300 px-3 py-2 text-sm font-semibold disabled:opacity-40 dark:border-neutral-700">
              <Undo2 className="size-4" /> Undo
            </button>
            <div className="relative">
              <button type="button" onClick={() => setMore((v) => !v)} className="flex items-center gap-1.5 rounded-xl border border-neutral-300 px-3 py-2 text-sm font-semibold dark:border-neutral-700">
                <MoreHorizontal className="size-4" /> More
              </button>
              {more && (
                <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-neutral-200 bg-white p-1 text-sm shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
                  {["Find duplicates", "Download a backup", "Run a check", "Help"].map((label) => (
                    <button key={label} type="button" onClick={() => { setMore(false); tell(`“${label}” lives here in the real app`); }} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800">
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </header>

          <StatusLine status={now} />

          <div className="mt-4 flex gap-3">
            <button type="button" onClick={getSaves} disabled={busy} className={`${big} bg-accent text-white hover:bg-accent/90`}>
              <Download className="size-6" /> {account.imported ? "Check for new saves" : "Get my saves"}
            </button>
            <button type="button" disabled={!account.imported} onClick={() => document.getElementById("organize")?.scrollIntoView({ behavior: "smooth" })} className={`${big} border-2 border-accent text-accent hover:bg-accent/5`}>
              <Hand className="size-6" /> Organize
            </button>
            <button type="button" onClick={() => setConfirmExport(true)} disabled={busy || !changed[account.handle]} className={`${big} bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900`}>
              <Upload className="size-6" /> Put back on Instagram
            </button>
          </div>
          {!changed[account.handle] && account.imported && (
            <p className="mt-2 text-right text-xs text-neutral-500">“Put back on Instagram” lights up once you move something.</p>
          )}

          {account.imported ? (
            <section id="organize" className="mt-8">
              <div className="flex flex-wrap gap-2">
                {FOLDERS.map((f) => (
                  <button key={f} type="button" onClick={() => setFolder(f)} className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${folder === f ? "bg-accent text-white" : "bg-white text-neutral-700 ring-1 ring-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:ring-neutral-800"}`}>
                    {f}
                  </button>
                ))}
                <button type="button" onClick={() => edit([...list].sort((a, b) => a.caption.localeCompare(b.caption)))} className="ml-auto rounded-full px-3.5 py-1.5 text-sm font-medium text-accent ring-1 ring-accent/40">
                  Sort A–Z
                </button>
              </div>
              <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {shown.map((p) => (
                  <li key={p.id} className="overflow-hidden rounded-2xl bg-white ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-800">
                    <div className={`relative flex aspect-square items-center justify-center bg-gradient-to-br ${p.tint} text-5xl`}>
                      {p.emoji}
                      {p.fresh && <span className="absolute top-2 left-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-white">NEW</span>}
                    </div>
                    <div className="space-y-1 p-2.5">
                      <p className="line-clamp-2 text-sm leading-snug">{p.caption}</p>
                      <p className="text-xs text-neutral-500">
                        @{p.author} · {p.folder}
                      </p>
                      {folder === "All" && (
                        <div className="flex gap-1 pt-1">
                          <button type="button" onClick={() => move(p.id, -1)} className="flex flex-1 items-center justify-center rounded-lg bg-neutral-100 py-1.5 dark:bg-neutral-800" aria-label="Move earlier">
                            <ArrowUp className="size-4" />
                          </button>
                          <button type="button" onClick={() => move(p.id, 1)} className="flex flex-1 items-center justify-center rounded-lg bg-neutral-100 py-1.5 dark:bg-neutral-800" aria-label="Move later">
                            <ArrowDown className="size-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-center text-xs text-neutral-500">In the real app you also drag posts, rename them and drop them into folders.</p>
            </section>
          ) : (
            <p className="mt-16 text-center text-neutral-500">Tap “Get my saves” to bring @{account.handle}&apos;s saves in.</p>
          )}
        </main>
      )}

      {switching && <SwitchWindow to={switching.to} adding={switching.then === "add"} onDone={finishSwitch} onCancel={() => setSwitching(null)} />}

      {confirmExport && account && (
        <Modal title="Put your order back on Instagram" onClose={() => setConfirmExport(false)}>
          <p>
            Keeper will move <b>{changed[account.handle]} posts</b> on @{account.handle}&apos;s Saved page so it matches your order. About one a minute, so
            about {changed[account.handle]} min. You can close Keeper while it works.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmExport(false)} className="rounded-xl px-4 py-2.5 font-semibold text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800">
              Not now
            </button>
            <button type="button" onClick={sendBack} className="rounded-xl bg-accent px-4 py-2.5 font-semibold text-white">
              Start
            </button>
          </div>
        </Modal>
      )}

      {note && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm text-white shadow-lg">{note}</div>}
    </div>
  );
}

function StatusLine({ status }: { status: Status }) {
  const tone =
    status.kind === "ok"
      ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200"
      : status.kind === "wait"
        ? "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
        : "bg-accent/10 text-accent";
  const percent = status.kind === "getting" ? Math.round((100 * status.done) / status.total) : null;
  return (
    <div className={`rounded-2xl px-4 py-3 text-sm font-medium ${tone}`} role="status">
      {status.kind === "ok" && (
        <span className="flex items-center gap-2">
          <Check className="size-4" /> {status.text}
        </span>
      )}
      {status.kind === "checking" && "Looking for new saves…"}
      {status.kind === "getting" && (
        <>
          <span>
            Getting your saves… {status.done.toLocaleString()} of {status.total.toLocaleString()}
          </span>
          <span className="mt-2 block h-2 overflow-hidden rounded-full bg-white/60 dark:bg-black/30">
            <span className="block h-full rounded-full bg-accent transition-all" style={{ width: `${percent}%` }} />
          </span>
        </>
      )}
      {status.kind === "sending" && `Putting your order back on Instagram… ${status.left} to go. You can close Keeper.`}
      {status.kind === "wait" && status.text}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-t-3xl bg-white p-6 shadow-xl sm:rounded-3xl dark:bg-neutral-900">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-xl font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="text-neutral-700 dark:text-neutral-300">{children}</div>
      </div>
    </div>
  );
}

/** Keeper's guide on the left, a pretend Instagram window on the right: tap the account there. */
function SwitchWindow({ to, adding, onDone, onCancel }: { to: string; adding: boolean; onDone: () => void; onCancel: () => void }) {
  const [step, setStep] = useState<"menu" | "list">("menu");
  return (
    <Modal title={adding ? "Add an Instagram account" : `Switching to @${to}`} onClose={onCancel}>
      <ol className="space-y-2 text-sm">
        <li className={step === "menu" ? "font-semibold text-accent" : "text-neutral-500 line-through"}>1. In the Instagram window, tap your photo.</li>
        <li className={step === "list" ? "font-semibold text-accent" : ""}>
          2. Tap {adding ? <b>Add account</b> : <b>@{to}</b>}.
        </li>
        <li>3. That&apos;s it: Keeper notices and closes the window.</li>
      </ol>
      <div className="mt-4 overflow-hidden rounded-2xl border border-neutral-300 dark:border-neutral-700">
        <div className="flex items-center gap-1.5 border-b border-neutral-200 bg-neutral-100 px-3 py-1.5 text-[11px] text-neutral-500 dark:border-neutral-800 dark:bg-neutral-800">
          <span className="size-2 rounded-full bg-red-400" /> <span className="size-2 rounded-full bg-amber-400" /> <span className="size-2 rounded-full bg-green-400" />
          <span className="ml-2">instagram.com (pretend)</span>
        </div>
        <div className="space-y-2 p-4">
          {step === "menu" ? (
            <button type="button" onClick={() => setStep("list")} className="flex items-center gap-2 rounded-xl px-2 py-1.5 ring-2 ring-accent ring-offset-2 dark:ring-offset-neutral-900">
              <span className="size-8 rounded-full bg-gradient-to-br from-fuchsia-500 to-orange-400" />
              <span className="text-sm font-semibold">Your photo</span>
            </button>
          ) : (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-neutral-500">Switch accounts</p>
              {(adding ? ["Add account"] : [`@${to}`]).map((label) => (
                <button key={label} type="button" onClick={onDone} className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm font-semibold ring-2 ring-accent">
                  {adding ? <Plus className="size-5" /> : <span className="size-6 rounded-full bg-gradient-to-br from-sky-500 to-emerald-400" />}
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <p className="mt-3 text-xs text-neutral-500">In the real app this is Instagram&apos;s own small window, which Keeper opens and closes for you.</p>
    </Modal>
  );
}
