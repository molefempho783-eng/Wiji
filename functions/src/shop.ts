// functions/src/shop.ts
// Buying from verified businesses on the map. The app only says WHAT the customer wants;
// the server looks up the prices, creates the order and only marks it paid once Paystack
// confirms the payment. Businesses then move it along: paid -> preparing -> ready (collect)
// or out_for_delivery (delivery) -> completed. Cancelling a paid order refunds the customer.
import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { refundPayment } from "./paystack.js";

const fs = () => getFirestore();
const MIN_CENTS = 500; // R5 (Paystack minimum we allow)
const MAX_CENTS = 2_000_000; // R20,000

function requireUser(req: CallableRequest<any>) {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");
  return uid;
}

async function push(uid: string, title: string, body: string, data: Record<string, string>) {
  try {
    const u = await fs().collection("users").doc(uid).get();
    const tokens: string[] = (u.get("fcmTokens") || []).filter((t: unknown) => typeof t === "string" && t);
    if (tokens.length) {
      await getMessaging().sendEachForMulticast({
        tokens,
        notification: { title, body },
        data,
        android: { priority: "high", notification: { channelId: "default" } },
      });
    }
  } catch (e: any) {
    logger.warn("shop push failed", e?.message);
  }
}

async function displayName(uid: string) {
  const u = (await fs().collection("users").doc(uid).get()).data();
  return String(u?.username || u?.displayName || "Customer");
}

const rand = (cents: number) => `R${(cents / 100).toFixed(2)}`;
const shortId = (id: string) => id.slice(0, 6).toUpperCase();

