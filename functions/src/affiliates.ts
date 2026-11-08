// functions/src/affiliates.ts
// Wiji affiliate programme (phase 1). Promoters apply in the app (Profile → Promoter) or on the website
// portal, and get a code once the Wiji team approves them. People enter the code when they sign up in the app. After that, the promoter
// earns a share of Wiji's own fee on payments those people make or receive:
//   - payments a referred person makes, for AFFILIATE_PAYER_WINDOW_DAYS after their first payment
//   - payments a referred driver, business or paid-group creator receives, for AFFILIATE_PAYEE_WINDOW_DAYS
//     after the first one
// Nothing is earned for a sign-up alone, and nothing comes out of the driver's or business's money:
// the commission is a share of what Wiji keeps after Paystack's fee.
//
// Optional env (functions/.env):
//   AFFILIATE_RATE_PERCENT=20          promoter's share of Wiji's net fee (default 20)
//   AFFILIATE_HOLD_DAYS=30             days before a commission can be paid out, so refunds are caught (default 30)
//   AFFILIATE_PAYER_WINDOW_DAYS=90     (default 90)
//   AFFILIATE_PAYEE_WINDOW_DAYS=180    (default 180)
//   AFFILIATE_DAILY_SIGNUP_CAP=25      sign-ups a code can collect per day until the team marks it trusted (default 25)
//   AFFILIATE_CLAIM_DAYS=7             how long after creating an account someone can still enter a code (default 7)
//
// Collections (only Cloud Functions write them):
//   affiliates/{uid}           the application and status: pending | approved | declined | frozen
//   affiliateCodes/{CODE}      { uid } keeps codes unique (never readable by the app or website)
//   referrals/{referredUid}    who referred this person and when their reward windows started
//   affiliateLedger/{ref_side} one row per commission: pending | flagged | held | reversed | paid
//   affiliatePayouts/{id}      payouts the team recorded (paid by hand in phase 1)
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { requireStaff } from "./staff.js";
import { requireUser, pushTo, randText } from "./paystack.js";

const fs = () => getFirestore();
const DAY = 864e5;

