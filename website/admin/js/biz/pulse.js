// Wiji Pulse (business portal): income forecast, slow-week alerts and a funding-readiness score,
// built from the payments this business has received through Wiji.
import { db, collection, getDocs, query, where } from "../firebase.js";
import { h, fill, chip } from "../ui.js";
import { B, onBiz } from "./store.js";
import { DAY_NAMES, computePulse, profileText, rand, samplePayments, shortDate } from "./pulseModel.js";

const NS = "http://www.w3.org/2000/svg";
const sv = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => v !== undefined && el.setAttribute(k, String(v)));
  kids.forEach((k) => el.append(k instanceof Node ? k : document.createTextNode(String(k))));
  return el;
};
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** 12 past weeks (solid) + 4 forecast weeks (dashed, with a likely-range line; slow weeks in amber). */
function forecastChart(r) {
  const W = 760, H = 220, pad = { l: 52, r: 8, t: 12, b: 34 };
  const weeks = [...r.history.map((w) => ({ start: w.start, v: w.totalCents, kind: "past" })), ...r.forecast.map((f) => ({ start: f.start, v: f.expectedCents, lo: f.lowCents, hi: f.highCents, kind: f.slow ? "slow" : "fc" }))];
  const max = Math.max(1, ...weeks.map((w) => w.hi ?? w.v));
  const bw = (W - pad.l - pad.r) / weeks.length;
  const y = (c) => pad.t + (H - pad.t - pad.b) * (1 - c / max);
  const svg = sv("svg", { class: "chart pulse-chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Weekly income for the last 12 weeks and the forecast for the next 4" });
  for (const f of [0, 0.5, 1]) {
    const yy = y(max * f);
    svg.append(sv("line", { class: "grid-line", x1: pad.l, x2: W - pad.r, y1: yy, y2: yy }));
    svg.append(sv("text", { class: "axis", x: pad.l - 6, y: yy + 4, "text-anchor": "end" }, rand(max * f)));
  }
  const splitX = pad.l + r.history.length * bw;
  svg.append(sv("line", { x1: splitX, x2: splitX, y1: pad.t, y2: H - pad.b, stroke: "var(--muted)", "stroke-dasharray": "3 4", "stroke-width": 1 }));
  svg.append(sv("text", { class: "axis", x: splitX + 4, y: pad.t + 10 }, "forecast"));
  weeks.forEach((w, i) => {
    const x = pad.l + i * bw + bw * 0.18;
    const bwid = bw * 0.64;
    const tone = w.kind === "slow" ? "var(--warn)" : "var(--brand)";
    const g = sv("g", {});
    if (w.kind === "past") {
      g.append(sv("rect", { class: "bar", x, y: y(w.v), width: bwid, height: Math.max(1, H - pad.b - y(w.v)), rx: 3 }));
    } else {
      g.append(sv("line", { x1: x + bwid / 2, x2: x + bwid / 2, y1: y(w.hi), y2: y(w.lo), stroke: tone, "stroke-width": 2, opacity: 0.55 }));
      g.append(sv("rect", { x, y: y(w.v), width: bwid, height: Math.max(1, H - pad.b - y(w.v)), rx: 3, fill: tone, "fill-opacity": 0.18, stroke: tone, "stroke-width": 2, "stroke-dasharray": "5 4" }));
    }
    g.append(sv("title", {}, `Week of ${shortDate(w.start)}: ${rand(w.v)}${w.kind === "past" ? "" : ` expected (${rand(w.lo)}–${rand(w.hi)})${w.kind === "slow" ? ", slow week" : ""}`}`));
    svg.append(g);
    if (i % 2 === 0 || w.kind !== "past") svg.append(sv("text", { class: "axis", x: x + bwid / 2, y: H - pad.b + 14, "text-anchor": "middle" }, shortDate(w.start)));
  });
  return svg;
}

