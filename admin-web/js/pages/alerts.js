// Alerts: everything that needs the Wiji team, live. Emergencies first.
import { call, db, doc, getDoc, userName } from "../firebase.js";
import { h, icon, chip, ago, fmtDate, later, askText, busy } from "../ui.js";
import { state, subscribe, notificationsOn, enableNotifications } from "../store.js";
import { INCIDENT_CATEGORIES, STATUS, BUSINESS_TYPES } from "../labels.js";

const statusChip = (s) => {
  const [label, tone] = STATUS[s] || [s, ""];
  return chip(label, tone);
};

/** Ride summary used by SOS and incident cards (fetched once per ride). */
const rideCache = new Map();
function rideInfo(rideId) {
  if (!rideId) return null;
  if (!rideCache.has(rideId)) rideCache.set(rideId, getDoc(doc(db, "rides", rideId)).then((s) => (s.exists() ? s.data() : null)).catch(() => null));
  const box = h("dl", { class: "kv" }, h("dt", {}, "Trip"), h("dd", {}, "Loading…"));
  rideCache.get(rideId).then((r) => {
    if (!r) return box.replaceChildren(h("dt", {}, "Trip"), h("dd", {}, "Not found"));
    const v = r.driver?.vehicle || {};
    box.replaceChildren(
      h("dt", {}, "Passenger"), h("dd", {}, r.riderFirstName || later(userName(r.riderUid))),
      h("dt", {}, "Driver"), h("dd", {}, r.driver ? h("a", { href: `#/drivers/${r.driverUid}` }, `${r.driver.firstName} · ${[v.colour, v.make].filter(Boolean).join(" ")} · ${v.plate || ""}`) : "Not matched"),
      h("dt", {}, "From"), h("dd", {}, r.pickup?.address || "—"),
      h("dt", {}, "To"), h("dd", {}, r.dropoff?.address || "—"),
      h("dt", {}, "Trip status"), h("dd", {}, String(r.status || "").replace(/_/g, " ")));
  });
  return box;
}

function sosCard(a) {
  const ack = h("button", { class: "btn small" }, "Acknowledge");
  ack.onclick = () => busy(ack, () => call("updateSafetyCase", { kind: "sos", id: a.id, status: "acknowledged" }), "Marked as acknowledged");
  const resolve = h("button", { class: "btn small good" }, "Resolve");
  resolve.onclick = async () => {
    const note = await askText({ title: "Resolve emergency", message: "What happened and what did the team do? This is kept in the case history.", label: "Notes", confirm: "Resolve" });
    if (note) busy(resolve, () => call("updateSafetyCase", { kind: "sos", id: a.id, status: "resolved", note }), "Emergency resolved");
  };
  const loc = a.location ? `https://maps.google.com/?q=${a.location.lat},${a.location.lng}` : null;
  return h("div", { class: "panel alert sev-sos" },
    h("div", { class: "alert-head" },
      h("div", {}, h("h3", {}, a.status === "open" ? h("span", { class: "pulse", style: { marginRight: "8px" } }) : null, "Emergency button pressed"),
        h("div", { class: "small muted" }, `${ago(a.createdAt)} · ${fmtDate(a.createdAt)}`)),
      statusChip(a.status)),
    h("dl", { class: "kv" },
      h("dt", {}, "Raised by"), h("dd", {}, later(userName(a.raisedBy)), ` (${a.role || "user"})`),
      h("dt", {}, "Location"), h("dd", {}, loc ? h("a", { href: loc, target: "_blank", rel: "noopener" }, icon("map"), " Open last known location") : "Not shared")),
    rideInfo(a.rideId),
    history(a.history),
    h("div", { class: "btn-row" }, a.status === "open" ? ack : null, resolve,
      h("a", { class: "btn small", href: "tel:10111" }, "Call SAPS 10111")));
}

