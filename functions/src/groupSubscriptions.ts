// functions/src/groupSubscriptions.ts
// Paid (subscription) group chats. A group's creator can charge members a monthly or yearly
// price to be in the group. Members pay by card through Paystack; each payment is split like
// every other Wiji payment: the creator's share goes to their payout bank account (their
// Paystack subaccount) and Wiji keeps its platform fee.
//
// Data:
//   communities/{c}/groupChats/{g}.subscription = { enabled, interval: "monthly"|"yearly", priceCents, currency: "ZAR" }
//   groupSubscriptions/{c}_{g}_{uid}  (server-written; readable by the subscriber and the group creator)
//     status: "active" | "past_due" | "expired" | "ended"
//     currentPeriodEnd, autoRenew, cardId, priceCents, interval, nextCheckAt (renewal queue)
//
// Access = being in the group's `members` array. For paid groups only these functions add
// people to it (Firestore rules block self-joining), and the renewal job removes people whose
// access has run out.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  applyTransaction,
  displayName,
  getPayee,
  newReference,
  paystack,
  pushTo,
  randText,
  requireUser,
  saveCard,
} from "./paystack.js";

const fs = () => getFirestore();
const CURRENCY = "ZAR";
export const GROUP_SUB_MIN_CENTS = 500; // R5
export const GROUP_SUB_MAX_CENTS = 2_000_000; // R20 000
/** After a failed automatic renewal the member keeps access this long while we retry. */
const GRACE_MS = 3 * 24 * 60 * 60 * 1000;
/** Retry a failed renewal at most once a day. */
const RETRY_MS = 24 * 60 * 60 * 1000;

type Interval = "monthly" | "yearly";

export const subscriptionId = (communityId: string, groupId: string, uid: string) => `${communityId}_${groupId}_${uid}`;

