// Orders: accept, mark ready / out for delivery, complete, or cancel (the customer is refunded).
import { call } from "../firebase.js";
import { h, chip, fmtDate, ago, askText, busy, toMs } from "../ui.js";
import { B, ORDER_STATUS, onBiz, shortId, zar } from "./store.js";

const TABS = [
  ["new", "New", (o) => o.status === "paid"],
  ["active", "In progress", (o) => ["preparing", "ready", "out_for_delivery"].includes(o.status)],
  ["done", "Completed", (o) => o.status === "completed"],
  ["cancelled", "Cancelled", (o) => o.status === "cancelled"],
  ["unpaid", "Not paid yet", (o) => o.status === "payment_pending"],
];

export function renderOrders(main) {
  let tab = sessionStorage.getItem("biz-orders-tab") || "new";
  let search = "";
  const tabs = h("div", { class: "tabs", role: "tablist" });
  const find = h("input", { class: "input", type: "search", placeholder: "Search by order number or customer", "aria-label": "Search orders", style: { maxWidth: "320px" },
    oninput: () => ((search = find.value.trim().toLowerCase()), draw()) });
  const body = h("div", { class: "orders" });
  main.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Orders"), h("span", { class: "muted small" }, "New orders appear here live, with a sound.")), find), tabs, body);

  const draw = () => {
    sessionStorage.setItem("biz-orders-tab", tab);
    tabs.replaceChildren(...TABS.map(([k, label, test]) => {
      const n = B.orders.filter(test).length;
      return h("button", { class: `tab ${tab === k ? "on" : ""}`, role: "tab", "aria-selected": String(tab === k), onclick: () => ((tab = k), draw()) },
        label, ["new", "active"].includes(k) && n ? ` (${n})` : "");
    }));
    if (!B.loaded) return body.replaceChildren(h("p", { class: "muted" }, "Loading…"));
    if (B.error) return body.replaceChildren(h("p", { class: "error" }, B.error));
    const test = TABS.find((t) => t[0] === tab)[2];
    let list = B.orders.filter(test);
    if (tab === "active" || tab === "new") list = [...list].sort((a, b) => (toMs(a.createdAt) || 0) - (toMs(b.createdAt) || 0)); // oldest first
    if (search) list = list.filter((o) => shortId(o.id).toLowerCase().includes(search) || String(o.buyerName || "").toLowerCase().includes(search));
    body.replaceChildren(...(list.length ? list.slice(0, 200).map(orderCard)
      : [h("div", { class: "panel empty" }, tab === "new" ? "No new orders right now. Keep this page open and you'll hear a sound when one comes in." : "Nothing here.")]));
  };
  draw();
  return onBiz((what) => what === "orders" && draw());
}

export function orderCard(o) {
  const [label, tone] = ORDER_STATUS[o.status] || [o.status, ""];
  const delivery = o.fulfilment === "delivery";
  const move = (status, text, kind = "primary") => {
    const btn = h("button", { class: `btn ${kind}` }, text);
    btn.onclick = () => busy(btn, () => call("updateOrderStatus", { orderId: o.id, status }), "Customer notified");
    return btn;
  };
  const cancel = () => {
    const btn = h("button", { class: "btn danger" }, "Cancel order");
    btn.onclick = async () => {
      const reason = await askText({
        title: `Cancel order #${shortId(o.id)}?`,
        message: o.status === "payment_pending" ? "The customer hasn't paid yet." : `${o.buyerName || "The customer"} is refunded ${zar(o.totalCents)} to their card. They'll see your reason.`,
        label: "Reason for the customer",
        placeholder: "e.g. Sorry, we've run out of this today",
        min: 5,
        confirm: "Cancel order",
        kind: "danger solid",
      });
      if (reason) busy(btn, () => call("updateOrderStatus", { orderId: o.id, status: "cancelled", reason }), "Order cancelled");
    };
    return btn;
  };
  const actions = {
    paid: [move("preparing", "Accept and start preparing", "good"), cancel()],
    preparing: [delivery ? move("out_for_delivery", "Out for delivery") : move("ready", "Ready to collect"), cancel()],
    ready: [move("completed", "Collected: complete", "good")],
    out_for_delivery: [move("completed", "Delivered: complete", "good")],
  }[o.status];
  const loc = o.deliveryLocation;

  return h("div", { class: `panel order st-${o.status}` },
    h("div", { class: "alert-head" },
      h("div", {},
        h("h3", {}, `#${shortId(o.id)} · ${o.buyerName || "Customer"}`),
        h("div", { class: "small muted" }, `${fmtDate(o.createdAt)} · ${ago(o.createdAt)}`)),
      h("div", { class: "btn-row" }, chip(delivery ? "Delivery" : "Collect", delivery ? "info" : ""), chip(label, tone))),
    h("ul", { class: "lines" },
      (o.items || []).map((l) => h("li", {}, h("span", {}, h("b", {}, `${l.qty} × `), l.name, l.kind === "deal" ? " " : "", l.kind === "deal" ? chip("Deal", "info") : null), h("span", { class: "mono" }, zar(l.lineCents))))),
    h("div", { class: "totals" },
      o.deliveryFeeCents ? h("div", {}, h("span", {}, "Delivery fee"), h("span", { class: "mono" }, zar(o.deliveryFeeCents))) : null,
      h("div", { class: "total" }, h("span", {}, "Total"), h("span", { class: "mono" }, zar(o.totalCents)))),
    delivery && o.deliveryAddress ? h("p", { class: "small" }, h("b", {}, "Deliver to: "), o.deliveryAddress, " ",
      loc ? h("a", { href: `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`, target: "_blank", rel: "noopener" }, "Open map") : null) : null,
    o.note ? h("p", { class: "small note" }, h("b", {}, "Customer note: "), o.note) : null,
    o.status === "cancelled" ? h("p", { class: "small muted" }, `Cancelled by ${o.cancelledBy === "business" ? "you" : "the customer"}`, o.cancelReason ? `: “${o.cancelReason}”` : "", o.refunded ? " · refunded" : "") : null,
    o.status === "payment_pending" ? h("p", { class: "small muted" }, "The customer started checkout but hasn't paid. Don't prepare this yet.") : null,
    actions ? h("div", { class: "btn-row", style: { marginTop: "12px" } }, actions) : null);
}