function incidentCard(r) {
  const serious = r.severity <= 2;
  const act = (status, label, kind = "") => {
    const b = h("button", { class: `btn small ${kind}` }, label);
    b.onclick = async () => {
      let note = "";
      if (status !== "investigating") {
        note = await askText({ title: label, message: "Record what the team found and did. The reporter is never shown these notes.", label: "Notes", confirm: label });
        if (!note) return;
      }
      busy(b, () => call("updateSafetyCase", { kind: "incident", id: r.id, status, note }), "Report updated");
    };
    return b;
  };
  return h("div", { class: `panel alert ${serious ? "sev-high" : "sev-med"}` },
    h("div", { class: "alert-head" },
      h("div", {}, h("h3", {}, INCIDENT_CATEGORIES[r.category] || r.category),
        h("div", { class: "small muted" }, `${ago(r.createdAt)} · ${fmtDate(r.createdAt)}`)),
      h("div", { class: "btn-row" }, serious ? chip("Serious", "bad") : chip("Standard"), statusChip(r.status))),
    h("dl", { class: "kv" },
      h("dt", {}, "Reported by"), h("dd", {}, later(userName(r.reporterUid)), ` (${r.reporterRole || "user"})`),
      h("dt", {}, "About"), h("dd", {}, r.againstUid ? later(userName(r.againstUid)) : "—",
        r.reporterRole === "rider" && r.againstUid ? [" · ", h("a", { href: `#/drivers/${r.againstUid}` }, "driver account")] : null),
      h("dt", {}, "What happened"), h("dd", { style: { whiteSpace: "pre-wrap" } }, r.description || "—")),
    serious && r.reporterRole === "rider"
      ? h("p", { class: "small muted" }, "The driver was paused automatically while this is investigated. Reinstate them from their driver page if the report isn't upheld.")
      : null,
    rideInfo(r.rideId),
    history(r.history),
    h("div", { class: "btn-row" },
      r.status === "open" ? act("investigating", "Start investigating") : null,
      act("resolved", "Resolve", "good"),
      act("no_action", "Close, no action")));
}

function history(items) {
  if (!items?.length) return null;
  return h("details", { class: "small" }, h("summary", {}, `History (${items.length})`),
    h("ul", {}, items.map((x) => h("li", {}, `${fmtDate(x.at)} · ${STATUS[x.status]?.[0] || x.status}${x.note ? ` — ${x.note}` : ""}`))));
}

function queueRow(href, title, sub, when, status) {
  return h("a", { class: "panel alert sev-info", href, style: { display: "block", textDecoration: "none", color: "inherit" } },
    h("div", { class: "alert-head" }, h("div", {}, h("h3", {}, title), h("div", { class: "small muted" }, sub)),
      h("div", { class: "btn-row" }, h("span", { class: "small muted" }, ago(when)), statusChip(status))));
}

export function renderAlerts(main) {
  const notifyBtn = h("button", { class: "btn", onclick: () => enableNotifications() }, icon("bell"), "Turn on desktop alerts");
  const head = h("div", { class: "page-head" },
    h("div", {}, h("h1", {}, "Alerts"), h("div", { class: "muted small" }, "Live. New emergencies play a sound and show a desktop alert while this site is open.")),
    notifyBtn);
  const body = h("div", {});
  main.append(head, body);

  const section = (title, items, render, empty) =>
    h("div", {}, h("div", { class: "section-title" }, h("h2", {}, title, " ", h("span", { class: "muted" }, `(${items.length})`))),
      items.length ? h("div", { class: "stack" }, items.map(render)) : h("div", { class: "panel empty" }, empty));

  const draw = () => {
    notifyBtn.classList.toggle("hidden", notificationsOn());
    if (!state.ready) return body.replaceChildren(h("div", { class: "boot", style: { minHeight: "30vh" } }, h("div", { class: "spinner" })));
    const incidents = [...state.incidents].sort((a, b) => (a.severity || 3) - (b.severity || 3));
    body.replaceChildren(
      section("Emergencies", state.sos, sosCard, "No open emergencies."),
      section("Trip reports", incidents, incidentCard, "No open trip reports."),
      section("Drivers waiting for review", state.driverApps, (a) =>
        queueRow(`#/drivers/${a.id}`, a.personal?.fullName || "Driver", [a.personal?.homeArea, a.vehicle?.plate].filter(Boolean).join(" · "), a.submittedAt, a.status), "No driver applications waiting."),
      section("Businesses waiting for verification", state.businesses, (b) =>
        queueRow(`#/businesses/${b.id}`, b.details?.tradingName || "Business", [BUSINESS_TYPES[b.details?.type], b.details?.category].filter(Boolean).join(" · "), b.submittedAt, b.status), "No businesses waiting."),
      section("Driver accounts paused", state.driversOff, (d) =>
        queueRow(`#/drivers/${d.id}`, `${d.firstName || "Driver"} · ${d.vehicle?.plate || ""}`, d.suspendedReason || d.pausedReason || "", d.suspendedAt || d.pausedAt, d.status), "No paused drivers."),
      section("Bank accounts changed (30 days)", state.bankChanges, (p) =>
        queueRow(p.role === "merchant" ? `#/businesses/${p.id}` : `#/drivers/${p.id}`, p.businessName || "Payee",
          `${p.role === "merchant" ? "Business" : "Driver"} · now ${p.bankName || "bank"} ••• ${p.accountLast4 || ""}. Check this was really them.`, p.bankChangedAt, p.verification || (p.role === "driver" ? "active" : "")),
        "No recent bank account changes."));
  };
  draw();
  return subscribe(draw);
}
