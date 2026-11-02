// Runs in the page's own context on instagram.com, before Instagram's code.
// Instagram doesn't let every account ask for its list of collections
// directly, but its own Saved page always loads them. This notices
// collection names and ids in what Instagram's page receives (nothing else
// is kept) and hands them to Keeper's part of the extension. Nothing is
// changed, blocked or sent anywhere.
(() => {
  if (window.__keeperSniff) return;
  window.__keeperSniff = true;

  const found = new Map(); // collection id -> name
  const paths = []; // Instagram addresses whose replies held collections, for the check report.
  const post = (pairs) =>
    window.postMessage({ __keeper: "collections", pairs, paths: paths.slice(-10) }, location.origin);

  function walk(node, out, depth = 0) {
    if (!node || typeof node !== "object" || depth > 40) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, out, depth + 1);
      return;
    }
    const name = node.collection_name;
    const id = node.collection_id ?? (name !== undefined ? (node.id ?? node.pk) : undefined);
    const type = node.collection_type;
    if (typeof name === "string" && id != null && /^\d{5,}$/.test(String(id)) && (!type || type === "MEDIA")) {
      out.push([String(id), name]);
    }
    for (const key in node) {
      const value = node[key];
      if (value && typeof value === "object") walk(value, out, depth + 1);
    }
  }

  function scan(text, where) {
    if (typeof text !== "string" || text.indexOf("collection_name") < 0) return;
    const out = [];
    // Long ids would lose digits as JavaScript numbers: quote them first.
    const safe = text.replace(/^for \(;;\);/, "").replace(/([:[,]\s*)(\d{16,})(?=\s*[,\]}])/g, '$1"$2"');
    for (const chunk of safe.split(/\n(?=[{[])/)) {
      try {
        walk(JSON.parse(chunk), out);
      } catch {
        // Not JSON on its own: fall back to spotting the pairs in the text.
        const pattern = /"collection_id"\s*:\s*"?(\d{5,})"?[^{}]{0,400}?"collection_name"\s*:\s*"((?:[^"\\]|\\.)*)"|"collection_name"\s*:\s*"((?:[^"\\]|\\.)*)"[^{}]{0,400}?"collection_id"\s*:\s*"?(\d{5,})"?/g;
        let m;
        while ((m = pattern.exec(chunk))) {
          const id = m[1] || m[4];
          const raw = m[1] ? m[2] : m[3];
          try {
            out.push([id, JSON.parse(`"${raw}"`)]);
          } catch {
            out.push([id, raw]);
          }
        }
      }
    }
    const fresh = out.filter(([id, name]) => found.get(id) !== name);
    if (!out.length) return;
    if (where && !paths.includes(where)) paths.push(where);
    for (const [id, name] of fresh) found.set(id, name);
    if (fresh.length) post(fresh);
  }

  const pathOf = (url) => {
    try {
      return new URL(url, location.href).pathname;
    } catch {
      return "";
    }
  };
  const worthReading = (url) => /\/(api|graphql)\//.test(pathOf(url));

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const result = originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0] && args[0].url;
      if (worthReading(url)) {
        result.then((res) => res.clone().text().then((text) => scan(text, pathOf(url)))).catch(() => {});
      }
    } catch {
      // Never get in Instagram's way.
    }
    return result;
  };

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      if (worthReading(url)) {
        this.addEventListener("load", () => {
          try {
            if (this.responseType === "" || this.responseType === "text") scan(this.responseText, pathOf(url));
          } catch {
            // Ignore.
          }
        });
      }
    } catch {
      // Never get in Instagram's way.
    }
    return open.call(this, method, url, ...rest);
  };

  // Data the page arrives with, inside its own script tags.
  const scanScripts = () => {
    for (const script of document.querySelectorAll('script[type="application/json"]')) scan(script.textContent, "page");
  };
  document.addEventListener("DOMContentLoaded", scanScripts);

  // Keeper's part of the extension may start after some of this was seen: send it all again when asked.
  window.addEventListener("message", (event) => {
    if (event.source === window && event.data && event.data.__keeper === "hello") {
      scanScripts();
      post([...found]);
    }
  });
})();
