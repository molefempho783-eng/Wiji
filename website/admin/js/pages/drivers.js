// Drivers: review applications (documents, checks, decision) and manage driver accounts.
import { call, db, collection, doc, query, where, limit, onSnapshot, fileUrl, userName } from "../firebase.js";
import { h, icon, chip, ago, fmtDate, later, askText, confirmBox, busy, lightbox, toMs } from "../ui.js";
import { state, subscribe } from "../store.js";
import { DRIVER_CHECKS, DRIVER_DOCS, EXPIRING, STATUS } from "../labels.js";

const statusChip = (s) => {
  const [label, tone] = STATUS[s] || [s || "—", ""];
  return chip(label, tone);
};

/* ---------- list ---------- */
const TABS = [
  ["waiting", "Waiting for review"],
  ["accounts", "Driver accounts"],
  ["expiring", "Expiring documents"],
  ["draft", "In progress"],
  ["declined", "Declined"],
];

export function renderDrivers(main) {
  let tab = sessionStorage.getItem("drivers-tab") || "waiting";
  const tabs = h("div", { class: "tabs", role: "tablist" });
  const body = h("div", {});
  main.append(h("div", { class: "page-head" }, h("h1", {}, "Drivers")), tabs, body);
  let unsub = null;

  const table = (head, rows, empty) =>
    h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, head.map((t) => h("th", {}, t)))),
      h("tbody", {}, rows.length ? rows : h("tr", {}, h("td", { colspan: head.length, class: "empty" }, empty)))));

  const appRows = (apps) =>
    apps.map((a) => {
      const passed = Object.keys(DRIVER_CHECKS).filter((c) => a.checks?.[c]?.result === "passed").length;
      return h("tr", { class: "click", onclick: () => (location.hash = `#/drivers/${a.id}`) },
        h("td", {}, h("b", {}, a.personal?.fullName || "—"), h("div", { class: "small muted" }, a.personal?.homeArea || "")),
        h("td", {}, [a.vehicle?.colour, a.vehicle?.make, a.vehicle?.model].filter(Boolean).join(" ") || "—", h("div", { class: "small muted mono" }, a.vehicle?.plate || "")),
        h("td", {}, a.submittedAt ? ago(a.submittedAt) : a.updatedAt ? `edited ${ago(a.updatedAt)}` : "—"),
        h("td", { class: "mono" }, `${passed}/${Object.keys(DRIVER_CHECKS).length}`),
        h("td", {}, a.decision?.outcome === "changes_requested" && a.status === "draft" ? chip("Changes requested", "warn") : statusChip(a.status),
          a.reverify ? [" ", chip("Re-verification", "warn")] : null));
    });

  const draw = () => {
    sessionStorage.setItem("drivers-tab", tab);
    tabs.replaceChildren(...TABS.map(([k, label]) =>
      h("button", { class: `tab ${tab === k ? "on" : ""}`, role: "tab", "aria-selected": String(tab === k), onclick: () => ((tab = k), load()) },
        label, k === "waiting" && state.driverApps.length ? ` (${state.driverApps.length})` : "")));
  };

  const load = () => {
    draw();
    if (typeof unsub === "function") unsub();
    unsub = null;
    const head = ["Applicant", "Car", "When", "Checks passed", "Status"];
    if (tab === "waiting") {
      const paint = () => body.replaceChildren(table(head, appRows(state.driverApps), "No applications waiting. New ones appear here live."));
      paint();
      unsub = subscribe(() => (draw(), paint()));
      return;
    }
    body.replaceChildren(h("p", { class: "muted" }, "Loading…"));
    if (tab === "accounts") {
      unsub = onSnapshot(query(collection(db, "drivers"), limit(500)), (s) => {
        const rows = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (toMs(b.verifiedAt) || 0) - (toMs(a.verifiedAt) || 0));
        body.replaceChildren(table(["Driver", "Car", "Verified", "Next re-check", "Status"], rows.map((d) =>
          h("tr", { class: "click", onclick: () => (location.hash = `#/drivers/${d.id}`) },
            h("td", {}, h("b", {}, d.firstName || "—")),
            h("td", {}, [d.vehicle?.colour, d.vehicle?.make].filter(Boolean).join(" "), h("div", { class: "small muted mono" }, d.vehicle?.plate || "")),
            h("td", {}, fmtDate(d.verifiedAt, false)),
            h("td", {}, d.nextCheckDue || "—"),
            h("td", {}, statusChip(d.status)))), "No verified drivers yet."));
      });
      return;
    }
    if (tab === "expiring") {
      // Every verified driver with a document (or the annual re-check) expired or due within 30 days
      unsub = onSnapshot(query(collection(db, "drivers"), limit(500)), (s) => {
        const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
        const rows = [];
        s.docs.forEach((d) => {
          const x = d.data();
          const all = { ...(x.docExpiries || {}), ...(x.nextCheckDue ? { annualRecheck: x.nextCheckDue } : {}) };
          Object.entries(all).forEach(([k, date]) => date <= soon && rows.push({ id: d.id, x, k, date }));
        });
        rows.sort((a, b) => (a.date < b.date ? -1 : 1));
        body.replaceChildren(table(["Driver", "Document", "Expiry", "Driver account"], rows.map((r) =>
          h("tr", { class: "click", onclick: () => (location.hash = `#/drivers/${r.id}`) },
            h("td", {}, h("b", {}, r.x.firstName || "—"), h("div", { class: "small muted mono" }, r.x.vehicle?.plate || "")),
            h("td", {}, r.k === "annualRecheck" ? "Annual re-check" : DRIVER_DOCS[r.k] || r.k),
            h("td", {}, expiryNote(r.date)),
            h("td", {}, statusChip(r.x.status)))), "Nothing expires in the next 30 days."));
      });
      return;
    }
    unsub = onSnapshot(query(collection(db, "driver_applications"), where("status", "==", tab), limit(300)), (s) => {
      const apps = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (toMs(b.updatedAt) || 0) - (toMs(a.updatedAt) || 0));
      body.replaceChildren(table(head, appRows(apps), tab === "draft" ? "Nobody is filling in an application right now." : "No declined applications."));
    }, (e) => body.replaceChildren(h("p", { class: "error" }, e.message)));
  };
  load();
  return () => typeof unsub === "function" && unsub();
}

