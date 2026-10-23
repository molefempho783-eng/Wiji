// Overview: key numbers, 30-day trends, recent payments and rides.
import { call, db, collection, query, orderBy, limit, getDocs, userName } from "../firebase.js";
import { h, fill, icon, num, rand, barChart, barList, fmtDate, chip, later, busy } from "../ui.js";
import { INCIDENT_CATEGORIES, STATUS } from "../labels.js";

const kpi = (label, value, sub, href) =>
  h(href ? "a" : "div", { class: "panel kpi", href, style: href ? { textDecoration: "none", color: "inherit" } : undefined },
    h("div", { class: "label" }, label), h("div", { class: "value mono" }, value), sub ? h("div", { class: "sub" }, sub) : null);

const chartPanel = (title, total, chart) =>
  h("div", { class: "panel" }, h("div", { class: "alert-head" }, h("h3", {}, title), h("span", { class: "muted small" }, total)), chart);

export function renderOverview(main) {
  const body = h("div", {}, h("div", { class: "boot", style: { minHeight: "40vh" } }, h("div", { class: "spinner" })));
  const refresh = h("button", { class: "btn", onclick: () => busy(refresh, load) }, icon("refresh"), "Refresh");
  const stamp = h("span", { class: "muted small" });
  main.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Overview"), stamp), refresh), body);

  async function load() {
    let d;
    try {
      d = await call("adminDashboard");
    } catch (e) {
      body.replaceChildren(h("div", { class: "panel" }, h("h3", {}, "Couldn't load analytics"), h("p", { class: "muted" }, e.message,
        " — check that the latest functions are deployed (firebase deploy --only functions).")));
      return;
    }
    stamp.textContent = `Updated ${fmtDate(d.generatedAt)}`;
    const sum = (arr) => arr.reduce((a, b) => a + b.value, 0);

    fill(body,
      d.safety.sosOpen
        ? h("a", { class: "banner warn", href: "#/alerts", style: { textDecoration: "none" } }, h("span", { class: "pulse" }),
            h("b", {}, `${d.safety.sosOpen} open emergency alert${d.safety.sosOpen > 1 ? "s" : ""}`), "Open Alerts now →")
        : null,
      h("div", { class: "grid kpis" },
        kpi("Users", num(d.users.total), `+${num(d.users.new7)} this week · +${num(d.users.new30)} in 30 days`),
        kpi("Rides completed", num(d.rides.completed), `${num(d.rides.total)} requested · ${num(d.rides.active)} active now`),
        kpi("Drivers", num(d.drivers.active), `${num(d.drivers.online)} online · ${num(d.drivers.paused + d.drivers.suspended)} paused`, "#/drivers"),
        kpi("Driver applications", num(d.drivers.pendingApplications), "waiting for review", "#/drivers"),
        kpi("Payments (30 days)", rand(d.payments.volumeRand30), `${num(d.payments.paid30)} paid · ${num(d.payments.failed30)} failed`),
        kpi("Wiji fees (30 days)", rand(d.payments.feeRand30), `${d.payments.feePercent}% platform fee`),
        kpi("Businesses", num(d.businesses.verified), `verified · ${num(d.businesses.pending)} waiting · ${num(d.businesses.merchants)} with payouts`, "#/businesses"),
        kpi("Safety", num(d.safety.sosOpen + d.safety.incidentsOpen), `${num(d.safety.sosOpen)} SOS · ${num(d.safety.incidentsOpen)} report${d.safety.incidentsOpen === 1 ? "" : "s"} open`, "#/alerts"),
      ),
      h("div", { class: "section-title" }, h("h2", {}, "Last 30 days")),
      h("div", { class: "grid two" },
        chartPanel("New users per day", `${num(sum(d.series.signups))} total`, barChart(d.series.signups, { label: "New users per day" })),
        chartPanel("Rides requested per day", `${num(sum(d.series.rides))} requested · ${num(sum(d.series.ridesCompleted))} completed`, barChart(d.series.rides, { label: "Rides per day" })),
        chartPanel("Payments per day (Rand)", rand(sum(d.series.paymentsRand)), barChart(d.series.paymentsRand, { format: rand, label: "Payments per day" })),
        h("div", { class: "panel" }, h("h3", {}, "Trip reports by type"),
          barList(Object.entries(d.safety.incidentsByCategory30 || {}), INCIDENT_CATEGORIES),
          h("p", { class: "small muted", style: { marginTop: "10px" } },
            `Rides with no driver found: ${num(d.rides.noDrivers)} · cancelled: ${num(d.rides.cancelled)} · communities: ${num(d.communities)}`))),
      h("div", { class: "section-title" }, h("h2", {}, "Recent payments")),
      recentPayments(),
      h("div", { class: "section-title" }, h("h2", {}, "Recent rides")),
      recentRides(),
    );
  }
  load();
}

function table(head, rows, empty) {
  return h("div", { class: "table-wrap" },
    h("table", {}, h("thead", {}, h("tr", {}, head.map((t) => h("th", {}, t)))),
      h("tbody", {}, rows.length ? rows : h("tr", {}, h("td", { colspan: head.length, class: "empty" }, empty)))));
}

function recentPayments() {
  const wrap = h("div", {}, h("p", { class: "muted" }, "Loading…"));
  getDocs(query(collection(db, "payments"), orderBy("createdAt", "desc"), limit(15)))
    .then((s) => {
      const tone = { paid: "good", failed: "bad", abandoned: "", pending: "warn" };
      wrap.replaceChildren(table(["When", "From", "To", "Amount", "Status"], s.docs.map((x) => {
        const p = x.data();
        return h("tr", {},
          h("td", {}, fmtDate(p.createdAt)),
          h("td", {}, p.payerName || later(userName(p.payerUid))),
          h("td", {}, p.payeeName || "—", " ", chip(p.payeeRole === "driver" ? "driver" : "business")),
          h("td", { class: "mono" }, rand((p.amountCents || 0) / 100)),
          h("td", {}, chip(p.status || "pending", tone[p.status] ?? "")));
      }), "No payments yet."));
    })
    .catch((e) => wrap.replaceChildren(h("p", { class: "muted" }, `Couldn't load payments: ${e.code || e.message}. Deploy the latest firestore.rules.`)));
  return wrap;
}

function recentRides() {
  const wrap = h("div", {}, h("p", { class: "muted" }, "Loading…"));
  getDocs(query(collection(db, "rides"), orderBy("createdAt", "desc"), limit(15)))
    .then((s) => {
      wrap.replaceChildren(table(["When", "Passenger", "Driver", "From → To", "Fare", "Status"], s.docs.map((x) => {
        const r = x.data();
        const [label, tone] = STATUS[r.status] || [String(r.status || "").replace(/_/g, " "), r.status === "completed" ? "good" : r.status === "cancelled" || r.status === "no_drivers" ? "" : "info"];
        return h("tr", {},
          h("td", {}, fmtDate(r.createdAt)),
          h("td", {}, r.riderFirstName || later(userName(r.riderUid))),
          h("td", {}, r.driver ? `${r.driver.firstName} · ${r.driver.vehicle?.plate || ""}` : "—"),
          h("td", { class: "small" }, `${r.pickup?.address || "pickup"} → ${r.dropoff?.address || "destination"}`),
          h("td", { class: "mono" }, rand((r.fareCents || 0) / 100)),
          h("td", {}, chip(label, tone), r.sosActive ? chip("SOS", "bad") : null));
      }), "No rides yet."));
    })
    .catch((e) => wrap.replaceChildren(h("p", { class: "muted" }, `Couldn't load rides: ${e.code || e.message}`)));
  return wrap;
}
