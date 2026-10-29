const $ = (id) => document.getElementById(id);

function describe(job) {
  if (!job) return "Open Keeper to import your saved posts or push your order to Instagram.";
  const progress = `${job.done.toLocaleString()} of ${job.total.toLocaleString()} posts`;
  switch (job.status) {
    case "running":
      return `Pushing to Instagram: ${progress}. Keep Chrome open.`;
    case "waiting":
      return `${progress}. ${job.message}`;
    case "paused":
    case "blocked":
      return `${progress}. ${job.message}`;
    case "done":
      return `Push finished: ${progress}.`;
    case "cancelled":
      return `Push cancelled after ${progress}.`;
    default:
      return progress;
  }
}

async function refresh() {
  const job = await chrome.runtime.sendMessage({ type: "status" });
  $("status").textContent = describe(job);
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