/* ---------- one driver ---------- */
export function renderDriver(main, uid) {
  const body = h("div", {}, h("div", { class: "boot", style: { minHeight: "40vh" } }, h("div", { class: "spinner" })));
  main.append(h("a", { href: "#/drivers", class: "btn small", style: { marginBottom: "14px" } }, icon("back"), "All drivers"), body);
  let app = undefined;
  let driver = undefined;
  let log = [];
  const paint = () => {
    if (app === undefined || driver === undefined) return;
    body.replaceChildren(driverView(uid, app, driver, log));
  };
  const stops = [
    onSnapshot(doc(db, "driver_applications", uid), (s) => ((app = s.exists() ? s.data() : null), paint()), (e) => body.replaceChildren(h("p", { class: "error" }, e.message))),
    onSnapshot(doc(db, "drivers", uid), (s) => ((driver = s.exists() ? s.data() : null), paint()), () => ((driver = null), paint())),
    onSnapshot(query(collection(db, "driverReviewLog"), where("uid", "==", uid), limit(100)), (s) => {
      log = s.docs.map((d) => d.data()).sort((a, b) => (toMs(b.at) || 0) - (toMs(a.at) || 0));
      paint();
    }, () => undefined),
  ];
  return () => stops.forEach((s) => s());
}

export function docTile(label, d, extra) {
  const thumb = h("div", { class: "thumb" }, d?.path ? "Loading…" : "Not uploaded");
  if (d?.path) {
    fileUrl(d.path).then((url) => {
      if (d.contentType === "application/pdf" || d.path.endsWith(".pdf")) {
        thumb.replaceChildren(h("a", { href: url, target: "_blank", rel: "noopener", class: "btn small" }, icon("file"), "Open PDF"));
      } else {
        thumb.replaceChildren(h("img", { src: url, alt: label, loading: "lazy", onclick: () => lightbox(url) }));
      }
    }).catch(() => (thumb.textContent = "Can't open file"));
  }
  return h("div", { class: "doc" }, thumb, h("div", { class: "meta" }, h("b", {}, label), extra || (d?.uploadedAt ? h("span", { class: "muted" }, `Uploaded ${fmtDate(d.uploadedAt, false)}`) : null)));
}

function expiryNote(date) {
  if (!date) return h("span", { class: "muted" }, "No expiry date");
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  if (date < today) return chip(`Expired ${date}`, "bad");
  if (date <= soon) return chip(`Expires ${date}`, "warn");
  return chip(`Valid to ${date}`, "good");
}

