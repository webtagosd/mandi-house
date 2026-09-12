// Live-canvas editor bridge. Shipped on every page, but entirely inert unless
// BOTH: the page is loaded with ?wt-edit=1 (or ?wt-preview=1) AND it is embedded
// in an iframe (window.self !== window.top). Normal visitors never pay for this
// beyond a tiny deferred, no-op script load.
//
// Changelog:
//   2026-09-12: wt-highlight / wt-focus / wt-outline, sections in wt-ready, preview-deploy origins.
//
// Two modes:
//   ?wt-edit=1    full editing surface — hover outlines, click-to-select,
//                 wt-select messages, content/patch painting.
//   ?wt-preview=1 read-only draft preview (the dashboard's own-domain preview
//                 page) — paints wt-content/wt-patch same as edit mode, but no
//                 hover/click affordances and never posts wt-select.
//
// Message protocol (postMessage, JSON-serializable payloads only):
//   → parent  { type: "wt-ready",  keys: string[], sections: string[] }  on first paint; sections = distinct
//                                                          first segments of every data-wt key, DOM order
//   → parent  { type: "wt-select", key: string }           edit mode only — click of a [data-wt] element
//   → parent  { type: "wt-navigate", path: string }        edit mode only — click of an internal link;
//                                                          the dashboard switches its page state and
//                                                          re-points the iframe (keeps wt-edit intact)
//   ← parent  { type: "wt-content", content: object }      paint the dashboard's full draft over the page
//   ← parent  { type: "wt-patch",  key: string, value: any } live-patch a single key
//   ← parent  { type: "wt-highlight", prefix: string | null } outline + scroll to the section owning
//                                                          the first key matching prefix; null clears
//   ← parent  { type: "wt-focus", prefix: string | null }  dim every other section (no scroll); null clears
//   ← parent  { type: "wt-outline", key: string | null }   ring every [data-wt=key] element; null clears
//
// Allowed origins — the dashboard(s) permitted to talk to this bridge, both
// directions. Add future custom domains here as they come online. Vercel
// preview deploys of the dashboard are matched by PREVIEW_ORIGIN.
const ALLOWED_ORIGINS = [
  "https://webtag-live.vercel.app", // production dashboard
  "http://localhost:3020", // local dashboard dev
  "http://localhost:3000", // local dashboard dev (alt port)
];
const PREVIEW_ORIGIN = /^https:\/\/webtag-live(-[a-z0-9-]+)?(-webtagosd)?\.vercel\.app$/;
const isAllowedOrigin = (origin: string) => ALLOWED_ORIGINS.includes(origin) || PREVIEW_ORIGIN.test(origin);

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
  // Preview-deploy origins can't be fanned out to (regex), so they're only
  // reached once they've messaged us first.
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
  const cssEscape = (s: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s);

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
    document.querySelectorAll(`[data-wt="${cssEscape(key)}"]`).forEach((el) => applyValue(el, value));
  };

  // --- Section highlight / focus / outline (dashboard → site) ---------------

  // The section that "owns" a schema group: closest sectioning ancestor of the
  // first element whose key is `prefix` or lives under `prefix.`.
  const sectionFor = (prefix: string): HTMLElement | null => {
    const el = allWtElements().find((e) => {
      const key = e.getAttribute("data-wt") || "";
      return key === prefix || key.startsWith(prefix + ".");
    });
    if (!el) return null;
    return (el.closest("section, header, footer, main > *, [data-wt-section]") ?? el) as HTMLElement;
  };

  const clearClass = (cls: string) => {
    document.querySelectorAll("." + cls).forEach((el) => el.classList.remove(cls));
  };

  const highlight = (prefix: string | null) => {
    const target = prefix === null ? null : sectionFor(prefix);
    if (prefix !== null && !target) return; // unknown prefix — leave the page alone
    // Undo the inline position we set for a previous highlight before clearing it.
    document.querySelectorAll<HTMLElement>(".wt-section-on[data-wt-pos]").forEach((el) => {
      el.style.position = "";
      el.removeAttribute("data-wt-pos");
    });
    clearClass("wt-section-on");
    if (!target) return;
    // ::after overlay is absolutely positioned — needs a positioned ancestor.
    if (getComputedStyle(target).position === "static") {
      target.style.position = "relative";
      target.setAttribute("data-wt-pos", "");
    }
    target.classList.add("wt-section-on");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
  };

  // No scroll here — the dashboard sends wt-highlight first.
  const focus = (prefix: string | null) => {
    const target = prefix === null ? null : sectionFor(prefix);
    if (prefix !== null && !target) return;
    clearClass("wt-focus-on");
    document.documentElement.classList.toggle("wt-focusmode", !!target);
    if (target) target.classList.add("wt-focus-on");
  };

  const outline = (key: string | null) => {
    clearClass("wt-outline");
    if (key === null) return;
    document.querySelectorAll(`[data-wt="${cssEscape(key)}"]`).forEach((el) => el.classList.add("wt-outline"));
  };

  window.addEventListener("message", (event: MessageEvent) => {
    try {
      if (!isAllowedOrigin(event.origin)) return;
      if (!activeOrigin) activeOrigin = event.origin;
      const data = event.data as {
        type?: string;
        content?: unknown;
        key?: string | null;
        value?: unknown;
        prefix?: string | null;
      } | null;
      if (!data || typeof data !== "object") return;
      if (data.type === "wt-content" && data.content && typeof data.content === "object") {
        applyContent(data.content);
      } else if (data.type === "wt-patch" && typeof data.key === "string") {
        applyPatch(data.key, data.value);
      } else if (data.type === "wt-highlight" && (data.prefix === null || typeof data.prefix === "string")) {
        highlight(data.prefix);
      } else if (data.type === "wt-focus" && (data.prefix === null || typeof data.prefix === "string")) {
        focus(data.prefix);
      } else if (data.type === "wt-outline" && (data.key === null || typeof data.key === "string")) {
        outline(data.key);
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

  // Bridge styles, injected once. Hover/selected rules only ever match in edit mode
  // (nothing adds those classes in preview); the section/outline rules serve both.
  if (!document.getElementById("wt-bridge-css")) {
    const style = document.createElement("style");
    style.id = "wt-bridge-css";
    style.textContent = `
      [data-wt].wt-hover { outline: 1px dashed #1E40AF; outline-offset: 2px; cursor: pointer; }
      [data-wt].wt-selected { outline: 2px solid #1E40AF; outline-offset: 2px; }
      .wt-section-on { outline: 3px solid #4A90E2; outline-offset: -3px; transition: outline-color .25s; }
      .wt-section-on::after { content:""; position:absolute; inset:0; pointer-events:none; background:rgba(74,144,226,.10); animation: wtflash 1.2s ease; }
      @keyframes wtflash { from { background: rgba(74,144,226,.28); } }
      html.wt-focusmode section:not(.wt-focus-on), html.wt-focusmode header:not(.wt-focus-on), html.wt-focusmode footer:not(.wt-focus-on) { opacity:.28; filter:saturate(.4); transition: opacity .35s, filter .35s; }
      .wt-outline { box-shadow: 0 0 0 2px #4A90E2, 0 0 0 6px rgba(74,144,226,.25) !important; border-radius: 4px; }
    `;
    document.head.appendChild(style);
  }

  // Hover/selection affordances — edit mode only. Preview mode paints content but never
  // wires up hover outlines, click interception, or wt-select (it's a read-only draft view).
  if (editable) {
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
      const keys = Array.from(
        new Set(allWtElements().map((el) => el.getAttribute("data-wt")).filter((k): k is string => !!k))
      );
      const sections = Array.from(new Set(keys.map((k) => k.split(".")[0])));
      post({ type: "wt-ready", keys, sections });
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