function envNum(name: string, def: number, min: number, max: number) {
  const n = Number(process.env[name] ?? def);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
const RATE = () => envNum("AFFILIATE_RATE_PERCENT", 20, 0, 100);
const HOLD_DAYS = () => envNum("AFFILIATE_HOLD_DAYS", 30, 0, 365);
const PAYER_DAYS = () => envNum("AFFILIATE_PAYER_WINDOW_DAYS", 90, 1, 3650);
const PAYEE_DAYS = () => envNum("AFFILIATE_PAYEE_WINDOW_DAYS", 180, 1, 3650);
const DAILY_CAP = () => envNum("AFFILIATE_DAILY_SIGNUP_CAP", 25, 1, 100000);
const CLAIM_DAYS = () => envNum("AFFILIATE_CLAIM_DAYS", 7, 0, 365);
const PLATFORM_FEE = () => envNum("PAYSTACK_PLATFORM_FEE_PERCENT", 5, 0, 50);

const CODE_RE = /^[A-Z0-9]{4,15}$/;
const RESERVED = new Set(["WIJI", "WIJIAPP", "ADMIN", "SUPPORT", "HELP", "TEAM", "OFFICIAL", "TEST", "PROMO", "FREE"]);
export const normCode = (v: unknown) => String(v || "").trim().toUpperCase().replace(/\s+/g, "");
const saDay = (ms: number) => new Date(ms + 2 * 3600e3).toISOString().slice(0, 10);
const toMs = (v: any): number | null => (v?.toMillis ? v.toMillis() : typeof v === "number" ? v : null);
const clean = (v: unknown, max: number) => String(v || "").trim().replace(/\s+/g, " ").slice(0, max);

/* ------------------------------------------------------------------ */
/* Applying and checking codes                                         */
/* ------------------------------------------------------------------ */

/** A signed-in Wiji user applies to be a promoter and picks their code. */
export const affiliateApply = onCall({}, async (req) => {
  const { uid, email } = requireUser(req);
  const d = (req.data || {}) as Record<string, unknown>;
  const name = clean(d.name, 60);
  const code = normCode(d.code);
  const channels = clean(d.channels, 300);
  const audience = clean(d.audience, 600);
  if (name.length < 2) throw new HttpsError("invalid-argument", "Enter your name or the name you post as.");
  if (!CODE_RE.test(code)) throw new HttpsError("invalid-argument", "Your code must be 4 to 15 letters or numbers, with no spaces.");
  if (RESERVED.has(code)) throw new HttpsError("invalid-argument", "That code is reserved. Try another one.");
  if (channels.length < 3) throw new HttpsError("invalid-argument", "Tell us where you'll promote Wiji (for example @yourname on TikTok).");
  if (d.acceptTerms !== true) throw new HttpsError("invalid-argument", "Please accept the promoter terms.");

  const db = fs();
  const affRef = db.collection("affiliates").doc(uid);
  const codeRef = db.collection("affiliateCodes").doc(code);
  await db.runTransaction(async (t) => {
    const [aff, taken] = await Promise.all([t.get(affRef), t.get(codeRef)]);
    const status = aff.get("status");
    if (status === "approved" || status === "frozen") throw new HttpsError("already-exists", "You're already a Wiji promoter.");
    if (taken.exists && taken.get("uid") !== uid) throw new HttpsError("already-exists", "That code is taken. Try another one.");
    const oldCode = aff.get("code");
    if (oldCode && oldCode !== code) t.delete(db.collection("affiliateCodes").doc(oldCode));
    t.set(codeRef, { uid, createdAt: FieldValue.serverTimestamp() });
    t.set(affRef, {
      uid,
      email: email || null,
      name,
      code,
      channels,
      audience,
      status: "pending",
      termsAcceptedAt: FieldValue.serverTimestamp(),
      appliedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      decision: FieldValue.delete(),
      ...(aff.exists ? {} : { trusted: false, stats: { clicks: 0, signups: 0 } }),
    }, { merge: true });
  });
  return { ok: true, status: "pending", code };
});

async function approvedAffiliate(code: string) {
  if (!CODE_RE.test(code)) return null;
  const c = await fs().collection("affiliateCodes").doc(code).get();
  const uid = c.get("uid");
  if (!uid) return null;
  const a = await fs().collection("affiliates").doc(uid).get();
  if (a.get("status") !== "approved" || a.get("code") !== code) return null;
  return { uid: String(uid), name: String(a.get("name") || "a Wiji promoter") };
}

/** Is this a working promoter code? (The sign-up screen checks before creating the account.) Open to anyone. */
export const affiliateCheckCode = onCall({}, async (req) => {
  const aff = await approvedAffiliate(normCode(req.data?.code));
  return aff ? { valid: true, name: aff.name } : { valid: false };
});

/** Someone opened a promoter's link (wiji site /r/CODE). Counts the visit. Open to anyone. */
export const affiliateTrackClick = onCall({}, async (req) => {
  const code = normCode(req.data?.code);
  const aff = await approvedAffiliate(code);
  if (!aff) return { valid: false };
  await fs().collection("affiliates").doc(aff.uid).update({ "stats.clicks": FieldValue.increment(1) }).catch(() => undefined);
  return { valid: true, name: aff.name, code };
});

/** A new user enters a promoter's code (at sign-up, or within AFFILIATE_CLAIM_DAYS of it). */
export const affiliateClaimReferral = onCall({}, async (req) => {
  const { uid } = requireUser(req);
  const code = normCode(req.data?.code);
  const aff = await approvedAffiliate(code);
  if (!aff) throw new HttpsError("not-found", "That promoter code doesn't exist or isn't active.");
  if (aff.uid === uid) throw new HttpsError("invalid-argument", "You can't use your own promoter code.");

  const created = Date.parse((await getAuth().getUser(uid)).metadata.creationTime || "");
  if (!Number.isFinite(created) || Date.now() - created > CLAIM_DAYS() * DAY) {
    throw new HttpsError("failed-precondition", `Promoter codes can only be added in your first ${CLAIM_DAYS()} days on Wiji.`);
  }

  const db = fs();
  const refRef = db.collection("referrals").doc(uid);
  const affRef = db.collection("affiliates").doc(aff.uid);
  const user = (await db.collection("users").doc(uid).get()).data() || {};
  const today = saDay(Date.now());
  await db.runTransaction(async (t) => {
    const [existing, a] = await Promise.all([t.get(refRef), t.get(affRef)]);
    if (existing.exists) throw new HttpsError("already-exists", "You've already used a promoter code.");
    const stats = a.get("stats") || {};
    const todayCount = stats.day === today ? Number(stats.daySignups || 0) : 0;
    if (a.get("trusted") !== true && todayCount >= DAILY_CAP()) {
      logger.warn("affiliate daily cap reached", { affiliate: aff.uid, code });
      throw new HttpsError("resource-exhausted", "This code can't take more sign-ups today. Try again tomorrow.");
    }
    t.set(refRef, {
      referredUid: uid,
      referredName: String(user.username || "Wiji user").slice(0, 40),
      affiliateUid: aff.uid,
      code,
      createdAt: FieldValue.serverTimestamp(),
      accountCreatedAt: Timestamp.fromMillis(created),
    });
    t.update(affRef, {
      "stats.signups": FieldValue.increment(1),
      "stats.day": today,
      "stats.daySignups": todayCount + 1,
    });
  });
  return { ok: true, name: aff.name };
});

/* ------------------------------------------------------------------ */
/* Earning commission (called from paystack.ts when a payment is paid) */
/* ------------------------------------------------------------------ */

type Side = "payer" | "payee";

/**
 * Record commissions for a payment that has just been paid (idempotent: one ledger row per payment and side).
 * Never throws into the payment flow.
 */
export async function creditAffiliatesForPayment(reference: string, payment: any, tx: any) {
  const amountCents = Math.round(Number(payment?.amountCents) || 0);
  if (!reference || amountCents <= 0) return;
  const sides: [Side, string | undefined][] = [["payer", payment.payerUid], ["payee", payment.payeeUid]];
  for (const [side, uid] of sides) {
    if (!uid) continue;
    try {
      await creditOne(reference, payment, tx, side, String(uid), amountCents);
    } catch (e: any) {
      logger.error("affiliate credit failed", { reference, side, msg: e?.message });
    }
  }
}

async function creditOne(reference: string, payment: any, tx: any, side: Side, referredUid: string, amountCents: number) {
  const db = fs();
  const referralRef = db.collection("referrals").doc(referredUid);
  const referral = (await referralRef.get()).data();
  if (!referral?.affiliateUid) return;
  const affiliateUid = String(referral.affiliateUid);
  // The promoter on the other side of the payment: no commission (stops paying yourself through a referral)
  const counterparty = side === "payer" ? payment.payeeUid : payment.payerUid;
  if (counterparty && String(counterparty) === affiliateUid) return;

  // Reward window starts at this person's first paid payment on this side
  const windowKey = side === "payer" ? "payerWindowStart" : "payeeWindowStart";
  const windowDays = side === "payer" ? PAYER_DAYS() : PAYEE_DAYS();
  const now = Date.now();
  const startMs = toMs(referral[windowKey]) ?? now;
  if (now - startMs > windowDays * DAY) return;
  if (!referral[windowKey]) await referralRef.update({ [windowKey]: Timestamp.fromMillis(now) });

  // Wiji's net fee: the platform percentage of the payment, less Paystack's own fee (which Wiji's share pays)
  const payee = payment.payeeUid ? (await db.collection("payees").doc(String(payment.payeeUid)).get()).data() : null;
  const feePercent = Number.isFinite(Number(payee?.feePercent)) ? Number(payee!.feePercent) : PLATFORM_FEE();
  const grossFeeCents = Math.round((amountCents * feePercent) / 100);
  const paystackFeeCents = Math.max(0, Math.round(Number(tx?.fees) || 0));
  const netFeeCents = Math.max(0, grossFeeCents - paystackFeeCents);
  const rate = RATE();
  const commissionCents = Math.floor((netFeeCents * rate) / 100);
  if (commissionCents <= 0) return;

  // Checks that send a row to the team for review instead of paying it
  const flags: string[] = [];
  if (side === "payer") {
    const sig = String(tx?.authorization?.signature || tx?.authorization?.authorization_code || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (sig && (await db.collection("paymentMethods").doc(affiliateUid).collection("cards").doc(sig).get()).exists) {
      flags.push("Paid with a card the promoter has also used on Wiji");
    }
  } else {
    const mine = (await db.collection("payees").doc(affiliateUid).get()).data();
    if (mine?.accountLast4 && payee?.accountLast4 === mine.accountLast4 && payee?.bankCode === mine.bankCode) {
      flags.push("Paid into a bank account that looks like the promoter's own");
    }
  }
  const aff = (await db.collection("affiliates").doc(affiliateUid).get()).data();
  const status = flags.length ? "flagged" : aff?.status === "approved" ? "pending" : "held";

  const row = {
    affiliateUid,
    referredUid,
    referredName: referral.referredName || "Wiji user",
    side,
    kind: payment.rideId ? "ride" : payment.orderId ? "order" : payment.groupSub ? "group" : "payment",
    reference,
    amountCents,
    feePercent,
    grossFeeCents,
    paystackFeeCents,
    netFeeCents,
    rate,
    commissionCents,
    status,
    flags,
    createdAt: FieldValue.serverTimestamp(),
    availableAt: Timestamp.fromMillis(now + HOLD_DAYS() * DAY),
  };
  try {
    await db.collection("affiliateLedger").doc(`${reference}_${side}`).create(row);
  } catch (e: any) {
    if (e?.code === 6 || /already exists/i.test(String(e?.message))) return; // already credited
    throw e;
  }
}

/** A payment was refunded: cancel its unpaid commissions, and mark paid ones so the team can recover them. */
export async function reverseAffiliateCommissions(reference: string, reason: string) {
  try {
    const db = fs();
    const snap = await db.collection("affiliateLedger").where("reference", "==", reference).get();
    await Promise.all(snap.docs.map((d) =>
      d.get("status") === "paid"
        ? d.ref.update({ refundedAfterPayout: true, refundReason: reason.slice(0, 200), updatedAt: FieldValue.serverTimestamp() })
        : d.ref.update({ status: "reversed", reversedReason: `Refunded: ${reason}`.slice(0, 200), updatedAt: FieldValue.serverTimestamp() })));
  } catch (e: any) {
    logger.error("affiliate reversal failed", { reference, msg: e?.message });
  }
}

/* ------------------------------------------------------------------ */
/* Wiji team                                                           */
/* ------------------------------------------------------------------ */

const adminLog = (staffUid: string, action: string, details: Record<string, unknown>) =>
  fs().collection("adminLog").add({ staffUid, action, ...details, at: FieldValue.serverTimestamp() });

/** Approve, decline, freeze or unfreeze a promoter; or mark them trusted (no daily sign-up cap). */
export const affiliateReview = onCall({}, async (req) => {
  const staff = await requireStaff(req);
  const uid = String(req.data?.uid || "");
  const decision = String(req.data?.decision || "");
  const reason = clean(req.data?.reason, 500);
  if (!["approve", "decline", "freeze", "unfreeze", "trust", "untrust"].includes(decision)) throw new HttpsError("invalid-argument", "Unknown decision.");
  const db = fs();
  const ref = db.collection("affiliates").doc(uid);
  const aff = (await ref.get()).data();
  if (!aff) throw new HttpsError("not-found", "Promoter not found.");
  if ((decision === "decline" || decision === "freeze") && reason.length < 5) throw new HttpsError("invalid-argument", "Write a short reason.");

  const update: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
  if (decision === "approve" || decision === "unfreeze") {
    update.status = "approved";
    if (!aff.approvedAt) update.approvedAt = FieldValue.serverTimestamp();
    // Commissions earned while frozen go back to normal
    const held = await db.collection("affiliateLedger").where("affiliateUid", "==", uid).where("status", "==", "held").get();
    await Promise.all(held.docs.map((d) => d.ref.update({ status: "pending" })));
  } else if (decision === "decline") {
    update.status = "declined";
    if (aff.code) await db.collection("affiliateCodes").doc(aff.code).delete().catch(() => undefined);
  } else if (decision === "freeze") {
    update.status = "frozen";
    const open = await db.collection("affiliateLedger").where("affiliateUid", "==", uid).where("status", "==", "pending").get();
    await Promise.all(open.docs.map((d) => d.ref.update({ status: "held" })));
  } else {
    update.trusted = decision === "trust";
  }
  if (reason) update.decision = { reason, by: staff.uid, at: FieldValue.serverTimestamp(), action: decision };
  await ref.update(update);
  await adminLog(staff.uid, `affiliate_${decision}`, { affiliateUid: uid, reason: reason || null });

  if (decision === "approve") {
    await pushTo(uid, "You're a Wiji promoter", `Your code ${aff.code} is live. Share it and see your earnings at the Wiji portal.`, { type: "affiliate" });
  } else if (decision === "decline") {
    await pushTo(uid, "Wiji promoter application", "Your application wasn't approved this time. Sign in to the Wiji portal to see why.", { type: "affiliate" });
  } else if (decision === "freeze") {
    await pushTo(uid, "Your Wiji promoter account is paused", "Payouts are on hold while we check something. Sign in to the Wiji portal for details.", { type: "affiliate" });
  }
  return { ok: true };
});

/** Decide a flagged commission: count it (pending) or cancel it (reversed). */
export const affiliateResolveEntry = onCall({}, async (req) => {
  const staff = await requireStaff(req);
  const id = String(req.data?.id || "");
  const approve = req.data?.decision === "approve";
  const ref = fs().collection("affiliateLedger").doc(id);
  const row = (await ref.get()).data();
  if (!row) throw new HttpsError("not-found", "Commission not found.");
  if (row.status !== "flagged") throw new HttpsError("failed-precondition", "Only flagged commissions can be decided.");
  const aff = (await fs().collection("affiliates").doc(row.affiliateUid).get()).data();
  await ref.update({
    status: approve ? (aff?.status === "approved" ? "pending" : "held") : "reversed",
    reviewedBy: staff.uid,
    reviewedAt: FieldValue.serverTimestamp(),
    ...(approve ? {} : { reversedReason: "Cancelled by the Wiji team after review" }),
  });
  await adminLog(staff.uid, approve ? "affiliate_entry_approve" : "affiliate_entry_reject", { id });
  return { ok: true };
});

/**
 * Admin records that they paid a promoter (by EFT, in phase 1). Marks every commission that is past
 * its hold period as paid and saves a payout record.
 */
export const affiliateRecordPayout = onCall({}, async (req) => {
  const staff = await requireStaff(req);
  if (staff.role !== "admin") throw new HttpsError("permission-denied", "Only admins can record payouts.");
  const uid = String(req.data?.uid || "");
  const note = clean(req.data?.note, 200);
  const db = fs();
  const aff = (await db.collection("affiliates").doc(uid).get()).data();
  if (!aff) throw new HttpsError("not-found", "Promoter not found.");
  if (aff.status !== "approved") throw new HttpsError("failed-precondition", "This promoter isn't active, so they can't be paid.");
  const now = Date.now();
  const due = (await db.collection("affiliateLedger").where("affiliateUid", "==", uid).where("status", "==", "pending").get())
    .docs.filter((d) => (toMs(d.get("availableAt")) ?? Infinity) <= now);
  const total = due.reduce((s, d) => s + (Number(d.get("commissionCents")) || 0), 0);
  if (!due.length || total <= 0) throw new HttpsError("failed-precondition", "Nothing is ready to pay yet.");

  const payoutRef = db.collection("affiliatePayouts").doc();
  for (let i = 0; i < due.length; i += 400) {
    const batch = db.batch();
    due.slice(i, i + 400).forEach((d) => batch.update(d.ref, { status: "paid", payoutId: payoutRef.id, paidAt: FieldValue.serverTimestamp() }));
    await batch.commit();
  }
  await payoutRef.set({
    affiliateUid: uid,
    amountCents: total,
    entries: due.length,
    note: note || null,
    method: "manual",
    by: staff.uid,
    createdAt: FieldValue.serverTimestamp(),
  });
  await adminLog(staff.uid, "affiliate_payout", { affiliateUid: uid, amountCents: total, payoutId: payoutRef.id });
  await pushTo(uid, "Wiji promoter payout", `We've paid you ${randText(total)}. It can take a day or two to show in your bank account.`, { type: "affiliate" });
  return { ok: true, amountCents: total, entries: due.length };
});
