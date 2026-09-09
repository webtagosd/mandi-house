// Live-canvas editor bridge. Shipped on every page, but entirely inert unless
// BOTH: the page is loaded with ?wt-edit=1 (or ?wt-preview=1) AND it is embedded
// in an iframe (window.self !== window.top). Normal visitors never pay for this
// beyond a tiny deferred, no-op script load.
//
// Two modes:
//   ?wt-edit=1    full editing surface — hover outlines, click-to-select,
//                 wt-select messages, content/patch painting.
//   ?wt-preview=1 read-only draft preview (the dashboard's own-domain preview
//                 page) — paints wt-content/wt-patch same as edit mode, but no
//                 hover/click affordances and never posts wt-select.
//
// Message protocol (postMessage, JSON-serializable payloads only):
//   → parent  { type: "wt-ready",  keys: string[] }        on first paint
//   → parent  { type: "wt-select", key: string }           edit mode only — click of a [data-wt] element
//   → parent  { type: "wt-navigate", path: string }        edit mode only — click of an internal link;
//                                                          the dashboard switches its page state and
//                                                          re-points the iframe (keeps wt-edit intact)
//   ← parent  { type: "wt-content", content: object }      paint the dashboard's full draft over the page
//   ← parent  { type: "wt-patch",  key: string, value: any } live-patch a single key
//
// Allowed origins — the dashboard(s) permitted to talk to this bridge, both
// directions. Add future custom domains here as they come online.
const ALLOWED_ORIGINS = [
  "https://webtag-live.vercel.app", // production dashboard
  "http://localhost:3020", // local dashboard dev
];

