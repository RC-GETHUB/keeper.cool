// Runs on Keeper's own pages and passes messages between the page and the
// extension. Only messages from the page itself are accepted.
(() => {
  let port = null;

  // After the extension is updated or reloaded, this copy (still running in
  // pages that were already open) can no longer reach it. Tell the page so it
  // can ask for a reload instead of waiting forever.
  function stale() {
    window.postMessage({ keeper: "extension", event: "stale" }, location.origin);
  }

  function connect() {
    port = chrome.runtime.connect({ name: "keeper" });
    port.onMessage.addListener((message) => window.postMessage({ keeper: "extension", ...message }, location.origin));
    port.onDisconnect.addListener(() => {
      port = null;
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.keeper !== "page" || typeof data.type !== "string") return;
    try {
      if (!port) connect();
      port.postMessage({ id: data.id, type: data.type, payload: data.payload });
    } catch {
      port = null;
      stale();
    }
  });

  // Let the page know the extension is here, even if it loaded first.
  document.documentElement.dataset.keeperExtension = chrome.runtime.getManifest().version;
  window.postMessage({ keeper: "extension", event: "installed" }, location.origin);
})();
