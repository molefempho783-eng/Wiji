// Small DOM helpers, formatting, dialogs and charts. Everything user-supplied goes in as text, never HTML.

/** Create an element: h("div", { class: "x", onclick: fn }, "text", child) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Replace an element's children, skipping null/false (replaceChildren would print "null") */
export const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));

/** Fill an element with text that resolves later (e.g. a user's name). */
export function later(promise, fallback = "…") {
  const span = h("span", {}, fallback);
  Promise.resolve(promise).then((v) => (span.textContent = v ?? "—")).catch(() => (span.textContent = "—"));
  return span;
}

const SVGNS = "http://www.w3.org/2000/svg";
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/** Simple line icons (stroke = currentColor). */
const ICONS = {
  overview: "M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  car: "M5 17h14M6 17v2M18 17v2M3 13l2-6h14l2 6v4H3zM7 13h.01M17 13h.01",
  store: "M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6",
  team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  refresh: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  back: "M19 12H5M12 19l-7-7 7-7",
  map: "M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
  receipt: "M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2zM8 8h8M8 12h8M8 16h5",
  menu: "M4 6h16M4 12h16M4 18h10",
  tag: "M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
};
export function icon(name, cls = "icon") {
  return s("svg", { class: cls, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" },
    s("path", { d: ICONS[name] || "" }));
}

/* ---------- formatting ---------- */
export const toMs = (v) => (v?.toMillis ? v.toMillis() : v?.seconds ? v.seconds * 1000 : v instanceof Date ? v.getTime() : typeof v === "number" ? v : typeof v === "string" && !isNaN(Date.parse(v)) ? Date.parse(v) : null);
export function fmtDate(v, withTime = true) {
  const ms = toMs(v);
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-ZA", { day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });
}
export function ago(v) {
  const ms = toMs(v);
  if (!ms) return "—";
  const sec = Math.round((Date.now() - ms) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h ago`;
  return `${Math.floor(sec / 86400)} d ago`;
}
export const rand = (n) => (n === null || n === undefined ? "—" : `R${Number(n).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`);
export const num = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("en-ZA"));
export function chip(text, tone = "") {
  return h("span", { class: `chip ${tone}` }, text);
}

/* ---------- toasts and dialogs ---------- */
export function toast(msg, tone = "") {
  const t = h("div", { class: `toast ${tone}`, role: "status" }, msg);
  document.getElementById("toasts").append(t);
  setTimeout(() => t.remove(), tone === "bad" ? 7000 : 4000);
}

/** Generic dialog. Returns a promise that resolves with the clicked action's value (or null). */
export function dialog({ title, body, actions }) {
  return new Promise((resolve) => {
    const close = (v) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(v);
    };
    const onKey = (e) => e.key === "Escape" && close(null);
    const overlay = h("div", { class: "overlay", onclick: (e) => e.target === overlay && close(null) },
      h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title },
        h("h2", {}, title),
        body,
        h("div", { class: "btn-row" },
          ...(actions || [{ label: "Close", value: null }]).map((a) =>
            h("button", { class: `btn ${a.kind || ""}`, onclick: async () => {
              if (a.validate) {
                const err = a.validate();
                if (err) return toast(err, "bad");
              }
              close(typeof a.value === "function" ? a.value() : a.value);
            } }, a.label)))));
    document.addEventListener("keydown", onKey);
    document.body.append(overlay);
    overlay.querySelector("textarea, input, .btn.primary, .btn")?.focus();
  });
}

/** Ask for a written reason/note. Resolves with the text, or null if cancelled. */
export function askText({ title, message, label = "Reason", placeholder = "", min = 10, confirm = "Confirm", kind = "primary", optional = false }) {
  const ta = h("textarea", { class: "input", placeholder, "aria-label": label });
  return dialog({
    title,
    body: h("div", {}, message ? h("p", { class: "muted" }, message) : null, h("label", { class: "field" }, h("span", {}, label), ta)),
    actions: [
      { label: "Cancel", value: null },
      { label: confirm, kind, value: () => ta.value.trim(), validate: () => (!optional && ta.value.trim().length < min ? `Write at least a sentence (${min}+ characters).` : null) },
    ],
  });
}

export function confirmBox(title, message, confirm = "Confirm", kind = "primary") {
  return dialog({ title, body: h("p", {}, message), actions: [{ label: "Cancel", value: false }, { label: confirm, kind, value: true }] });
}

export function lightbox(url) {
  const overlay = h("div", { class: "overlay lightbox", onclick: () => overlay.remove() }, h("img", { src: url, alt: "Document" }));
  document.body.append(overlay);
}

/** Run an async action with the button disabled; show errors as toasts. */
export async function busy(btn, fn, okMsg) {
  const label = btn?.textContent;
  try {
    if (btn) { btn.disabled = true; btn.textContent = "Working…"; }
    const r = await fn();
    if (okMsg) toast(okMsg, "good");
    return r;
  } catch (e) {
    toast(e.message || "Something went wrong.", "bad");
    return undefined;
  } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = label; }
  }
}

/* ---------- charts ---------- */
/** Daily bar chart: series = [{ day: "YYYY-MM-DD", value }] */
export function barChart(series, { format = num, label = "" } = {}) {
  const W = 600, H = 160, pad = { l: 34, r: 6, t: 10, b: 22 };
  const max = Math.max(1, ...series.map((d) => d.value));
  const bw = (W - pad.l - pad.r) / Math.max(1, series.length);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const svg = s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img", "aria-label": label });
  for (const f of [0, 0.5, 1]) {
    const yy = y(max * f);
    svg.append(s("line", { class: "grid-line", x1: pad.l, x2: W - pad.r, y1: yy, y2: yy }));
    svg.append(s("text", { class: "axis", x: pad.l - 6, y: yy + 4, "text-anchor": "end" }, format(Math.round(max * f))));
  }
  series.forEach((d, i) => {
    const x = pad.l + i * bw + bw * 0.15;
    const bar = s("rect", { class: "bar", x, y: y(d.value), width: bw * 0.7, height: Math.max(0, H - pad.b - y(d.value)), rx: 2 });
    bar.append(s("title", {}, `${d.day}: ${format(d.value)}`));
    svg.append(bar);
  });
  if (series.length) {
    const short = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
    svg.append(s("text", { class: "axis", x: pad.l, y: H - 6 }, short(series[0].day)));
    svg.append(s("text", { class: "axis", x: W - pad.r, y: H - 6, "text-anchor": "end" }, short(series[series.length - 1].day)));
  }
  return svg;
}

/** Horizontal bars for categories: entries = [[label, value], ...] */
export function barList(entries, labels = {}) {
  const max = Math.max(1, ...entries.map((e) => e[1]));
  if (!entries.length) return h("p", { class: "muted" }, "Nothing in the last 30 days.");
  return h("div", { class: "barlist" },
    entries.sort((a, b) => b[1] - a[1]).map(([k, v]) =>
      h("div", { class: "row" },
        h("span", {}, labels[k] || k),
        h("div", { class: "track" }, h("div", { class: "fill", style: { width: `${(v / max) * 100}%` } })),
        h("b", { class: "mono" }, String(v)))));
}
