// Businesses: verify who runs a business before customers can pay it in Wiji.
import { call, db, collection, doc, query, where, limit, onSnapshot, userName } from "../firebase.js";
import { h, icon, chip, ago, fmtDate, later, askText, confirmBox, busy, toMs } from "../ui.js";
import { state, subscribe } from "../store.js";
import { BUSINESS_DOCS, BUSINESS_TYPES, STATUS } from "../labels.js";
import { docTile } from "./drivers.js";

const statusChip = (s) => {
  const [label, tone] = STATUS[s] || [s || "—", ""];
  return chip(label, tone);
};

const TABS = [
  ["waiting", "Waiting for review"],
  ["verified", "Verified"],
  ["suspended", "Suspended"],
  ["draft", "In progress"],
  ["declined", "Declined"],
];

export function renderBusinesses(main) {
  let tab = sessionStorage.getItem("biz-tab") || "waiting";
  const tabs = h("div", { class: "tabs", role: "tablist" });
  const body = h("div", {});
  main.append(h("div", { class: "page-head" }, h("h1", {}, "Businesses"),
    h("span", { class: "muted small" }, "Customers can only pay a business in Wiji once it's verified here.")), tabs, body);
  let unsub = null;

  const table = (rows, empty) =>
    h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Business", "Type", "Owner", "When", "Status"].map((t) => h("th", {}, t)))),
      h("tbody", {}, rows.length ? rows.map((b) =>
        h("tr", { class: "click", onclick: () => (location.hash = `#/businesses/${b.id}`) },
          h("td", {}, h("b", {}, b.details?.tradingName || "—"), h("div", { class: "small muted" }, b.details?.category || "")),
          h("td", {}, BUSINESS_TYPES[b.details?.type] || "—"),
          h("td", {}, b.details?.ownerName || "—"),
          h("td", {}, ago(b.submittedAt || b.updatedAt)),
          h("td", {}, b.decision?.outcome === "changes_requested" && b.status === "draft" ? chip("Changes requested", "warn") : statusChip(b.status))))
        : h("tr", {}, h("td", { colspan: 5, class: "empty" }, empty)))));

  const draw = () => {
    sessionStorage.setItem("biz-tab", tab);
    tabs.replaceChildren(...TABS.map(([k, label]) =>
      h("button", { class: `tab ${tab === k ? "on" : ""}`, role: "tab", "aria-selected": String(tab === k), onclick: () => ((tab = k), load()) },
        label, k === "waiting" && state.businesses.length ? ` (${state.businesses.length})` : "")));
  };
  const load = () => {
    draw();
    if (typeof unsub === "function") unsub();
    if (tab === "waiting") {
      const paint = () => body.replaceChildren(table(state.businesses, "No businesses waiting. New ones appear here live."));
      paint();
      unsub = subscribe(() => (draw(), paint()));
      return;
    }
    body.replaceChildren(h("p", { class: "muted" }, "Loading…"));
    unsub = onSnapshot(query(collection(db, "business_verifications"), where("status", "==", tab), limit(300)), (s) => {
      const rows = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (toMs(b.updatedAt) || 0) - (toMs(a.updatedAt) || 0));
      body.replaceChildren(table(rows, "Nothing here yet."));
    }, (e) => body.replaceChildren(h("p", { class: "error" }, e.message)));
  };
  load();
  return () => typeof unsub === "function" && unsub();
}

export function renderBusiness(main, uid) {
  const body = h("div", {}, h("div", { class: "boot", style: { minHeight: "40vh" } }, h("div", { class: "spinner" })));
  main.append(h("a", { href: "#/businesses", class: "btn small", style: { marginBottom: "14px" } }, icon("back"), "All businesses"), body);
  let app, payee;
  let log = [];
  const paint = () => app !== undefined && payee !== undefined && body.replaceChildren(view(uid, app, payee, log));
  const stops = [
    onSnapshot(doc(db, "business_verifications", uid), (s) => ((app = s.exists() ? s.data() : null), paint()), (e) => body.replaceChildren(h("p", { class: "error" }, e.message))),
    onSnapshot(doc(db, "payees", uid), (s) => ((payee = s.exists() ? s.data() : null), paint()), () => ((payee = null), paint())),
    onSnapshot(query(collection(db, "businessReviewLog"), where("uid", "==", uid), limit(100)), (s) => {
      log = s.docs.map((d) => d.data()).sort((a, b) => (toMs(b.at) || 0) - (toMs(a.at) || 0));
      paint();
    }, () => undefined),
  ];
  return () => stops.forEach((s) => s());
}