/* ---------- 1) Customer places an order (unpaid until Paystack confirms) ---------- */
export const createOrder = onCall({}, async (req) => {
  const uid = requireUser(req);
  const { businessId, items, fulfilment, deliveryAddress, deliveryLocation, note } = (req.data || {}) as any;
  const db = fs();
  const biz = (await db.collection("businesses").doc(String(businessId || "")).get()).data();
  if (!biz || biz.active !== true) throw new HttpsError("not-found", "This business isn't available right now.");
  if (biz.ownerId === uid) throw new HttpsError("failed-precondition", "You can't order from your own business.");
  if (biz.isOpen === false) throw new HttpsError("failed-precondition", `${biz.name} is closed at the moment.`);
  const how = fulfilment === "delivery" ? "delivery" : "collect";
  if (how === "delivery" && biz.deliveryEnabled !== true) throw new HttpsError("failed-precondition", "This business doesn't deliver.");
  if (how === "collect" && biz.collectEnabled === false) throw new HttpsError("failed-precondition", "This business only delivers.");
  if (how === "delivery" && String(deliveryAddress || "").trim().length < 5) throw new HttpsError("invalid-argument", "Add your delivery address.");
  if (!Array.isArray(items) || !items.length || items.length > 30) throw new HttpsError("invalid-argument", "Your basket is empty.");

  // Look up every price on the server
  const lines: any[] = [];
  for (const it of items) {
    const qty = Math.floor(Number(it?.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 20) throw new HttpsError("invalid-argument", "Choose between 1 and 20 of each item.");
    if (it?.kind === "deal") {
      const d = (await db.collection("mapSpecials").doc(String(it.id || "")).get()).data();
      if (!d || d.businessId !== businessId || d.active === false || !Number.isInteger(d.priceCents) || d.priceCents <= 0) {
        throw new HttpsError("failed-precondition", "A deal in your basket isn't available any more.");
      }
      lines.push({ kind: "deal", id: String(it.id), name: String(d.title || "Deal"), priceCents: d.priceCents, qty, lineCents: d.priceCents * qty });
    } else {
      const m = (await db.collection("businesses").doc(businessId).collection("menu").doc(String(it?.id || "")).get()).data();
      if (!m || m.available === false || !Number.isInteger(m.priceCents) || m.priceCents <= 0) {
        throw new HttpsError("failed-precondition", "An item in your basket isn't available any more.");
      }
      lines.push({ kind: "menu", id: String(it.id), name: String(m.name || "Item"), priceCents: m.priceCents, qty, lineCents: m.priceCents * qty });
    }
  }
  const subtotalCents = lines.reduce((n, l) => n + l.lineCents, 0);
  const deliveryFeeCents = how === "delivery" ? Math.max(0, Math.floor(Number(biz.deliveryFeeCents) || 0)) : 0;
  const totalCents = subtotalCents + deliveryFeeCents;
  if (totalCents < MIN_CENTS) throw new HttpsError("failed-precondition", "The minimum order is R5.");
  if (totalCents > MAX_CENTS) throw new HttpsError("failed-precondition", "Orders can be at most R20,000.");

  const payee = (await db.collection("payees").doc(biz.ownerId).get()).data();
  if (!payee?.subaccountCode || payee.role !== "merchant" || payee.verified !== true) {
    throw new HttpsError("failed-precondition", "This business can't take payments in Wiji right now.");
  }

  const loc = deliveryLocation && Number.isFinite(deliveryLocation.lat) && Number.isFinite(deliveryLocation.lng)
    ? { lat: Number(deliveryLocation.lat), lng: Number(deliveryLocation.lng) }
    : null;
  const ref = await db.collection("orders").add({
    businessId,
    ownerId: biz.ownerId,
    businessName: biz.name || "Business",
    userId: uid,
    buyerName: await displayName(uid),
    items: lines,
    subtotalCents,
    deliveryFeeCents,
    totalCents,
    total: totalCents / 100, // kept for older screens
    fulfilment: how,
    deliveryAddress: how === "delivery" ? String(deliveryAddress).trim().slice(0, 300) : null,
    deliveryLocation: how === "delivery" ? loc : null,
    note: String(note || "").trim().slice(0, 300),
    status: "payment_pending",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { orderId: ref.id, totalCents };
});

/** Used by the payment functions: the order this customer is paying for. */
export async function orderForPayment(uid: string, orderId: string) {
  const snap = await fs().collection("orders").doc(orderId).get();
  const o = snap.data();
  if (!o || o.userId !== uid) throw new HttpsError("not-found", "Order not found.");
  if (o.status !== "payment_pending") throw new HttpsError("failed-precondition", "This order has already been paid or cancelled.");
  return {
    id: snap.id,
    ownerId: String(o.ownerId),
    totalCents: Number(o.totalCents),
    paymentNote: `Order #${shortId(snap.id)} · ${o.businessName}`,
  };
}

/** Called once a payment for an order is confirmed by Paystack. */
export async function onOrderPaid(orderId: string, reference: string) {
  const ref = fs().collection("orders").doc(orderId);
  const o = await fs().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const d = s.data();
    if (!d || d.status !== "payment_pending") return null;
    tx.update(ref, { status: "paid", paymentRef: reference, paidAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return d;
  });
  if (!o) return;
  const count = (o.items || []).reduce((n: number, l: any) => n + (l.qty || 0), 0);
  await push(
    o.ownerId,
    `New order · ${rand(o.totalCents)}`,
    `${o.buyerName} ordered ${count} item${count === 1 ? "" : "s"} for ${o.fulfilment === "delivery" ? "delivery" : "collection"}. Tap to accept.`,
    { type: "shop_order", orderId }
  );
}

/* ---------- 2) Moving an order along (business), or cancelling (business or customer) ---------- */
const NEXT: Record<string, string[]> = {
  paid: ["preparing"],
  preparing: ["ready", "out_for_delivery"],
  ready: ["completed"],
  out_for_delivery: ["completed"],
};
const BUYER_TEXT: Record<string, (o: any) => [string, string]> = {
  preparing: (o) => [`${o.businessName} is preparing your order`, "We'll let you know when it's ready."],
  ready: (o) => [`Your order is ready to collect`, `Collect it at ${o.businessName}. Show order #${shortId(o.id)}.`],
  out_for_delivery: (o) => [`Your order is on its way`, `${o.businessName} is delivering your order.`],
  completed: (o) => [`Order complete`, `Thanks for buying from ${o.businessName}!`],
};

export const updateOrderStatus = onCall({}, async (req) => {
  const uid = requireUser(req);
  const { orderId, status, reason } = (req.data || {}) as Record<string, string>;
  const ref = fs().collection("orders").doc(String(orderId || ""));
  const snap = await ref.get();
  const o = snap.data();
  if (!o) throw new HttpsError("not-found", "Order not found.");
  const isOwner = o.ownerId === uid;
  const isBuyer = o.userId === uid;
  if (!isOwner && !isBuyer) throw new HttpsError("permission-denied", "This isn't your order.");

  if (status === "cancelled") {
    const why = String(reason || "").trim();
    if (isOwner && why.length < 5) throw new HttpsError("invalid-argument", "Tell the customer why you're cancelling.");
    const canCancel = isOwner ? ["payment_pending", "paid", "preparing"].includes(o.status) : ["payment_pending", "paid"].includes(o.status);
    if (!canCancel) {
      throw new HttpsError("failed-precondition", isBuyer ? "The business has already started your order. Contact them to cancel." : "This order can't be cancelled now.");
    }
    let refunded = false;
    if (o.status !== "payment_pending" && o.paymentRef) {
      try {
        refunded = (await refundPayment(o.paymentRef, `Order ${shortId(snap.id)} cancelled`)).refunded;
      } catch (e: any) {
        logger.error("refund failed", { orderId, msg: e?.message });
        throw new HttpsError("internal", "Couldn't refund the payment. Please try again or contact Wiji support.");
      }
    }
    await ref.update({
      status: "cancelled",
      cancelledBy: isOwner ? "business" : "customer",
      cancelReason: why.slice(0, 300) || null,
      refunded,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const other = isOwner ? o.userId : o.ownerId;
    await push(
      other,
      isOwner ? `${o.businessName} cancelled your order` : "An order was cancelled",
      isOwner ? `${why}${refunded ? ` Your ${rand(o.totalCents)} is being refunded to your card.` : ""}` : `${o.buyerName} cancelled order #${shortId(snap.id)}.`,
      { type: isOwner ? "order" : "shop_order", orderId: snap.id }
    );
    return { ok: true, refunded };
  }

  if (!isOwner) throw new HttpsError("permission-denied", "Only the business can update the order.");
  if (!(NEXT[o.status] || []).includes(status)) throw new HttpsError("failed-precondition", "That step doesn't fit this order.");
  if (status === "ready" && o.fulfilment === "delivery") throw new HttpsError("failed-precondition", "This order is for delivery: use Out for delivery.");
  if (status === "out_for_delivery" && o.fulfilment !== "delivery") throw new HttpsError("failed-precondition", "This order is for collection: use Ready.");
  await ref.update({ status, [`${status}At`]: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  const text = BUYER_TEXT[status]?.({ ...o, id: snap.id });
  if (text) await push(o.userId, text[0], text[1], { type: "order", orderId: snap.id });
  return { ok: true };
});