function printProfile(name, r, sample) {
  const win = window.open("", "_blank");
  if (!win) return alert("Allow pop-ups for this site to open your profile.");
  const rows = (list) => list.map(([a, b]) => `<tr><td>${esc(a)}</td><td style="text-align:right">${esc(b)}</td></tr>`).join("");
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Wiji Pulse income profile</title>
<style>body{font-family:system-ui,Segoe UI,Arial,sans-serif;color:#15102B;max-width:720px;margin:32px auto;padding:0 16px}
h1{margin:0 0 4px}h2{margin:28px 0 8px;font-size:16px}table{width:100%;border-collapse:collapse}td{padding:6px 0;border-bottom:1px solid #E4DFF0}
.big{font-size:40px;font-weight:800;color:#6C2BD9}.muted{color:#5F5A75;font-size:13px}.flag{background:#FFF1D6;color:#A15C00;padding:8px 12px;border-radius:8px;font-weight:700}</style></head><body>
${sample ? '<p class="flag">SAMPLE DATA: this profile was made with sample payments to show how Wiji Pulse works.</p>' : ""}
<h1>Wiji Pulse income profile</h1><div class="muted">${esc(name)} · Verified Wiji business · Generated ${esc(new Date().toLocaleDateString("en-ZA"))}</div>
<h2>Funding-readiness score</h2><div class="big">${r.score}/100</div>
<table>${rows(r.scoreParts.map((p) => [p.label, `${p.points}/${p.max}`]))}</table>
<h2>Summary</h2><table>${rows([
    ["Track record", `${r.weeksOfHistory} weeks of payments through Wiji`],
    ["Average monthly income", rand(r.avgMonthlyCents)],
    ["Different customers", String(r.uniqueCustomers)],
    ["Growth trend", `${r.trendPctPerWeek >= 0 ? "+" : ""}${(r.trendPctPerWeek * 100).toFixed(1)}% a week`],
  ])}</table>
<h2>Weekly income, last 12 weeks</h2><table>${rows(r.history.map((w) => [`Week of ${shortDate(w.start)}`, rand(w.totalCents)]))}</table>
<h2>Forecast, next 4 weeks</h2><table>${rows(r.forecast.map((f) => [`Week of ${shortDate(f.start)}${f.slow ? " (slow week)" : ""}`, `${rand(f.expectedCents)} (${rand(f.lowCents)}–${rand(f.highCents)})`]))}</table>
<p class="muted" style="margin-top:24px">Based on card payments received through Wiji and processed by Paystack. Cash sales outside Wiji are not included.</p>
<script>window.onload=()=>window.print()</script></body></html>`);
  win.document.close();
}

/** On narrow screens the chart scrolls sideways; start at the right so the forecast is in view. */
function chartWrap(r) {
  const wrap = h("div", { class: "pulse-chart-wrap" }, forecastChart(r));
  requestAnimationFrame(() => (wrap.scrollLeft = wrap.scrollWidth));
  return wrap;
}

export function renderPulse(main) {
  let payments = null;
  let error = null;
  let sample = sessionStorage.getItem("pulse-sample") === "1";
  const body = h("div", {});
  main.append(
    h("div", { class: "page-head" },
      h("div", {}, h("h1", {}, "Wiji Pulse"), h("span", { class: "muted small" }, "Your income forecast and funding-readiness score, from payments you receive in Wiji."))),
    body);

  const load = async () => {
    payments = null;
    error = null;
    draw();
    try {
      const snap = await getDocs(query(collection(db, "payments"), where("payeeUid", "==", B.uid), where("status", "==", "paid")));
      payments = snap.docs.map((d) => {
        const p = d.data();
        const at = p.paidAt?.toDate?.() || p.createdAt?.toDate?.() || null;
        return { amountCents: Number(p.amountCents) || 0, at, payerUid: p.payerUid };
      }).filter((p) => p.at);
    } catch (e) {
      console.error(e);
      error = e.message || "Couldn't load your payments.";
      payments = [];
    }
    draw();
  };

  const setSample = (on) => {
    sample = on;
    sessionStorage.setItem("pulse-sample", on ? "1" : "0");
    draw();
  };

  const draw = () => {
    if (!B.uid || payments === null) return fill(body, h("div", { class: "boot", style: { minHeight: "40vh" } }, h("div", { class: "spinner" })));
    const real = computePulse(payments);
    const r = sample ? computePulse(samplePayments()) : real;
    const name = sample ? "Sample business" : B.info?.name || "My business";

    if (!r.enoughData) {
      return fill(body, h("div", { class: "panel", style: { maxWidth: "640px" } },
        h("h3", {}, "Your Pulse is warming up"),
        h("p", { class: "muted" }, error ? `Couldn't load your payments: ${error}` :
          `Pulse learns from the payments you receive in Wiji. After 4 weeks it forecasts your next month, warns you about slow weeks and scores how ready you are for funding. You have ${real.weeksOfHistory} week${real.weeksOfHistory === 1 ? "" : "s"} of payments so far.`),
        h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
          h("button", { class: "btn primary", onclick: () => setSample(true) }, "Preview with sample data"),
          error ? h("button", { class: "btn", onclick: load }, "Try again") : null)));
    }

    const nextFour = r.forecast.reduce((a, f) => a + f.expectedCents, 0);
    const slow = r.forecast.find((f) => f.slow);
    const scoreTone = r.score >= 80 ? "good" : r.score >= 60 ? "warn" : "bad";
    const scoreLabel = r.score >= 80 ? "Funding-ready" : r.score >= 60 ? "Nearly there" : "Building your record";
    const kpi = (label, value, sub) => h("div", { class: "panel kpi" }, h("div", { class: "label" }, label), h("div", { class: "value mono" }, value), sub ? h("div", { class: "sub" }, sub) : null);

    fill(body,
      sample ? h("div", { class: "banner warn" }, h("b", {}, "Sample data."), " This is what Pulse looks like with 12 weeks of payments. ",
        h("a", { href: "#", onclick: (e) => (e.preventDefault(), setSample(false)) }, "Show my real data →")) : null,
      slow ? h("div", { class: "banner warn" }, h("b", {}, `Slow week ahead: week of ${shortDate(slow.start)}.`),
        ` Expected about ${rand(slow.expectedCents)}, against a usual ${rand(r.baselineCents)}.`) : null,
      h("div", { class: "grid kpis" },
        kpi("Next 4 weeks", rand(nextFour), "expected income"),
        kpi("Usual week", rand(r.baselineCents), `${r.trendPctPerWeek >= 0 ? "▲" : "▼"} ${Math.abs(r.trendPctPerWeek * 100).toFixed(1)}% a week`),
        kpi("This week so far", rand(r.thisWeek.totalCents), `${r.thisWeek.count} payment${r.thisWeek.count === 1 ? "" : "s"}`),
        kpi("Funding-readiness", `${r.score}/100`, scoreLabel)),
      h("div", { class: "panel", style: { marginTop: "14px" } },
        h("div", { class: "alert-head" }, h("h3", {}, "Weekly income and forecast"), h("span", { class: "muted small" }, `${r.weeksOfHistory} weeks of history`)),
        chartWrap(r),
        h("p", { class: "small muted" }, "Solid bars: what you earned. Dashed bars: the forecast, with a line showing the likely range. Amber: a slow week. Hover a bar for the numbers.")),
      h("div", { class: "grid two", style: { marginTop: "14px" } },
        h("div", { class: "panel" },
          h("h3", {}, "What to do"),
          h("ul", { style: { paddingLeft: "18px", lineHeight: 1.6 } }, r.tips.map((t) => h("li", {}, t))),
          h("p", { class: "small muted" }, `Busiest day: ${DAY_NAMES[r.busiestDay]} · Quietest day: ${DAY_NAMES[r.quietestDay]}`)),
        h("div", { class: "panel" },
          h("div", { class: "alert-head" }, h("h3", {}, "Funding-readiness score"), chip(scoreLabel, scoreTone)),
          h("div", { class: "value mono", style: { fontSize: "40px", fontWeight: 800, margin: "4px 0 8px" } }, `${r.score}`, h("span", { class: "muted", style: { fontSize: "18px" } }, " /100")),
          h("div", { class: "barlist pulse-score" }, r.scoreParts.map((p) =>
            h("div", { class: "row", title: p.tip },
              h("span", {}, p.label),
              h("div", { class: "track" }, h("div", { class: "fill", style: { width: `${(p.points / p.max) * 100}%` } })),
              h("b", { class: "mono" }, `${p.points}/${p.max}`)))),
          h("div", { style: { display: "flex", gap: "8px", marginTop: "14px", flexWrap: "wrap" } },
            h("button", { class: "btn primary", onclick: () => printProfile(name, r, sample) }, "Print or save income profile (PDF)"),
            h("button", { class: "btn", onclick: () => navigator.clipboard?.writeText(profileText(name, sample ? "Sample" : "Verified Wiji business", r, sample)).then(() => alert("Profile copied.")) }, "Copy as text")),
          h("p", { class: "small muted" }, "A summary of your Wiji income to share with a bank or funder. Only you decide who sees it."))),
      h("details", { class: "panel", style: { marginTop: "14px" } },
        h("summary", { style: { cursor: "pointer", fontWeight: 700 } }, "How Pulse works"),
        h("p", { class: "muted" },
          `Pulse groups the payments you received in Wiji into weeks. It weights recent weeks more, measures your growth trend, and learns your month pattern: here payday weeks run about ${Math.round(Math.abs(r.paydayLift - 1) * 100)}% ${r.paydayLift >= 1 ? "higher" : "lower"} and mid-month weeks about ${Math.round(Math.abs(1 - r.midMonthLift) * 100)}% ${r.midMonthLift <= 1 ? "lower" : "higher"} than other weeks. The score combines steady income (35), growth (20), track record (20), income size (15) and number of customers (10). Cash sales outside Wiji aren't counted.`)));
  };

  load();
  return onBiz((what) => what === "info" && draw());
}
