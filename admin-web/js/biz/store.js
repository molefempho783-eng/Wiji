// Business portal: live data for the signed-in business (shop, orders, menu, deals, payout account).
import { db, doc, collection, query, where, limit, onSnapshot } from "../firebase.js";
import { toMs } from "../ui.js";
import { announce } from "../store.js";

export const B = { uid: null, info: null, payee: null, orders: [], menu: [], deals: [], loaded: false, error: null };
// Orders that count as sales (paid and not cancelled)
export const SALES = ["paid", "preparing", "ready", "out_for_delivery", "completed"];
export const ORDER_STATUS = {
  payment_pending: ["Waiting for payment", "warn"],
  paid: ["New order", "info"],
  preparing: ["Preparing", "info"],
  ready: ["Ready to collect", "good"],
  out_for_delivery: ["Out for delivery", "good"],
  completed: ["Completed", "good"],
  cancelled: ["Cancelled", "bad"],
};
export const shortId = (id) => String(id || "").slice(0, 6).toUpperCase();
/** R1 234,50 */
export const zar = (cents) =>
  cents === null || cents === undefined ? "—" : `R${(cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** "45,50" / "45.5" -> 4550 cents, or null if not between R1 and R20 000 */
export function parseRand(text, { min = 1, max = 20000 } = {}) {
  const n = Number(String(text).replace(/[\sR]/gi, "").replace(",", "."));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.round(n * 100);
}

const listeners = new Set();
/** fn(what) is called with "info" | "orders" | "menu" | "deals" | "payee" */
export const onBiz = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = (what) => {
  listeners.forEach((f) => {
    try { f(what); } catch (e) { console.error(e); }
  });
  const n = B.orders.filter((o) => o.status === "paid").length;
  document.title = `${n ? `(${n}) ` : ""}${B.info?.name || "Wiji Business"}`;
};

let stops = [];
export function startBiz(uid) {
  stopBiz();
  B.uid = uid;
  B.loaded = false;
  const seenPaid = new Set();
  let first = true;
  stops = [
    onSnapshot(doc(db, "businesses", uid), (s) => ((B.info = s.exists() ? s.data() : null), emit("info"))),
    onSnapshot(doc(db, "payees", uid), (s) => ((B.payee = s.exists() ? s.data() : null), emit("payee")), () => undefined),
    onSnapshot(query(collection(db, "orders"), where("ownerId", "==", uid), limit(3000)), (s) => {
      B.orders = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (toMs(b.createdAt) || 0) - (toMs(a.createdAt) || 0));
      for (const o of B.orders) {
        if (o.status !== "paid" || seenPaid.has(o.id)) continue;
        seenPaid.add(o.id);
        if (!first) {
          const n = (o.items || []).reduce((a, l) => a + (l.qty || 0), 0);
          announce("New order", `${o.buyerName || "A customer"}: ${n} item${n === 1 ? "" : "s"}, ${zar(o.totalCents)} (${o.fulfilment === "delivery" ? "delivery" : "collect"})`, "#/orders", true);
        }
      }
      first = false;
      B.loaded = true;
      B.error = null;
      emit("orders");
    }, (e) => ((B.error = e.message), (B.loaded = true), emit("orders"))),
    onSnapshot(collection(db, "businesses", uid, "menu"), (s) => {
      B.menu = s.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.category || "").localeCompare(String(b.category || "")) || String(a.name).localeCompare(String(b.name)));
      emit("menu");
    }, () => undefined),
    onSnapshot(query(collection(db, "mapSpecials"), where("createdBy", "==", uid)), (s) => {
      B.deals = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (toMs(b.createdAt) || 0) - (toMs(a.createdAt) || 0));
      emit("deals");
    }, () => undefined),
  ];
}
export function stopBiz() {
  stops.forEach((s) => s());
  stops = [];
  Object.assign(B, { uid: null, info: null, payee: null, orders: [], menu: [], deals: [], loaded: false, error: null });
}
