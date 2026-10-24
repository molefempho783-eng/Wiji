// functions/src/paystack.ts
// Paystack payments for Wiji: drivers and merchants register a payout bank account
// (a Paystack subaccount); customers pay them by card through Paystack. Paystack splits
// each payment, settles the payee's share to their bank, and our commission to us.
// Wiji never holds anyone's money.
//
// Required env (functions/.env):
//   PAYSTACK_SECRET_KEY=sk_test_...      (test key while building; sk_live_... for launch)
//   PAYSTACK_PLATFORM_FEE_PERCENT=5      (Wiji's cut of each payment, default 5)
import { onCall, onRequest, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getMessaging } from "firebase-admin/messaging";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import axios, { AxiosError } from "axios";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { onOrderPaid, orderForPayment } from "./shop.js";
import { onGroupSubscriptionPaid } from "./groupSubscriptions.js";

const PAYSTACK = "https://api.paystack.co";
const CURRENCY = "ZAR";
const MIN_RAND = 5;
const MAX_RAND = 20000;

const fs = () => getFirestore(); // lazy: the admin app is initialised in index.ts

/** Push notification to one user (all their devices). */
export async function pushTo(uid: string, title: string, body: string, data: Record<string, string> = {}) {
  try {
    const u = await fs().collection("users").doc(uid).get();
    const tokens = (u.get("fcmTokens") || []).filter((t: unknown) => typeof t === "string" && t);
    if (!tokens.length) return;
    await getMessaging().sendEachForMulticast({ tokens, notification: { title, body }, data, android: { priority: "high", notification: { channelId: "default" } } });
  } catch (e: any) {
    logger.warn("push failed", e?.message);
  }
}
export const randText = (cents: number) => `R${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;

/** A completed ride the passenger is paying for: the fare and the driver come from the ride, never the app. */
async function rideForPayment(uid: string, rideId: string) {
  const snap = await fs().collection("rides").doc(rideId).get();
  const r = snap.data();
  if (!r || r.riderUid !== uid) throw new HttpsError("not-found", "Trip not found.");
  if (r.status !== "completed") throw new HttpsError("failed-precondition", "You can pay once the trip is complete.");
  if (r.paid === true) throw new HttpsError("already-exists", "This trip has already been paid.");
  if (!r.driverUid || !Number.isFinite(r.fareCents)) throw new HttpsError("failed-precondition", "This trip can't be paid in the app.");
  return { id: snap.id, driverUid: String(r.driverUid), fareCents: Math.round(Number(r.fareCents)), note: `Wiji ride with ${r.driver?.firstName || "your driver"}` };
}

function secret(): string {
  const key = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!key) {
    throw new HttpsError("failed-precondition", "Payments aren't set up yet (PAYSTACK_SECRET_KEY missing).");
  }
  return key;
}

function feePercent(): number {
  const n = Number(process.env.PAYSTACK_PLATFORM_FEE_PERCENT ?? "5");
  return Number.isFinite(n) ? Math.min(50, Math.max(0, n)) : 5;
}

export async function paystack<T = any>(method: "get" | "post" | "put", path: string, data?: any): Promise<T> {
  try {
    const res = await axios.request({
      method,
      url: `${PAYSTACK}${path}`,
      data,
      headers: { Authorization: `Bearer ${secret()}`, "Content-Type": "application/json" },
      timeout: 20000,
    });
    if (res.data?.status !== true) {
      throw new HttpsError("internal", res.data?.message || "Paystack request failed.");
    }
    return res.data.data as T;
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    const ax = e as AxiosError<any>;
    const msg = ax.response?.data?.message || ax.message || "Paystack request failed.";
    logger.error("Paystack error", { path, status: ax.response?.status, msg });
    throw new HttpsError("internal", msg);
  }
}

export function requireUser(req: CallableRequest<any>) {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");
  const email = (req.auth?.token?.email as string | undefined) || "";
  return { uid, email };
}

export function newReference() {
  return `wiji_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