(function initEditorBridge() {
  let mode: "edit" | "preview" | null = null;
  try {
    const params = new URLSearchParams(window.location.search);
    const iframed = window.self !== window.top;
    if (iframed && params.get("wt-edit") === "1") mode = "edit";
    else if (iframed && params.get("wt-preview") === "1") mode = "preview";
  } catch {
    mode = null;
  }
  if (!mode) return;
  const editable = mode === "edit";

  // Origin that sent us the first valid inbound message. Until then, replies
  // fan out to every allowed origin (harmless — postMessage with an explicit
  // targetOrigin only delivers if it matches the actual recipient's origin).
  let activeOrigin: string | null = null;

  const post = (msg: unknown) => {
    const targets = activeOrigin ? [activeOrigin] : ALLOWED_ORIGINS;
    for (const origin of targets) {
      try {
        window.parent.postMessage(msg, origin);
      } catch {
        // never throw into the page
      }
    }
  };

  // Resolve a dot-path (with numeric indices, e.g. "services.list.0.name")
  // against a plain object/array tree.
  const resolvePath = (obj: unknown, path: string): unknown => {
    let cur: unknown = obj;
    for (const segment of path.split(".")) {
      if (cur == null) return undefined;
      cur = (cur as Record<string, unknown>)[segment];
    }
    return cur;
  };

  const applyValue = (el: Element, value: unknown) => {
    const attr = el.getAttribute("data-wt-attr");
    const str = value == null ? "" : String(value);
    if (attr) {
      // Never clobber an attribute with an empty value — an unset image/link in the
      // draft means "keep what the build shipped", not src=""/href="" (broken image).
      if (str === "") return;
      el.setAttribute(attr, str);
      // Astro's <Image> emits srcset+sizes, and browsers prefer srcset over a patched
      // src — strip them so the swapped image actually shows in the canvas.
      if (attr === "src" && (el.tagName === "IMG" || el.tagName === "SOURCE")) {
        el.removeAttribute("srcset");
        el.removeAttribute("sizes");
      }
    } else {
      el.textContent = str;
    }
  };

  const allWtElements = (): Element[] => Array.from(document.querySelectorAll("[data-wt]"));

  const applyContent = (content: unknown) => {
    for (const el of allWtElements()) {
      const key = el.getAttribute("data-wt");
      if (!key) continue;
      const value = resolvePath(content, key);
      if (value === undefined) continue; // don't clobber with missing data
      applyValue(el, value);
    }
  };

  const applyPatch = (key: string, value: unknown) => {
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(key) : key;
    document.querySelectorAll(`[data-wt="${escaped}"]`).forEach((el) => applyValue(el, value));
  };

  window.addEventListener("message", (event: MessageEvent) => {
    try {
      if (!ALLOWED_ORIGINS.includes(event.origin)) return;
      if (!activeOrigin) activeOrigin = event.origin;
      const data = event.data as { type?: string; content?: unknown; key?: string; value?: unknown } | null;
      if (!data || typeof data !== "object") return;
      if (data.type === "wt-content" && data.content && typeof data.content === "object") {
        applyContent(data.content);
      } else if (data.type === "wt-patch" && typeof data.key === "string") {
        applyPatch(data.key, data.value);
      }
    } catch {
      // never throw into the page
    }
  });

  // Resolve a clicked <a> to a same-site path ("/menu"), or null for external/hash links.
  const internalPath = (a: Element): string | null => {
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#")) return null;
    try {
      const u = new URL(href, window.location.href);
      if (u.origin !== window.location.origin) return null;
      return u.pathname + u.search.replace(/[?&]wt-(edit|preview)=1/g, "");
    } catch {
      return null;
    }
  };

  // Preview mode: internal links navigate WITHIN preview (self-navigate, re-appending the
  // wt-preview param so the next page's bridge stays active and repaints the draft on its
  // own wt-ready). External links are inert — the canvas must never leave the site.
  if (mode === "preview") {
    document.addEventListener(
      "click",
      (e) => {
        const a = (e.target as Element | null)?.closest("a");
        if (!a) return;
        e.preventDefault();
        const path = internalPath(a);
        if (path) {
          window.location.href = path + (path.includes("?") ? "&" : "?") + "wt-preview=1";
        }
      },
      true
    );
  }

  // Hover/selection affordances — edit mode only. Preview mode paints content but never
  // wires up hover outlines, click interception, or wt-select (it's a read-only draft view).
  if (editable) {
    const style = document.createElement("style");
    style.textContent = `
      [data-wt].wt-hover { outline: 1px dashed #1E40AF; outline-offset: 2px; cursor: pointer; }
      [data-wt].wt-selected { outline: 2px solid #1E40AF; outline-offset: 2px; }
    `;
    document.head.appendChild(style);

    let selected: Element | null = null;

    document.addEventListener(
      "mouseover",
      (e) => {
        const target = (e.target as Element | null)?.closest("[data-wt]");
        if (target) target.classList.add("wt-hover");
      },
      true
    );
    document.addEventListener(
      "mouseout",
      (e) => {
        const target = (e.target as Element | null)?.closest("[data-wt]");
        if (target) target.classList.remove("wt-hover");
      },
      true
    );
    document.addEventListener(
      "click",
      (e) => {
        // Internal links navigate (the dashboard switches page + re-points the iframe so
        // wt-edit survives); their labels stay editable via the drawer. External links are
        // inert — the canvas must never leave the site or drop its edit params.
        const a = (e.target as Element | null)?.closest("a");
        if (a) {
          e.preventDefault();
          const path = internalPath(a);
          if (path) post({ type: "wt-navigate", path });
          return;
        }
        const target = (e.target as Element | null)?.closest("[data-wt]");
        if (!target) return;
        e.preventDefault();
        const key = target.getAttribute("data-wt");
        if (!key) return;
        if (selected) selected.classList.remove("wt-selected");
        selected = target;
        target.classList.add("wt-selected");
        post({ type: "wt-select", key });
      },
      true
    );
  }

  const ready = () => {
    try {
      const keys = Array.from(new Set(allWtElements().map((el) => el.getAttribute("data-wt")).filter(Boolean)));
      post({ type: "wt-ready", keys });
    } catch {
      // never throw into the page
    }
  };

  if (document.readyState === "complete" || document.readyState === "interactive") {
    ready();
  } else {
    document.addEventListener("DOMContentLoaded", ready);
  }
})();
