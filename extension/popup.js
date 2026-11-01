const $ = (id) => document.getElementById(id);

function describe(job) {
  if (!job) return "Open Keeper to bring in your saved posts or sync your order to Instagram.";
  const progress = `${job.done.toLocaleString()} of ${job.total.toLocaleString()} posts`;
  switch (job.status) {
    case "running":
      return `Syncing to Instagram: ${progress}. Keep Chrome open.`;
    case "waiting":
      return `${progress}. ${job.message}`;
    case "paused":
    case "blocked":
      return `${progress}. ${job.message}`;
    case "done":
      return `Sync finished: ${progress}.`;
    case "cancelled":
      return `Sync stopped after ${progress}.`;
    default:
      return progress;
  }
}

async function refresh() {
  const job = await chrome.runtime.sendMessage({ type: "status" });
  const problem = await chrome.runtime.sendMessage({ type: "problem" });
  $("status").textContent = describe(job);
  const recent = problem && Date.now() - problem.at < 3 * 3600_000;
  $("problem").hidden = !recent;
  if (recent) $("problem").textContent = `Last problem (${new Date(problem.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}): ${problem.message}${problem.detail ? ` Instagram said: ${problem.detail}` : ""}`;
  const active = job && (job.status === "running" || job.status === "waiting");
  const stopped = job && (job.status === "paused" || job.status === "blocked");
  $("pause").hidden = !active;
  $("resume").hidden = !stopped;
  $("cancel").hidden = !(active || stopped);
  $("bar").hidden = !job || !job.total;
  if (job && job.total) $("bar").firstElementChild.style.width = `${(100 * job.done) / job.total}%`;
}

for (const action of ["pause", "resume", "cancel"]) {
  $(action).addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: action });
    refresh();
  });
}

refresh();
setInterval(refresh, 3000);