function toCents(amountRand: unknown): number {
  const n = Number(amountRand);
  if (!Number.isFinite(n) || n < MIN_RAND || n > MAX_RAND) {
    throw new HttpsError("invalid-argument", `Amount must be between R${MIN_RAND} and R${MAX_RAND}.`);
  }
  return Math.round(n * 100);
}

export async function displayName(uid: string): Promise<string> {
  try {
    const u = (await fs().collection("users").doc(uid).get()).data();
    return (u?.username as string) || (u?.displayName as string) || "Wiji user";
  } catch {
    return "Wiji user";
  }
}

export async function getPayee(payeeUid: string) {
  const snap = await fs().collection("payees").doc(payeeUid).get();
  const payee = snap.data();
  if (!snap.exists || !payee?.subaccountCode || payee.active === false) {
    throw new HttpsError("not-found", "This person hasn't set up Wiji payments yet.");
  }
  // Businesses must be verified and drivers approved; ordinary users ("personal") can always be paid
  if (payee.role === "merchant" && payee.verified !== true) {
    throw new HttpsError(
      "failed-precondition",
      payee.verification === "suspended"
        ? "Payments to this business are paused by Wiji."
        : "This business hasn't been verified by Wiji yet, so it can't be paid in the app."
    );
  }
  if (payee.role === "driver") {
    const drv = (await fs().collection("drivers").doc(payeeUid).get()).data();
    if (!drv?.verified) throw new HttpsError("failed-precondition", "This person isn't a verified Wiji driver, so they can't be paid as a driver.");
  }
  return payee;
}