function view(uid, app, payee, log) {
  const d = app?.details || {};
  const docs = app?.documents || {};
  const waiting = app && ["submitted", "in_review"].includes(app.status);

  const act = (action) => async (e) => {
    const btn = e.currentTarget;
    if (action === "approve") {
      if (!(await confirmBox("Verify this business?", "Customers will be able to pay it in Wiji immediately. Only verify if the owner's ID, address and business details all match.", "Verify business", "good"))) return;
      return busy(btn, () => call("reviewBusinessVerification", { uid, action }), "Business verified");
    }
    if (action === "startReview") return busy(btn, () => call("reviewBusinessVerification", { uid, action }), "Marked as in review");
    const titles = {
      decline: ["Decline business", "The owner sees this reason.", "Decline", "danger solid"],
      requestChanges: ["Ask for changes", "Tell the owner exactly what to fix. They can edit and send again.", "Send back", "primary"],
      suspend: ["Suspend business", "Payments to this business stop immediately. The owner sees this reason.", "Suspend", "danger solid"],
      reinstate: ["Reinstate business", "Why is it safe to allow payments again?", "Reinstate", "good"],
    }[action];
    const reason = await askText({ title: titles[0], message: titles[1], confirm: titles[2], kind: titles[3] });
    if (reason) busy(btn, () => call("reviewBusinessVerification", { uid, action, reason }), "Done");
  };

  if (!app) return h("div", { class: "panel empty" }, "This business hasn't started verification.");

  return h("div", {},
    h("div", { class: "page-head" },
      h("div", {}, h("h1", {}, d.tradingName || "Business"),
        h("div", { class: "btn-row", style: { marginTop: "6px" } },
          app.decision?.outcome === "changes_requested" && app.status === "draft" ? chip("Changes requested", "warn") : statusChip(app.status),
          app.submittedAt ? h("span", { class: "small muted" }, `Submitted ${fmtDate(app.submittedAt)}`) : null))),
    h("div", { class: "grid two" },
      h("div", { class: "panel" }, h("h2", {}, "Business"),
        h("dl", { class: "kv" },
          h("dt", {}, "Name"), h("dd", {}, d.tradingName || "—"),
          h("dt", {}, "Type"), h("dd", {}, BUSINESS_TYPES[d.type] || "—"),
          d.cipcNumber ? [h("dt", {}, "CIPC number"), h("dd", { class: "mono" }, d.cipcNumber, " ",
            h("a", { href: "https://eservices.cipc.co.za/", target: "_blank", rel: "noopener", class: "small" }, "Check on CIPC"))] : null,
          h("dt", {}, "Sells"), h("dd", {}, d.category || "—"),
          h("dt", {}, "Address"), h("dd", {}, d.address || "—", d.address ? [" ", h("a", { href: `https://maps.google.com/?q=${encodeURIComponent(d.address)}`, target: "_blank", rel: "noopener", class: "small" }, "Map")] : null))),
      h("div", { class: "panel" }, h("h2", {}, "Owner and payouts"),
        h("dl", { class: "kv" },
          h("dt", {}, "Owner"), h("dd", {}, d.ownerName || "—"),
          h("dt", {}, "Contact"), h("dd", {}, d.phone || "—"),
          h("dt", {}, "Wiji account"), h("dd", {}, later(userName(uid))),
          h("dt", {}, "Pays out to"), h("dd", {}, payee ? `${payee.bankName || "Bank"} ••• ${payee.accountLast4 || ""}` : chip("No payout account", "warn")),
          h("dt", {}, "Name on payouts"), h("dd", {}, payee?.businessName || "—"),
          h("dt", {}, "Account holder"), h("dd", {}, payee?.accountHolder || "—", payee?.accountType ? ` (${payee.accountType})` : ""),
          payee?.bankChangedAt ? [h("dt", {}, "Bank changed"), h("dd", {}, chip(`${ago(payee.bankChangedAt)}`, "warn"))] : null))),
    h("div", { class: "section-title" }, h("h2", {}, "Documents"), h("span", { class: "small muted" }, "Check the owner's ID name matches the owner name, and the address matches")),
    h("div", { class: "docs" }, Object.entries(BUSINESS_DOCS).map(([k, label]) => (k === "registration" && !docs[k] ? null : docTile(label, docs[k])))),
    app.decision ? h("div", { class: "banner", style: { marginTop: "14px" } }, h("b", {}, "Last decision: "), `${app.decision.outcome?.replace(/_/g, " ")} · ${fmtDate(app.decision.at)}`, app.decision.reason ? ` — “${app.decision.reason}”` : "") : null,
    h("div", { class: "panel", style: { marginTop: "14px" } }, h("h2", {}, "Decision"),
      h("div", { class: "btn-row", style: { marginTop: "10px" } },
        app.status === "submitted" ? h("button", { class: "btn", onclick: act("startReview") }, "Start review") : null,
        waiting ? h("button", { class: "btn good", onclick: act("approve") }, "Verify business") : null,
        waiting ? h("button", { class: "btn", onclick: act("requestChanges") }, "Ask for changes") : null,
        waiting ? h("button", { class: "btn danger", onclick: act("decline") }, "Decline") : null,
        app.status === "verified" ? h("button", { class: "btn danger", onclick: act("suspend") }, "Suspend payments") : null,
        app.status === "suspended" ? h("button", { class: "btn good", onclick: act("reinstate") }, "Reinstate") : null,
        app.status === "draft" ? h("span", { class: "muted" }, "The owner is still filling this in.") : null,
        app.status === "declined" ? h("span", { class: "muted" }, "Declined. The owner can contact support to appeal.") : null)),
    h("div", { class: "section-title" }, h("h2", {}, "History")),
    log.length
      ? h("div", { class: "table-wrap" }, h("table", {}, h("tbody", {}, log.map((l) =>
          h("tr", {}, h("td", {}, fmtDate(l.at)), h("td", {}, String(l.action || "").replace(/([A-Z])/g, " $1").toLowerCase(), l.reason ? ` — ${l.reason}` : ""),
            h("td", {}, l.staffUid ? later(userName(l.staffUid)) : "Owner"))))))
      : h("p", { class: "muted" }, "Nothing yet."));
}
