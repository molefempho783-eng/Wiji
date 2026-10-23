// Customers: everyone who has bought from this business, with what they spent and their order history.
import { h, chip, fmtDate, ago, dialog, toMs, num } from "../ui.js";
import { B, SALES, ORDER_STATUS, onBiz, shortId, zar } from "./store.js";

function customers() {
  const map = new Map();
  for (const o of B.orders) {
    if (!o.userId) continue;
    const c = map.get(o.userId) || { uid: o.userId, name: o.buyerName || "Customer", orders: [], paid: 0, spent: 0, first: Infinity, last: 0, delivery: 0, cancelled: 0 };
    c.orders.push(o);
    const t = toMs(o.createdAt) || 0;
    if (SALES.includes(o.status)) {
      c.paid += 1;
      c.spent += o.totalCents || 0;
      c.first = Math.min(c.first, t);
      c.last = Math.max(c.last, t);
      if (o.fulfilment === "delivery") c.delivery += 1;
    }
    if (o.status === "cancelled") c.cancelled += 1;
    map.set(o.userId, c);
  }
  return [...map.values()].filter((c) => c.paid > 0);
}

export function renderCustomers(main) {
  let search = "";
  let sort = sessionStorage.getItem("biz-cust-sort") || "spent";
  const find = h("input", { class: "input", type: "search", placeholder: "Search customers", "aria-label": "Search customers", style: { maxWidth: "240px" },
    oninput: () => ((search = find.value.trim().toLowerCase()), draw()) });
  const sorter = h("select", { class: "input", style: { width: "auto" }, "aria-label": "Sort by",
    onchange: () => ((sort = sorter.value), sessionStorage.setItem("biz-cust-sort", sort), draw()) },
    [["spent", "Most spent"], ["orders", "Most orders"], ["last", "Most recent"], ["first", "Newest customers"]].map(([v, l]) => h("option", { value: v, selected: v === sort }, l)));
  const summary = h("div", { class: "grid kpis", style: { marginBottom: "14px" } });
  const body = h("div", {});
  main.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Customers"), h("span", { class: "muted small" }, "People who have paid for an order.")),
    h("div", { class: "btn-row" }, find, sorter)), summary, body);

  const draw = () => {
    if (!B.loaded) return body.replaceChildren(h("p", { class: "muted" }, "Loading…"));
    const all = customers();
    const month = Date.now() - 30 * 864e5;
    const kpi = (label, value, sub) => h("div", { class: "panel kpi" }, h("div", { class: "label" }, label), h("div", { class: "value mono" }, value), h("div", { class: "sub" }, sub));
    summary.replaceChildren(
      kpi("Customers", num(all.length), "all time"),
      kpi("New this month", num(all.filter((c) => c.first >= month).length), "first order in the last 30 days"),
      kpi("Regulars", num(all.filter((c) => c.paid >= 3).length), "3 or more orders"),
      kpi("Spend per customer", all.length ? zar(Math.round(all.reduce((a, c) => a + c.spent, 0) / all.length)) : "—", "on average"));
    let list = all.filter((c) => !search || c.name.toLowerCase().includes(search));
    const by = { spent: (a, b) => b.spent - a.spent, orders: (a, b) => b.paid - a.paid, last: (a, b) => b.last - a.last, first: (a, b) => b.first - a.first }[sort];
    list = list.sort(by);
    body.replaceChildren(h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Customer", "Orders", "Spent", "Last order", "Usually"].map((t) => h("th", {}, t)))),
      h("tbody", {}, list.length ? list.map((c) =>
        h("tr", { class: "click", tabindex: 0, onclick: () => showCustomer(c), onkeydown: (e) => e.key === "Enter" && showCustomer(c) },
          h("td", {}, h("b", {}, c.name), " ", c.paid >= 3 ? chip("Regular", "good") : null, c.first >= month ? chip("New", "info") : null),
          h("td", { class: "mono" }, num(c.paid)),
          h("td", { class: "mono" }, zar(c.spent)),
          h("td", {}, ago(c.last)),
          h("td", {}, c.delivery > c.paid / 2 ? "Delivery" : "Collect")))
        : h("tr", {}, h("td", { colspan: 5, class: "empty" }, all.length ? "No match." : "No customers yet. They'll appear here after their first paid order."))))));
  };
  draw();
  return onBiz((what) => what === "orders" && draw());
}

function showCustomer(c) {
  const fav = {};
  c.orders.filter((o) => SALES.includes(o.status)).forEach((o) => (o.items || []).forEach((l) => (fav[l.name] = (fav[l.name] || 0) + (l.qty || 0))));
  const top = Object.entries(fav).sort((a, b) => b[1] - a[1]).slice(0, 3);
  dialog({
    title: c.name,
    body: h("div", {},
      h("dl", { class: "kv" },
        h("dt", {}, "Paid orders"), h("dd", {}, num(c.paid), c.cancelled ? ` (${c.cancelled} cancelled)` : ""),
        h("dt", {}, "Spent"), h("dd", {}, zar(c.spent)),
        h("dt", {}, "Customer since"), h("dd", {}, fmtDate(c.first, false)),
        h("dt", {}, "Favourites"), h("dd", {}, top.length ? top.map(([n, q]) => `${n} (${q})`).join(", ") : "—")),
      h("div", { class: "table-wrap", style: { maxHeight: "40vh", overflow: "auto" } }, h("table", {}, h("tbody", {},
        c.orders.slice(0, 50).map((o) => {
          const [label, tone] = ORDER_STATUS[o.status] || [o.status, ""];
          return h("tr", {}, h("td", {}, fmtDate(o.createdAt)), h("td", { class: "mono" }, `#${shortId(o.id)}`), h("td", { class: "mono" }, zar(o.totalCents)), h("td", {}, chip(label, tone)));
        }))))),
  });
}