/** Save a reusable card from a successful Paystack transaction. Token stays server-side. Returns the card id. */
export async function saveCard(uid: string, email: string, auth: any): Promise<string | null> {
  if (!auth?.reusable || !auth?.authorization_code) return null;
  const cardId = (auth.signature || auth.authorization_code).replace(/[^A-Za-z0-9_-]/g, "");
  const db = fs();
  await db.collection("paymentMethods").doc(uid).collection("cards").doc(cardId).set(
    {
      brand: auth.card_type?.trim() || auth.brand || "card",
      last4: auth.last4 || "",
      expMonth: auth.exp_month || "",
      expYear: auth.exp_year || "",
      bank: auth.bank || "",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  // Never readable by the app (no Firestore rule allows it).
  await db.collection("paystackAuthorizations").doc(`${uid}_${cardId}`).set({
    uid,
    email,
    authorizationCode: auth.authorization_code,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return cardId;
}

/** Apply a verified Paystack transaction to our payment record (idempotent). */
export async function applyTransaction(tx: any): Promise<any> {
  const reference = tx?.reference;
  if (!reference) return null;
  const ref = fs().collection("payments").doc(reference);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const status = tx.status === "success" ? "paid" : tx.status === "failed" ? "failed" : tx.status === "abandoned" ? "abandoned" : "pending";
  const update: Record<string, any> = { status, updatedAt: FieldValue.serverTimestamp() };
  if (status === "paid" && snap.data()?.status !== "paid") {
    update.paidAt = FieldValue.serverTimestamp();
    update.channel = tx.channel || null;
    update.cardLast4 = tx.authorization?.last4 || null;
  }
  // Only trust Paystack's amount: flag mismatches instead of marking them paid.
  if (status === "paid" && Number(tx.amount) !== Number(snap.data()?.amountCents)) {
    update.status = "review";
    logger.warn("Amount mismatch", { reference, expected: snap.data()?.amountCents, got: tx.amount });
  }
  await ref.update(update);
  const firstPaid = update.status === "paid" && snap.data()?.status !== "paid";
  const p = snap.data() || {};
  // A paid order: tell the business (once)
  if (firstPaid && p.orderId) {
    await onOrderPaid(String(p.orderId), reference).catch((e) => logger.error("onOrderPaid failed", e?.message));
  }
  // A paid ride: mark the trip paid
  if (firstPaid && p.rideId) {
    await fs().collection("rides").doc(String(p.rideId)).update({ paid: true, paymentRef: reference, paidAt: FieldValue.serverTimestamp() })
      .catch((e) => logger.error("ride paid update failed", e?.message));
  }
  // A paid group subscription: give (or extend) access to the group; it notifies both sides
  if (firstPaid && p.groupSub) {
    await onGroupSubscriptionPaid(reference, p, tx).catch((e) => logger.error("onGroupSubscriptionPaid failed", e?.message));
  }
  // Tell whoever was paid (orders and group subscriptions send their own, more specific notifications)
  if (firstPaid && p.payeeUid && !p.orderId && !p.groupSub) {
    const who = String(p.payerName || "Someone");
    await pushTo(
      String(p.payeeUid),
      p.rideId ? `${who} paid ${randText(p.amountCents)} for the trip` : `You've been paid ${randText(p.amountCents)}`,
      p.rideId
        ? "The fare is paid. Paystack pays it into your bank account, less fees."
        : `${who} paid you${p.note ? ` for "${p.note}"` : ""}. It goes to your bank account.`,
      { type: p.rideId ? "ride_paid" : "payment", reference, ...(p.rideId ? { rideId: String(p.rideId) } : {}) }
    );
  }
  return { ...snap.data(), ...update, reference };
}

/** Refund a paid payment in full (used when an order is cancelled). */
export async function refundPayment(reference: string, reason: string) {
  const ref = fs().collection("payments").doc(reference);
  const pay = (await ref.get()).data();
  if (!pay || pay.status !== "paid") return { refunded: false };
  const r = await paystack<any>("post", "/refund", { transaction: reference, merchant_note: reason.slice(0, 200) });
  await ref.update({ status: "refunded", refund: { id: r?.id || null, status: r?.status || "pending", reason, at: FieldValue.serverTimestamp() } });
  return { refunded: true };
}

/* ------------------------------------------------------------------ */

/** South African banks for the payout form. */
export const paystackListBanks = onCall({}, async (req) => {
  requireUser(req);
  const banks = await paystack<any[]>("get", `/bank?country=south%20africa&currency=${CURRENCY}&perPage=100`);
  return banks
    .filter((b) => b.active !== false && !b.is_deleted)
    .map((b) => ({ name: b.name as string, code: b.code as string }))
    .sort((a, b) => a.name.localeCompare(b.name));
});

/** Driver or merchant registers (or updates) the bank account they get paid into. */
export const paystackRegisterPayee = onCall({}, async (req) => {
  const { uid, email } = requireUser(req);
  const { businessName, bankCode, bankName, accountNumber, accountHolder, accountType } = (req.data || {}) as Record<string, string>;
  const name = String(businessName || "").trim();
  if (name.length < 2 || name.length > 80) throw new HttpsError("invalid-argument", "Enter your name or business name.");
  const acct = String(accountNumber || "").replace(/\s+/g, "");
  if (!/^\d{6,16}$/.test(acct)) throw new HttpsError("invalid-argument", "Enter a valid account number (digits only).");
  if (!bankCode) throw new HttpsError("invalid-argument", "Choose your bank.");
  const holder = String(accountHolder || "").trim();
  if (holder.length < 3 || holder.length > 80) throw new HttpsError("invalid-argument", "Enter the account holder's name exactly as your bank has it.");
  const type = String(accountType || "");
  if (!["cheque", "savings", "transmission"].includes(type)) throw new HttpsError("invalid-argument", "Choose the account type.");

  const db = fs();
  // The role comes from Wiji's records, never from the app:
  //   approved driver -> "driver"; verified (or suspended) business -> "merchant"; everyone else -> "personal"
  const drv = (await db.collection("drivers").doc(uid).get()).data();
  const biz = (await db.collection("business_verifications").doc(uid).get()).data();
  const bizStatus = String(biz?.status || "");
  const role: "driver" | "merchant" | "personal" = drv?.verified
    ? "driver"
    : ["verified", "suspended"].includes(bizStatus)
    ? "merchant"
    : "personal";
  const existing = (await db.collection("payees").doc(uid).get()).data();
  const body = {
    business_name: name,
    bank_code: bankCode,
    account_number: acct,
    percentage_charge: feePercent(),
    primary_contact_email: email || undefined,
    description: `Wiji ${role} ${uid}`,
    metadata: { uid, role },
  };
  const sub = existing?.subaccountCode
    ? await paystack<any>("put", `/subaccount/${existing.subaccountCode}`, body)
    : await paystack<any>("post", "/subaccount", body);

  const payee = {
    uid,
    role,
    businessName: name,
    bankName: bankName || sub.settlement_bank || "",
    bankCode,
    accountHolder: holder,
    accountType: type,
    accountLast4: acct.slice(-4),
    subaccountCode: sub.subaccount_code || existing?.subaccountCode,
    feePercent: feePercent(),
    active: true,
    updatedAt: FieldValue.serverTimestamp(),
    ...(existing ? {} : { createdAt: FieldValue.serverTimestamp() }),
    // Businesses can only be paid while verified (suspension turns this off)
    ...(role === "merchant" ? { verified: bizStatus === "verified", verification: bizStatus } : {}),
    // Bank account changed after setup: flagged for the Wiji team (shown on the admin site)
    ...(existing?.accountLast4 && (existing.accountLast4 !== acct.slice(-4) || (existing.bankCode && existing.bankCode !== bankCode))
      ? { bankChangedAt: FieldValue.serverTimestamp() }
      : {}),
  };
  await db.collection("payees").doc(uid).set(payee, { merge: true });
  return { ok: true, role, businessName: name, bankName: payee.bankName, accountLast4: payee.accountLast4 };
});

/** Start a card payment to a driver/merchant. Returns Paystack's secure checkout URL. */
export const paystackStartPayment = onCall({}, async (req) => {
  const { uid, email } = requireUser(req);
  if (!email) throw new HttpsError("failed-precondition", "Your account needs an email address to pay.");
  const { orderId, rideId, callbackUrl, saveCard: wantsSave } = (req.data || {}) as Record<string, any>;
  // Orders are priced by the server: the amount and payee come from the order, never the app
  const order = orderId ? await orderForPayment(uid, String(orderId)) : null;
  const ride = !order && rideId ? await rideForPayment(uid, String(rideId)) : null;
  const payeeUid = order ? order.ownerId : ride ? ride.driverUid : req.data?.payeeUid;
  if (!payeeUid || payeeUid === uid) throw new HttpsError("invalid-argument", "Choose who you're paying.");
  const payee = await getPayee(payeeUid);
  const amountCents = order ? order.totalCents : ride ? ride.fareCents : toCents(req.data?.amount);
  const note = order ? order.paymentNote : ride ? ride.note : req.data?.note;
  const reference = newReference();

  await fs().collection("payments").doc(reference).set({
    reference,
    payerUid: uid,
    payerName: await displayName(uid),
    payeeUid,
    payeeName: payee.businessName,
    payeeRole: payee.role,
    amountCents,
    currency: CURRENCY,
    note: String(note || "").slice(0, 140),
    status: "pending",
    saveCard: wantsSave !== false,
    ...(order ? { orderId: order.id } : {}),
    ...(ride ? { rideId: ride.id } : {}),
    createdAt: FieldValue.serverTimestamp(),
  });
  if (order) await fs().collection("orders").doc(order.id).update({ paymentRef: reference });

  const tx = await paystack<any>("post", "/transaction/initialize", {
    email,
    amount: amountCents,
    currency: CURRENCY,
    reference,
    subaccount: payee.subaccountCode,
    channels: ["card"],
    ...(typeof callbackUrl === "string" && callbackUrl ? { callback_url: callbackUrl } : {}),
    metadata: { payerUid: uid, payeeUid, purpose: order ? "order" : payee.role === "driver" ? "ride" : payee.role, ...(order ? { orderId: order.id } : {}), ...(ride ? { rideId: ride.id } : {}) },
  });
  return { reference, authorizationUrl: tx.authorization_url };
});

/** Called by the app after checkout closes: verify with Paystack and record the result. */
export const paystackConfirmPayment = onCall({}, async (req) => {
  const { uid, email } = requireUser(req);
  const reference = String(req.data?.reference || "");
  const ref = fs().collection("payments").doc(reference);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.payerUid !== uid) throw new HttpsError("not-found", "Payment not found.");
  const tx = await paystack<any>("get", `/transaction/verify/${encodeURIComponent(reference)}`);
  const result = await applyTransaction(tx);
  if (tx.status === "success" && snap.data()?.saveCard) await saveCard(uid, email, tx.authorization);
  return { status: result?.status || "pending" };
});

/** Pay again with a saved card (no checkout page). */
export const paystackPayWithSavedCard = onCall({}, async (req) => {
  const { uid } = requireUser(req);
  const { cardId, orderId, rideId } = (req.data || {}) as Record<string, any>;
  const order = orderId ? await orderForPayment(uid, String(orderId)) : null;
  const ride = !order && rideId ? await rideForPayment(uid, String(rideId)) : null;
  const payeeUid = order ? order.ownerId : ride ? ride.driverUid : req.data?.payeeUid;
  const note = order ? order.paymentNote : ride ? ride.note : req.data?.note;
  if (!payeeUid || payeeUid === uid) throw new HttpsError("invalid-argument", "Choose who you're paying.");
  const tokenSnap = await fs().collection("paystackAuthorizations").doc(`${uid}_${cardId}`).get();
  const token = tokenSnap.data();
  if (!token?.authorizationCode) throw new HttpsError("not-found", "That card isn't saved any more.");
  const payee = await getPayee(payeeUid);
  const amountCents = order ? order.totalCents : ride ? ride.fareCents : toCents(req.data?.amount);
  const reference = newReference();

  await fs().collection("payments").doc(reference).set({
    reference,
    payerUid: uid,
    payerName: await displayName(uid),
    payeeUid,
    payeeName: payee.businessName,
    payeeRole: payee.role,
    amountCents,
    currency: CURRENCY,
    note: String(note || "").slice(0, 140),
    status: "pending",
    savedCard: true,
    ...(order ? { orderId: order.id } : {}),
    ...(ride ? { rideId: ride.id } : {}),
    createdAt: FieldValue.serverTimestamp(),
  });
  if (order) await fs().collection("orders").doc(order.id).update({ paymentRef: reference });

  const tx = await paystack<any>("post", "/transaction/charge_authorization", {
    authorization_code: token.authorizationCode,
    email: token.email,
    amount: amountCents,
    currency: CURRENCY,
    reference,
    subaccount: payee.subaccountCode,
    metadata: { payerUid: uid, payeeUid, purpose: order ? "order" : payee.role === "driver" ? "ride" : payee.role, ...(order ? { orderId: order.id } : {}), ...(ride ? { rideId: ride.id } : {}) },
  });
  const result = await applyTransaction(tx);
  return { reference, status: result?.status || "pending" };
});

/** Forget a saved card. */
export const paystackRemoveCard = onCall({}, async (req) => {
  const { uid } = requireUser(req);
  const cardId = String(req.data?.cardId || "");
  if (!cardId) throw new HttpsError("invalid-argument", "cardId required");
  const db = fs();
  await db.collection("paymentMethods").doc(uid).collection("cards").doc(cardId).delete();
  await db.collection("paystackAuthorizations").doc(`${uid}_${cardId}`).delete();
  return { ok: true };
});

/**
 * Paystack webhook: set this URL in Paystack Dashboard → Settings → API Keys & Webhooks.
 * It confirms payments even if the customer closes the app before we verify.
 */
export const paystackWebhook = onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }
  try {
    const signature = String(req.headers["x-paystack-signature"] || "");
    const expected = createHmac("sha512", secret()).update(req.rawBody).digest("hex");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(401).send("Bad signature");
      return;
    }
    const event = req.body;
    if (event?.event === "charge.success" && event.data?.reference) {
      // Re-verify with Paystack rather than trusting the payload alone.
      const tx = await paystack<any>("get", `/transaction/verify/${encodeURIComponent(event.data.reference)}`);
      await applyTransaction(tx);
    }
    res.status(200).send("ok");
  } catch (e: any) {
    logger.error("paystackWebhook failed", e?.message);
    res.status(200).send("ok"); // acknowledge so Paystack doesn't retry forever; we log the error
  }
});