function driverView(uid, app, driver, log) {
  const p = app?.personal || {};
  const v = app?.vehicle || {};
  const docs = app?.documents || {};
  const reviewable = app && ["submitted", "in_review"].includes(app.status);
  const allPassed = app && Object.keys(DRIVER_CHECKS).every((c) => app.checks?.[c]?.result === "passed");

  const setCheck = (check, result) => async (e) => {
    const btn = e.currentTarget; // capture before any await
    let note = "";
    if (result === "failed") {
      note = await askText({ title: `Fail: ${DRIVER_CHECKS[check]}`, message: "Say what's wrong. The applicant may be told this if their application is declined.", confirm: "Mark as failed", kind: "danger solid" });
      if (!note) return;
    }
    busy(btn, () => call("reviewDriverApplication", { uid, action: "setCheck", check, result, note }));
  };

  const decide = (action) => async (e) => {
    const btn = e.currentTarget;
    if (action === "approve") {
      if (!(await confirmBox("Approve this driver?", "They'll be able to go online and accept rides straight away. Their selfie becomes their public photo.", "Approve driver", "good"))) return;
      return busy(btn, () => call("reviewDriverApplication", { uid, action }), "Driver approved");
    }
    const reason = await askText({
      title: action === "decline" ? "Decline application" : "Ask for changes",
      message: action === "decline" ? "The applicant sees this reason." : "Tell the applicant exactly what to fix. They can edit and submit again.",
      confirm: action === "decline" ? "Decline" : "Send back",
      kind: action === "decline" ? "danger solid" : "primary",
    });
    if (reason) busy(btn, () => call("reviewDriverApplication", { uid, action, reason }), action === "decline" ? "Application declined" : "Sent back for changes");
  };

  const setStatus = (status) => async (e) => {
    const btn = e.currentTarget;
    const reason = await askText({
      title: status === "active" ? "Reinstate driver" : "Pause driver",
      message: status === "active" ? "Why is it safe for them to drive again? (e.g. investigation finished, report not upheld)" : "Why are you pausing this driver? They are taken offline immediately.",
      confirm: status === "active" ? "Reinstate" : "Pause driver",
      kind: status === "active" ? "good" : "danger solid",
    });
    if (reason) busy(btn, () => call("setDriverStatus", { uid, status, reason }), status === "active" ? "Driver reinstated" : "Driver paused");
  };

  return h("div", {},
    h("div", { class: "page-head" },
      h("div", {}, h("h1", {}, p.fullName || driver?.firstName || "Driver"),
        h("div", { class: "btn-row", style: { marginTop: "6px" } },
          app ? (app.decision?.outcome === "changes_requested" && app.status === "draft" ? chip("Changes requested", "warn") : statusChip(app.status)) : null,
          driver ? [chip("Driver account:"), statusChip(driver.status)] : null,
          app?.submittedAt ? h("span", { class: "small muted" }, `Submitted ${fmtDate(app.submittedAt)}`) : null))),

    driver
      ? h("div", { class: "panel", style: { marginBottom: "14px" } },
          h("div", { class: "alert-head" }, h("h2", {}, "Driver account"),
            h("div", { class: "btn-row" },
              driver.status === "active"
                ? h("button", { class: "btn danger", onclick: setStatus("suspended") }, "Pause driver")
                : h("button", { class: "btn good", onclick: setStatus("active") }, "Reinstate driver"))),
          h("dl", { class: "kv" },
            h("dt", {}, "Status"), h("dd", {}, statusChip(driver.status), " ", driver.suspendedReason || driver.pausedReason || ""),
            h("dt", {}, "Verified"), h("dd", {}, fmtDate(driver.verifiedAt)),
            h("dt", {}, "Next annual re-check"), h("dd", {}, driver.nextCheckDue || "—"),
            h("dt", {}, "Document expiries"), h("dd", { class: "btn-row" }, Object.entries(driver.docExpiries || {}).map(([k, d]) => h("span", {}, `${DRIVER_DOCS[k] || k}: `, expiryNote(d)))),
            driver.suspendedByReport ? [h("dt", {}, "Paused by report"), h("dd", {}, h("a", { href: "#/alerts" }, "See Alerts"))] : null))
      : null,

    !app
      ? h("div", { class: "panel empty" }, "No application found for this driver.")
      : h("div", {},
          h("div", { class: "grid two" },
            h("div", { class: "panel" }, h("h2", {}, "About the applicant"),
              h("dl", { class: "kv" },
                h("dt", {}, "Full name"), h("dd", {}, p.fullName || "—"),
                h("dt", {}, p.idType === "passport" ? "Passport" : "SA ID"), h("dd", { class: "mono" }, p.idNumber || "—"),
                h("dt", {}, "Mobile"), h("dd", {}, p.phone || "—"),
                h("dt", {}, "Drives in"), h("dd", {}, p.homeArea || "—"),
                h("dt", {}, "Wiji account"), h("dd", {}, later(userName(uid))),
                h("dt", {}, "Safety induction"), h("dd", {}, app.induction?.passed ? chip("Passed", "good") : chip("Not done", "warn")),
                h("dt", {}, "Consents"), h("dd", {}, app.consents?.backgroundCheck && app.consents?.dataUse && app.consents?.codeOfConduct ? chip("All given", "good") : chip("Missing", "warn")))),
            h("div", { class: "panel" }, h("h2", {}, "Car"),
              h("dl", { class: "kv" },
                h("dt", {}, "Car"), h("dd", {}, [v.colour, v.make, v.model].filter(Boolean).join(" ") || "—"),
                h("dt", {}, "Year"), h("dd", {}, v.year || "—"),
                h("dt", {}, "Number plate"), h("dd", { class: "mono" }, v.plate || "—")))),

          app.reverify
            ? h("div", { class: "banner", style: { marginBottom: "14px" } }, h("b", {}, "Re-verification: "),
                app.changedDocs?.length
                  ? `the driver changed ${app.changedDocs.map((k) => (k === "vehicle" ? "car details" : DRIVER_DOCS[k] || k)).join(", ")}. Checks marked "passed before" didn't depend on anything that changed.`
                  : "the driver is updating their documents and hasn't sent them yet. They stay verified meanwhile.",
                " Declining pauses their driver account; asking for changes doesn't.")
            : null,
          h("div", { class: "section-title" }, h("h2", {}, "Documents"), h("span", { class: "small muted" }, "Click a photo to enlarge")),
          h("div", { class: "docs" }, Object.entries(DRIVER_DOCS).map(([k, label]) =>
            docTile(label, docs[k], EXPIRING.includes(k) && docs[k]?.path
              ? h("span", {}, expiryNote(docs[k]?.expiry), app.changedDocs?.includes(k) ? [" ", chip("New", "warn")] : null)
              : app.changedDocs?.includes(k) ? chip("New", "warn") : null))),

          h("div", { class: "section-title" }, h("h2", {}, "Checks")),
          h("div", { class: "panel" },
            !reviewable ? h("p", { class: "small muted" }, "Checks can be changed while the application is waiting for review.") : null,
            Object.entries(DRIVER_CHECKS).map(([c, label]) => {
              const r = app.checks?.[c] || {};
              return h("div", { class: "check" },
                h("div", { class: "name" }, label, r.carriedOver && r.result === "passed" ? h("div", { class: "small muted" }, "Passed before. Nothing it depends on changed.") : null, r.note ? h("div", { class: "small muted" }, r.note) : null),
                statusChip(r.result || "pending"),
                reviewable
                  ? h("div", { class: "btn-row" },
                      h("button", { class: "btn small good", disabled: r.result === "passed", onclick: setCheck(c, "passed") }, "Pass"),
                      h("button", { class: "btn small danger", disabled: r.result === "failed", onclick: setCheck(c, "failed") }, "Fail"),
                      r.result && r.result !== "pending" ? h("button", { class: "btn small", onclick: setCheck(c, "pending") }, "Reset") : null)
                  : null);
            }),
            h("p", { class: "small muted", style: { marginTop: "10px" } },
              "Criminal record: check with SAPS/your vetting provider outside Wiji, then record the result here. Don't upload criminal records to Wiji.")),

          app.decision ? h("div", { class: "banner", style: { marginTop: "14px" } }, h("b", {}, "Last decision: "), `${app.decision.outcome?.replace(/_/g, " ")} · ${fmtDate(app.decision.at)}`, app.decision.reason ? ` — “${app.decision.reason}”` : "") : null,

          reviewable
            ? h("div", { class: "panel", style: { marginTop: "14px" } },
                h("h2", {}, "Decision"),
                h("p", { class: "muted small" }, allPassed ? "All checks passed." : "Approve becomes available when every check has passed."),
                h("div", { class: "btn-row" },
                  h("button", { class: "btn good", disabled: !allPassed, onclick: decide("approve") }, "Approve driver"),
                  h("button", { class: "btn", onclick: decide("requestChanges") }, "Ask for changes"),
                  h("button", { class: "btn danger", onclick: decide("decline") }, "Decline")))
            : null),

    h("div", { class: "section-title" }, h("h2", {}, "History")),
    log.length
      ? h("div", { class: "table-wrap" }, h("table", {}, h("tbody", {}, log.map((l) =>
          h("tr", {}, h("td", {}, fmtDate(l.at)), h("td", {}, String(l.action || "").replace(/([A-Z])/g, " $1").toLowerCase(),
            l.check ? ` · ${DRIVER_CHECKS[l.check] || l.check}: ${l.result}` : "", l.reason ? ` — ${l.reason}` : "", l.note ? ` — ${l.note}` : ""),
            h("td", {}, l.staffUid ? later(userName(l.staffUid)) : "System"))))))
      : h("p", { class: "muted" }, "Nothing yet."));
}
