// Business analytics: sales, orders, customers, best sellers and busy hours.
import { h, fill, chip, rand, num, barChart, barList, toMs } from "../ui.js";
import { B, SALES, onBiz, zar } from "./store.js";

const kpi = (label, value, sub, href) =>
  h(href ? "a" : "div", { class: "panel kpi", href, style: href ? { textDecoration: "none", color: "inherit" } : undefined },
    h("div", { class: "label" }, label), h("div", { class: "value mono" }, value), sub ? h("div", { class: "sub" }, sub) : null);
const dayKey = (ms) => new Date(ms).toLocaleDateString("en-CA"); // YYYY-MM-DD, local time

export function renderBizOverview(main) {
  let days = Number(sessionStorage.getItem("biz-days")) || 30;
  const picker = h("div", { class: "tabs", role: "tablist", style: { marginBottom: 0 } });
  const body = h("div", {});
  main.append(
    h("div", { class: "page-head" },
      h("div", {}, h("h1", {}, "Overview"), h("span", { class: "muted small" }, "Sales are what customers paid, before Paystack and Wiji fees.")),
      picker),
    body);

  const draw = () => {
    picker.replaceChildren(...[7, 30, 90].map((d) =>
      h("button", { class: `tab ${d === days ? "on" : ""}`, role: "tab", "aria-selected": String(d === days), onclick: () => ((days = d), sessionStorage.setItem("biz-days", String(d)), draw()) }, `${d} days`)));
    if (!B.loaded) return body.replaceChildren(h("div", { class: "boot", style: { minHeight: "40vh" } }, h("div", { class: "spinner" })));
    if (B.error) return body.replaceChildren(h("div", { class: "panel" }, h("h3", {}, "Couldn't load your orders"), h("p", { class: "muted" }, B.error)));

    const since = Date.now() - days * 864e5;
    const inRange = B.orders.filter((o) => (toMs(o.createdAt) || 0) >= since);
    const sold = inRange.filter((o) => SALES.includes(o.status));
    const sales = sold.reduce((a, o) => a + (o.totalCents || 0), 0);
    const cancelled = inRange.filter((o) => o.status === "cancelled");
    const allTime = {};
    B.orders.filter((o) => SALES.includes(o.status)).forEach((o) => (allTime[o.userId] = (allTime[o.userId] || 0) + 1));
    const customers = [...new Set(sold.map((o) => o.userId))];
    const repeat = customers.filter((u) => allTime[u] > 1).length;
    const waiting = B.orders.filter((o) => o.status === "paid").length;
    const active = B.orders.filter((o) => ["preparing", "ready", "out_for_delivery"].includes(o.status)).length;

    const series = [];
    const byDay = {};
    const byDayCount = {};
    sold.forEach((o) => {
      const k = dayKey(toMs(o.createdAt));
      byDay[k] = (byDay[k] || 0) + (o.totalCents || 0) / 100;
      byDayCount[k] = (byDayCount[k] || 0) + 1;
    });
    for (let i = days - 1; i >= 0; i--) {
      const k = dayKey(Date.now() - i * 864e5);
      series.push({ day: k, value: Math.round(byDay[k] || 0), count: byDayCount[k] || 0 });
    }
    const items = {};
    sold.forEach((o) => (o.items || []).forEach((l) => (items[l.name] = (items[l.name] || 0) + (l.qty || 0))));
    const hours = {};
    sold.forEach((o) => {
      const hr = new Date(toMs(o.createdAt)).getHours();
      const label = `${String(hr).padStart(2, "0")}:00`;
      hours[label] = (hours[label] || 0) + 1;
    });
    const delivery = sold.filter((o) => o.fulfilment === "delivery").length;

    fill(body,
      waiting ? h("a", { class: "banner warn", href: "#/orders", style: { textDecoration: "none" } }, h("span", { class: "pulse" }),
        h("b", {}, `${waiting} new order${waiting > 1 ? "s" : ""} waiting for you to accept`), "Open orders →") : null,
      B.info && B.info.isOpen === false ? h("a", { class: "banner", href: "#/settings", style: { textDecoration: "none" } }, h("b", {}, "Your shop is closed."), "Customers can't order until you open it in Shop settings →") : null,
      h("div", { class: "grid kpis" },
        kpi("Sales", zar(sales), `${num(sold.length)} paid order${sold.length === 1 ? "" : "s"}`),
        kpi("Average order", sold.length ? zar(Math.round(sales / sold.length)) : "—", "per paid order"),
        kpi("Customers", num(customers.length), customers.length ? `${num(repeat)} came back more than once` : "no orders yet", "#/customers"),
        kpi("Orders now", num(waiting + active), `${num(waiting)} new · ${num(active)} in progress`, "#/orders"),
        kpi("Collect / delivery", `${num(sold.length - delivery)} / ${num(delivery)}`, B.info?.deliveryEnabled ? "delivery is on" : "delivery is off", "#/settings"),
        kpi("Cancelled", num(cancelled.length), `${num(cancelled.filter((o) => o.cancelledBy === "business").length)} by you · ${num(cancelled.filter((o) => o.cancelledBy === "customer").length)} by customers`)),
      h("div", { class: "section-title" }, h("h2", {}, `Last ${days} days`)),
      h("div", { class: "grid two" },
        h("div", { class: "panel" }, h("div", { class: "alert-head" }, h("h3", {}, "Sales per day"), h("span", { class: "muted small" }, zar(sales))),
          barChart(series, { format: rand, label: "Sales per day" })),
        h("div", { class: "panel" }, h("div", { class: "alert-head" }, h("h3", {}, "Orders per day"), h("span", { class: "muted small" }, `${num(sold.length)} orders`)),
          barChart(series.map((d) => ({ day: d.day, value: d.count })), { label: "Orders per day" })),
        h("div", { class: "panel" }, h("h3", {}, "Best sellers"), h("p", { class: "small muted" }, "Items sold"),
          Object.keys(items).length ? barList(Object.entries(items).sort((a, b) => b[1] - a[1]).slice(0, 8)) : h("p", { class: "muted" }, "No sales yet.")),
        h("div", { class: "panel" }, h("h3", {}, "Busiest times"), h("p", { class: "small muted" }, "Orders by hour of the day"),
          Object.keys(hours).length ? barList(Object.entries(hours).sort((a, b) => b[1] - a[1]).slice(0, 8)) : h("p", { class: "muted" }, "No sales yet."))),
      h("p", { class: "small muted", style: { marginTop: "14px" } },
        "Paystack pays your sales into your bank account. ",
        B.payee ? `Account: ${B.payee.bankName || "Bank"} ••• ${B.payee.accountLast4 || ""}.` : chip("No payout account yet: add one in the Wiji app under Wallet → Set up payouts", "warn")));
  };
  draw();
  return onBiz((what) => ["orders", "info", "payee"].includes(what) && draw());
}