function addPeriod(from: Date, interval: Interval): Date {
  const d = new Date(from.getTime());
  if (interval === "yearly") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

const dateText = (d: Date) => d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" });

function cleanId(v: unknown, what: string): string {
  const s = String(v || "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(s)) throw new HttpsError("invalid-argument", `Missing ${what}.`);
  return s;
}

/** The group's subscription settings, validated. Throws if the group isn't a paid group. */
async function loadPaidGroup(communityId: string, groupId: string) {
  const snap = await fs().doc(`communities/${communityId}/groupChats/${groupId}`).get();
  const g = snap.data();
  if (!g) throw new HttpsError("not-found", "Group not found.");
  const s = g.subscription;
  if (!s?.enabled) throw new HttpsError("failed-precondition", "This group is free to join.");
  const priceCents = Math.round(Number(s.priceCents));
  const interval: Interval = s.interval === "yearly" ? "yearly" : "monthly";
  if (!Number.isFinite(priceCents) || priceCents < GROUP_SUB_MIN_CENTS || priceCents > GROUP_SUB_MAX_CENTS) {
    throw new HttpsError("failed-precondition", "This group's price isn't set up correctly. Ask the group's creator to fix it.");
  }
  return { ref: snap.ref, name: String(g.name || g.title || "the group"), createdBy: String(g.createdBy || ""), members: (g.members || []) as string[], priceCents, interval };
}

async function assertCommunityMember(uid: string, communityId: string) {
  const [u, c] = await Promise.all([fs().collection("users").doc(uid).get(), fs().collection("communities").doc(communityId).get()]);
  const joined: string[] = u.get("joinedCommunities") || [];
  if (!(Array.isArray(joined) && joined.includes(communityId)) && c.get("createdBy") !== uid) {
    throw new HttpsError("failed-precondition", "Join the community first, then subscribe to the group.");
  }
}

/* ------------------------------------------------------------------ */

/**
 * Called from paystack.ts once a group subscription payment is confirmed paid (exactly once per payment).
 * Starts or extends the member's access and adds them to the group.
 */
export async function onGroupSubscriptionPaid(reference: string, p: any, tx: any) {
  const { communityId, groupId } = p.groupSub || {};
  const uid = String(p.payerUid || "");
  if (!communityId || !groupId || !uid) return;
  const interval: Interval = p.groupSub.interval === "yearly" ? "yearly" : "monthly";
  const db = fs();
  const subRef = db.collection("groupSubscriptions").doc(subscriptionId(communityId, groupId, uid));
  const groupRef = db.doc(`communities/${communityId}/groupChats/${groupId}`);

  // Keep the card for automatic renewals (only when the member asked for auto-renew)
  let cardId: string | null = p.cardId ? String(p.cardId) : null;
  if (p.autoRenew && !cardId) {
    cardId = await saveCard(uid, String(tx?.customer?.email || ""), tx?.authorization).catch(() => null);
  }

  let periodEnd = new Date();
  let groupName = "the group";
  let creatorUid = String(p.payeeUid || "");
  let renewal = false;
  await db.runTransaction(async (t) => {
    const [subSnap, groupSnap] = await Promise.all([t.get(subRef), t.get(groupRef)]);
    const cur = subSnap.data();
    if (cur?.lastPaymentRef === reference) return; // already applied
    const g = groupSnap.data() || {};
    groupName = String(g.name || g.title || groupName);
    creatorUid = String(g.createdBy || creatorUid);
    const now = new Date();
    const curEnd: Date | null = cur?.currentPeriodEnd?.toDate ? cur.currentPeriodEnd.toDate() : null;
    renewal = !!curEnd && cur?.status !== "expired" && cur?.status !== "ended";
    // Paying early (or renewing) adds a full period on top of what's left
    periodEnd = addPeriod(curEnd && curEnd > now ? curEnd : now, interval);
    const autoRenew = !!p.autoRenew && !!cardId;
    t.set(
      subRef,
      {
        uid,
        communityId,
        groupId,
        groupName,
        creatorUid,
        interval,
        priceCents: Number(p.amountCents),
        currency: CURRENCY,
        status: "active",
        autoRenew,
        cardId: autoRenew ? cardId : null,
        currentPeriodEnd: Timestamp.fromDate(periodEnd),
        nextCheckAt: Timestamp.fromDate(periodEnd),
        lastPaymentRef: reference,
        lastPaidAt: FieldValue.serverTimestamp(),
        failedAttempts: 0,
        lastFailure: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
        ...(subSnap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true }
    );
    if (groupSnap.exists) t.update(groupRef, { members: FieldValue.arrayUnion(uid) });
  });

  const who = String(p.payerName || "Someone");
  const amount = randText(Number(p.amountCents));
  if (creatorUid && creatorUid !== uid) {
    await pushTo(
      creatorUid,
      renewal ? `${who} renewed their subscription` : `${who} subscribed to ${groupName}`,
      `${amount} for ${groupName}. Paystack pays it into your bank account, less fees.`,
      { type: "group_subscription_paid", communityId, groupId, reference }
    );
  }
  await pushTo(
    uid,
    p.renewal ? `Subscription renewed: ${groupName}` : `You're in: ${groupName}`,
    `Paid ${amount}. Your access runs until ${dateText(periodEnd)}.`,
    { type: "group_subscription_active", communityId, groupId, reference }
  );
}

/** Charge a saved card for a subscription and apply the result. */
async function chargeSavedCard(opts: {
  uid: string;
  cardId: string;
  communityId: string;
  groupId: string;
  group: Awaited<ReturnType<typeof loadPaidGroup>>;
  amountCents: number;
  autoRenew: boolean;
  renewal: boolean;
}) {
  const db = fs();
  const token = (await db.collection("paystackAuthorizations").doc(`${opts.uid}_${opts.cardId}`).get()).data();
  if (!token?.authorizationCode) throw new HttpsError("not-found", "That card isn't saved any more.");
  const payee = await getPayee(opts.group.createdBy);
  const reference = newReference();
  await db.collection("payments").doc(reference).set({
    reference,
    payerUid: opts.uid,
    payerName: await displayName(opts.uid),
    payeeUid: opts.group.createdBy,
    payeeName: payee.businessName,
    payeeRole: payee.role,
    amountCents: opts.amountCents,
    currency: CURRENCY,
    note: `${opts.group.interval === "yearly" ? "Yearly" : "Monthly"} subscription: ${opts.group.name}`.slice(0, 140),
    status: "pending",
    savedCard: true,
    cardId: opts.cardId,
    autoRenew: opts.autoRenew,
    renewal: opts.renewal,
    groupSub: { communityId: opts.communityId, groupId: opts.groupId, interval: opts.group.interval },
    createdAt: FieldValue.serverTimestamp(),
  });
  const tx = await paystack<any>("post", "/transaction/charge_authorization", {
    authorization_code: token.authorizationCode,
    email: token.email,
    amount: opts.amountCents,
    currency: CURRENCY,
    reference,
    subaccount: payee.subaccountCode,
    metadata: { payerUid: opts.uid, payeeUid: opts.group.createdBy, purpose: "group_subscription", communityId: opts.communityId, groupId: opts.groupId, renewal: opts.renewal },
  }).catch(async (e) => {
    // Paystack refused the charge outright: don't leave the payment looking pending
    await db.collection("payments").doc(reference).update({ status: "failed", updatedAt: FieldValue.serverTimestamp() }).catch(() => {});
    throw e;
  });
  const result = await applyTransaction(tx);
  return { reference, status: (result?.status as string) || "pending" };
}

/* ------------------------------------------------------------------ */

/**
 * Subscribe to (or pay early for / rejoin) a paid group.
 * data: { communityId, groupId, autoRenew?: boolean, cardId?: string, callbackUrl?: string }
 * Returns { status: "active", alreadyActive: true } when the member already has paid time left,
 * { reference, status } when paid with a saved card, or { reference, authorizationUrl } for Paystack checkout.
 */
export const groupSubStart = onCall({}, async (req) => {
  const { uid, email } = requireUser(req);
  const communityId = cleanId(req.data?.communityId, "community");
  const groupId = cleanId(req.data?.groupId, "group");
  const autoRenew = req.data?.autoRenew !== false;
  const cardId = req.data?.cardId ? String(req.data.cardId) : null;
  const callbackUrl = req.data?.callbackUrl;

  const group = await loadPaidGroup(communityId, groupId);
  if (group.createdBy === uid) throw new HttpsError("failed-precondition", "You created this group, so you don't pay for it.");
  await assertCommunityMember(uid, communityId);

  // Still has paid time (e.g. they left the group and are coming back): just let them back in
  const subRef = fs().collection("groupSubscriptions").doc(subscriptionId(communityId, groupId, uid));
  const sub = (await subRef.get()).data();
  const end: Date | null = sub?.currentPeriodEnd?.toDate ? sub.currentPeriodEnd.toDate() : null;
  if (sub && end && end > new Date() && (sub.status === "active" || sub.status === "past_due") && !req.data?.payAhead) {
    await group.ref.update({ members: FieldValue.arrayUnion(uid) });
    return { status: "active", alreadyActive: true, currentPeriodEnd: end.toISOString() };
  }

  if (cardId) {
    return chargeSavedCard({ uid, cardId, communityId, groupId, group, amountCents: group.priceCents, autoRenew, renewal: false });
  }

  if (!email) throw new HttpsError("failed-precondition", "Your account needs an email address to pay.");
  const payee = await getPayee(group.createdBy);
  const reference = newReference();
  await fs().collection("payments").doc(reference).set({
    reference,
    payerUid: uid,
    payerName: await displayName(uid),
    payeeUid: group.createdBy,
    payeeName: payee.businessName,
    payeeRole: payee.role,
    amountCents: group.priceCents,
    currency: CURRENCY,
    note: `${group.interval === "yearly" ? "Yearly" : "Monthly"} subscription: ${group.name}`.slice(0, 140),
    status: "pending",
    saveCard: autoRenew, // auto-renew needs the card kept for the next charge
    autoRenew,
    groupSub: { communityId, groupId, interval: group.interval },
    createdAt: FieldValue.serverTimestamp(),
  });
  const tx = await paystack<any>("post", "/transaction/initialize", {
    email,
    amount: group.priceCents,
    currency: CURRENCY,
    reference,
    subaccount: payee.subaccountCode,
    channels: ["card"],
    ...(typeof callbackUrl === "string" && callbackUrl ? { callback_url: callbackUrl } : {}),
    metadata: { payerUid: uid, payeeUid: group.createdBy, purpose: "group_subscription", communityId, groupId },
  });
  return { reference, authorizationUrl: tx.authorization_url };
});

/** Turn automatic renewal on or off. Turning it off keeps access until the paid period ends. */
export const groupSubSetAutoRenew = onCall({}, async (req) => {
  const { uid } = requireUser(req);
  const communityId = cleanId(req.data?.communityId, "community");
  const groupId = cleanId(req.data?.groupId, "group");
  const autoRenew = req.data?.autoRenew === true;
  const ref = fs().collection("groupSubscriptions").doc(subscriptionId(communityId, groupId, uid));
  const sub = (await ref.get()).data();
  if (!sub || sub.uid !== uid) throw new HttpsError("not-found", "You don't have a subscription to this group.");
  if (sub.status === "expired" || sub.status === "ended") throw new HttpsError("failed-precondition", "This subscription has ended. Subscribe again to rejoin.");
  const newCard = req.data?.cardId ? String(req.data.cardId) : null;
  if (autoRenew) {
    const cardId = newCard || sub.cardId;
    if (!cardId) throw new HttpsError("failed-precondition", "Choose a saved card to renew with.");
    const token = await fs().collection("paystackAuthorizations").doc(`${uid}_${cardId}`).get();
    if (!token.exists) throw new HttpsError("not-found", "That card isn't saved any more.");
    await ref.update({ autoRenew: true, cardId, updatedAt: FieldValue.serverTimestamp() });
  } else {
    await ref.update({ autoRenew: false, updatedAt: FieldValue.serverTimestamp() });
  }
  return { ok: true, autoRenew };
});

/* ------------------------------------------------------------------ */

async function expire(subRef: FirebaseFirestore.DocumentReference, sub: any, reason: string) {
  const db = fs();
  const groupRef = db.doc(`communities/${sub.communityId}/groupChats/${sub.groupId}`);
  const g = (await groupRef.get()).data();
  await subRef.update({ status: "expired", expiredAt: FieldValue.serverTimestamp(), expiryReason: reason, nextCheckAt: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
  if (g && g.createdBy !== sub.uid) await groupRef.update({ members: FieldValue.arrayRemove(sub.uid) });
  await pushTo(
    sub.uid,
    `Your subscription to ${sub.groupName || "a group"} has ended`,
    "Subscribe again from the group to get back in.",
    { type: "group_subscription_expired", communityId: String(sub.communityId), groupId: String(sub.groupId) }
  );
}

async function processDue(doc: FirebaseFirestore.QueryDocumentSnapshot) {
  const sub = doc.data();
  const now = new Date();
  const end: Date = sub.currentPeriodEnd?.toDate ? sub.currentPeriodEnd.toDate() : now;
  if (sub.status !== "active" && sub.status !== "past_due") {
    await doc.ref.update({ nextCheckAt: FieldValue.delete() });
    return;
  }

  // The group was deleted, or the creator made it free: nothing more to charge
  let group: Awaited<ReturnType<typeof loadPaidGroup>> | null = null;
  try {
    group = await loadPaidGroup(sub.communityId, sub.groupId);
  } catch {
    const exists = (await fs().doc(`communities/${sub.communityId}/groupChats/${sub.groupId}`).get()).exists;
    await doc.ref.update({ status: "ended", endedReason: exists ? "group_now_free" : "group_deleted", nextCheckAt: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    return;
  }
  if (end > now) {
    await doc.ref.update({ nextCheckAt: Timestamp.fromDate(end) }); // not due yet (e.g. paid early)
    return;
  }

  // The creator changed monthly <-> yearly: don't charge a different plan without asking
  const canAutoRenew = sub.autoRenew && sub.cardId && group.interval === sub.interval;
  if (!canAutoRenew) {
    await expire(doc.ref, sub, sub.autoRenew ? "plan_changed" : "not_renewed");
    return;
  }

  const graceEnd = new Date(end.getTime() + GRACE_MS);
  const lastTry: Date | null = sub.lastRenewalAttemptAt?.toDate ? sub.lastRenewalAttemptAt.toDate() : null;
  if (lastTry && now.getTime() - lastTry.getTime() < RETRY_MS) {
    await doc.ref.update({ nextCheckAt: Timestamp.fromDate(new Date(lastTry.getTime() + RETRY_MS)) });
    return;
  }
  if (now >= graceEnd) {
    await expire(doc.ref, sub, "payment_failed");
    return;
  }

  // Existing subscribers keep the price they signed up at; if the creator lowered it, they pay less
  const amountCents = Math.min(Number(sub.priceCents) || group.priceCents, group.priceCents);
  await doc.ref.update({ lastRenewalAttemptAt: FieldValue.serverTimestamp() });
  let status = "failed";
  let failure = "";
  try {
    const res = await chargeSavedCard({ uid: sub.uid, cardId: sub.cardId, communityId: sub.communityId, groupId: sub.groupId, group, amountCents, autoRenew: true, renewal: true });
    status = res.status;
  } catch (e: any) {
    failure = e?.message || "Payment failed";
  }
  if (status === "paid") return; // onGroupSubscriptionPaid moved the period on

  const nextTry = new Date(Math.min(now.getTime() + RETRY_MS, graceEnd.getTime()));
  await doc.ref.update({
    status: "past_due",
    failedAttempts: FieldValue.increment(1),
    lastFailure: failure || `Payment ${status}`,
    nextCheckAt: Timestamp.fromDate(nextTry),
    updatedAt: FieldValue.serverTimestamp(),
  });
  if (status !== "pending") {
    await pushTo(
      sub.uid,
      `We couldn't renew ${sub.groupName || "your group"} subscription`,
      `We'll try your card again tomorrow. Pay from the group before ${dateText(graceEnd)} to keep your access.`,
      { type: "group_subscription_failed", communityId: String(sub.communityId), groupId: String(sub.groupId) }
    );
  }
}

/** Renew subscriptions that are due and remove members whose access has run out. */
export const groupSubRenewals = onSchedule({ schedule: "every 1 hours", timeZone: "Africa/Johannesburg" }, async () => {
  const due = await fs().collection("groupSubscriptions").where("nextCheckAt", "<=", Timestamp.now()).limit(300).get();
  for (const d of due.docs) {
    try {
      await processDue(d);
    } catch (e: any) {
      logger.error("group subscription renewal failed", { id: d.id, msg: e?.message });
    }
  }
  if (due.size) logger.info(`group subscriptions checked: ${due.size}`);
});

