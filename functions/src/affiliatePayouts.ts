// functions/src/affiliatePayouts.ts
// Wiji promoter programme, phase 2: automatic payouts through Paystack Transfers.
//
// How it works
//   - Once a month (and on demand from the admin site) we find promoters whose commissions are past the
//     hold period and add up to at least AFFILIATE_MIN_PAYOUT_RAND.
//   - For each one we LOCK those commissions (status "processing"), save a payout record, and ask Paystack to
//     send the money from Wiji's Paystack balance to the promoter's bank account.
//   - Commissions only become "paid" when Paystack CONFIRMS the transfer (webhook, re-verified, or the hourly check).
//     If a transfer fails or is reversed, the commissions go back to "pending" and the promoter's automatic
//     payouts are put on hold until the Wiji team looks at it.
//
// Safety
//   - AFFILIATE_AUTO_PAYOUTS = off (default) | dry | live.  "off" and "dry" never move money.
//     Admins can always run a PREVIEW (dry run) from the Promoters page.
//   - Each transfer uses a unique reference (the payout id), so a retry can never pay twice.
//   - Commissions are claimed inside a transaction, so the monthly run, a manual run and the manual
//     "record payout" button can't pay the same commission twice.
//   - Limits: AFFILIATE_MIN_PAYOUT_RAND (200), AFFILIATE_MAX_PAYOUT_RAND per promoter (2000),
//     AFFILIATE_RUN_CAP_RAND per run (5000). Over-limit promoters are left for a person to pay.
//   - Skips promoters who aren't approved, are on hold, have no bank account, or changed their bank account
//     in the last 7 days. Stops if Wiji's Paystack balance is too low.
//
// Needs, in the Paystack dashboard: Transfers enabled for ZAR, money in the balance, and
// Settings -> Preferences -> "Confirm transfers before sending" switched OFF (otherwise every transfer waits for an OTP).
//
// Collections:
//   affiliatePayouts/{id}      method "auto" | "manual", status processing | sent | paid | failed | reversed
//   affiliatePayoutRuns/{id}   one record per run (what was paid, skipped and why)
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomBytes } from "node:crypto";
import { requireStaff } from "./staff.js";
import { paystack, pushTo, randText } from "./paystack.js";

const fs = () => getFirestore();
const DAY = 864e5;
const MINUTE = 6e4;

function num(name: string, def: number, min: number, max: number) {
  const n = Number(process.env[name] ?? def);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
const MIN_CENTS = () => Math.round(num("AFFILIATE_MIN_PAYOUT_RAND", 200, 1, 100000) * 100);
const MAX_CENTS = () => Math.round(num("AFFILIATE_MAX_PAYOUT_RAND", 2000, 1, 1000000) * 100);
const RUN_CAP_CENTS = () => Math.round(num("AFFILIATE_RUN_CAP_RAND", 5000, 1, 10000000) * 100);

type Mode = "off" | "dry" | "live";
const mode = (): Mode => {
  const m = String(process.env.AFFILIATE_AUTO_PAYOUTS || "off").trim().toLowerCase();
  return m === "live" || m === "dry" ? m : "off";
};

const toMs = (v: any): number | null => (v?.toMillis ? v.toMillis() : v?.seconds ? v.seconds * 1000 : typeof v === "number" ? v : null);
const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const log = (staffUid: string, action: string, details: Record<string, unknown>) =>
  fs().collection("adminLog").add({ staffUid, action, ...details, at: FieldValue.serverTimestamp() }).catch(() => undefined);

/** Paystack transfer reference: 16-50 chars of a-z, 0-9, _ and -. Also used as the payout document id. */
const newPayoutId = () => `p_${Date.now().toString(36)}_${randomBytes(6).toString("hex")}`;

/* ------------------------------------------------------------------ */
/* Bank recipient                                                       */
/* ------------------------------------------------------------------ */

/**
 * The Paystack "transfer recipient" for a promoter's bank account. Wiji only keeps the last 4 digits, so the full
 * number is read from the promoter's Paystack subaccount (made when they saved their bank details) and used once.
 */
async function ensureRecipient(uid: string, payee: any): Promise<string> {
  const fingerprint = `${payee.bankCode}:${payee.accountLast4}:${toMs(payee.updatedAt) ?? 0}`;
  if (payee.transferRecipientCode && payee.transferRecipientFingerprint === fingerprint) return String(payee.transferRecipientCode);

  const sub = await paystack<any>("get", `/subaccount/${encodeURIComponent(String(payee.subaccountCode))}`);
  const accountNumber = String(sub?.account_number || "").replace(/\s+/g, "");
  if (!/^\d{6,16}$/.test(accountNumber) || accountNumber.slice(-4) !== String(payee.accountLast4)) {
    throw new Error("The bank details at Paystack don't match the ones on file");
  }
  const rec = await paystack<any>("post", "/transferrecipient", {
    type: "basa",
    name: clean(payee.accountHolder || payee.businessName || "Wiji promoter", 80),
    account_number: accountNumber,
    bank_code: String(payee.bankCode),
    currency: "ZAR",
  });
  const code = String(rec?.recipient_code || "");
  if (!code) throw new Error("Paystack didn't return a recipient code");
  await fs().collection("payees").doc(uid).set({ transferRecipientCode: code, transferRecipientFingerprint: fingerprint }, { merge: true });
  return code;
}

/* ------------------------------------------------------------------ */
/* Locking and finishing commissions                                    */
/* ------------------------------------------------------------------ */

/** Commissions that are pending and past their hold period. */
async function dueEntries(affiliateUid: string, now: number) {
  const snap = await fs().collection("affiliateLedger").where("affiliateUid", "==", affiliateUid).where("status", "==", "pending").get();
  return snap.docs.filter((d) => (toMs(d.get("availableAt")) ?? Infinity) <= now);
}

/** Lock those commissions for this payout. Only rows still "pending" are taken, so nothing is claimed twice. */
async function claim(docs: FirebaseFirestore.QueryDocumentSnapshot[], payoutId: string) {
  const db = fs();
  let total = 0;
  const ids: string[] = [];
  for (let i = 0; i < docs.length; i += 200) {
    const chunk = docs.slice(i, i + 200);
    await db.runTransaction(async (t) => {
      const fresh = await Promise.all(chunk.map((d) => t.get(d.ref)));
      for (const s of fresh) {
        if (s.get("status") !== "pending") continue;
        t.update(s.ref, { status: "processing", payoutId, updatedAt: FieldValue.serverTimestamp() });
        total += Number(s.get("commissionCents")) || 0;
        ids.push(s.id);
      }
    });
  }
  return { total, ids };
}

/**
 * Close a payout once Paystack has said how it ended. Safe to call more than once.
 *   paid     -> commissions become "paid"
 *   failed   -> commissions go back to "pending" (the money didn't leave)
 *   reversed -> same as failed, even if we had already marked them paid
 */
export async function finalizePayout(payoutId: string, outcome: "paid" | "failed" | "reversed", reason = "") {
  const db = fs();
  const ref = db.collection("affiliatePayouts").doc(payoutId);
  const payout = (await ref.get()).data();
  if (!payout) return;
  if (outcome === "paid" && payout.status === "paid") return;
  if (outcome !== "paid" && (payout.status === "failed" || payout.status === "reversed")) return;

  const rows = (await db.collection("affiliateLedger").where("payoutId", "==", payoutId).get()).docs;
  for (let i = 0; i < rows.length; i += 400) {
    const batch = db.batch();
    rows.slice(i, i + 400).forEach((d) =>
      outcome === "paid"
        ? batch.update(d.ref, { status: "paid", paidAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
        : batch.update(d.ref, { status: "pending", payoutId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }));
    await batch.commit();
  }
  await ref.update({ status: outcome, ...(reason ? { reason: reason.slice(0, 300) } : {}), finishedAt: FieldValue.serverTimestamp() });

  const uid = String(payout.affiliateUid);
  if (outcome === "paid") {
    await pushTo(uid, "Wiji promoter payout", `We've sent you ${randText(Number(payout.amountCents) || 0)} by bank transfer. It can take a day or two to show in your account.`, { type: "affiliate" }).catch(() => undefined);
  } else {
    // Don't keep retrying a payout that fails: the team checks it first.
    if (!(outcome === "failed" && /never created/i.test(reason))) {
      await db.collection("affiliates").doc(uid).update({ payoutHold: { reason: reason.slice(0, 200) || outcome, at: FieldValue.serverTimestamp(), payoutId } }).catch(() => undefined);
      await pushTo(uid, "Wiji promoter payout", "We couldn't send your payout. Please check your bank details under Profile, then Payouts. Your earnings are safe.", { type: "affiliate" }).catch(() => undefined);
    }
    logger.error("affiliate payout did not complete", { payoutId, outcome, reason });
    await log("system", "affiliate_payout_" + outcome, { payoutId, affiliateUid: uid, reason });
  }
}

/* ------------------------------------------------------------------ */
/* Paying one promoter                                                  */
/* ------------------------------------------------------------------ */

type Result = { uid: string; name: string; code: string; amountCents: number; outcome: string; note?: string };

async function payOne(uid: string, live: boolean, runId: string, budget: { balance: number | null; cap: number }): Promise<Result> {
  const db = fs();
  const now = Date.now();
  const aff = (await db.collection("affiliates").doc(uid).get()).data() || {};
  const base = { uid, name: String(aff.name || uid), code: String(aff.code || ""), amountCents: 0 };
  const skip = (note: string, amountCents = 0): Result => ({ ...base, amountCents, outcome: "skipped", note });

  if (aff.status !== "approved") return skip(`Promoter is ${aff.status || "not approved"}`);
  if (aff.payoutHold) return skip(`On hold: ${aff.payoutHold.reason || "a previous payout didn't complete"}`);
  const payee = (await db.collection("payees").doc(uid).get()).data();
  if (!payee || payee.active === false || !payee.subaccountCode || !payee.accountLast4 || !payee.bankCode) return skip("No bank account added");
  const changed = toMs(payee.bankChangedAt);
  if (changed && now - changed < 7 * DAY) return skip("Bank account changed in the last 7 days");

  const due = await dueEntries(uid, now);
  const total = due.reduce((s, d) => s + (Number(d.get("commissionCents")) || 0), 0);
  if (total < MIN_CENTS()) return skip(`Under the minimum (${randText(total)})`, total);
  if (total > MAX_CENTS()) return skip(`Over the per-promoter limit (${randText(total)}): pay by hand`, total);
  if (total > budget.cap) return skip(`This run's limit has been reached (${randText(total)} left for next time)`, total);
  if (!live) return { ...base, amountCents: total, outcome: "would_pay" };
  if (budget.balance !== null && total > budget.balance) return skip(`Paystack balance too low (${randText(total)} needed)`, total);

  const payoutId = newPayoutId();
  const { total: locked, ids } = await claim(due, payoutId);
  if (!ids.length || locked <= 0) return skip("Commissions were already taken by another payout");
  const payoutRef = db.collection("affiliatePayouts").doc(payoutId);
  await payoutRef.set({
    affiliateUid: uid,
    amountCents: locked,
    entries: ids.length,
    method: "auto",
    status: "processing",
    runId,
    createdAt: FieldValue.serverTimestamp(),
  });

  let recipient: string;
  try {
    recipient = await ensureRecipient(uid, payee);
  } catch (e: any) {
    await finalizePayout(payoutId, "failed", `Bank account check failed: ${e?.message || e}`);
    return { ...base, amountCents: locked, outcome: "failed", note: `Bank account check failed: ${e?.message || e}` };
  }

  try {
    const tr = await paystack<any>("post", "/transfer", {
      source: "balance",
      amount: locked,
      recipient,
      reason: "Wiji promoter commissions",
      reference: payoutId,
      currency: "ZAR",
    });
    const status = String(tr?.status || "");
    if (budget.balance !== null) budget.balance -= locked;
    budget.cap -= locked;
    if (status === "otp") {
      // Paystack is waiting for someone to confirm in the dashboard: automation is switched off there.
      await payoutRef.update({ status: "sent", transferCode: tr?.transfer_code || null, transferStatus: "otp", note: "Waiting for OTP in the Paystack dashboard" });
      await log("system", "affiliate_payout_otp", { payoutId, affiliateUid: uid });
      return { ...base, amountCents: locked, outcome: "needs_otp", note: "Paystack is asking for an OTP. Turn off 'Confirm transfers before sending' in the Paystack dashboard." };
    }
    await payoutRef.update({ status: "sent", transferCode: tr?.transfer_code || null, transferStatus: status });
    if (status === "success") await finalizePayout(payoutId, "paid");
    return { ...base, amountCents: locked, outcome: status === "success" ? "paid" : "sent" };
  } catch (e: any) {
    // We can't tell whether Paystack created the transfer. Leave the commissions locked: the hourly check
    // asks Paystack and either finishes the payout or releases the commissions. Never guess, never pay twice.
    await payoutRef.update({ error: String(e?.message || e).slice(0, 300) }).catch(() => undefined);
    logger.error("affiliate transfer request failed", { payoutId, msg: e?.message });
    return { ...base, amountCents: locked, outcome: "unconfirmed", note: "Paystack didn't confirm. It will be checked automatically within the hour." };
  }
}

/* ------------------------------------------------------------------ */
/* The run                                                              */
/* ------------------------------------------------------------------ */

export async function runPayouts(by: string, dryRun: boolean) {
  const m = mode();
  const live = m === "live" && !dryRun;
  const db = fs();
  const now = Date.now();

  // Anyone with commissions that are ready
  const pending = (await db.collection("affiliateLedger").where("status", "==", "pending").get()).docs
    .filter((d) => (toMs(d.get("availableAt")) ?? Infinity) <= now);
  const uids = [...new Set(pending.map((d) => String(d.get("affiliateUid"))))];

  let balance: number | null = null;
  if (live) {
    try {
      const bal = await paystack<any[]>("get", "/balance");
      const zar = (Array.isArray(bal) ? bal : []).find((b) => String(b.currency).toUpperCase() === "ZAR");
      balance = Number(zar?.balance ?? 0);
    } catch (e: any) {
      throw new HttpsError("unavailable", `Couldn't read the Paystack balance: ${e?.message || e}`);
    }
  }

  const runRef = db.collection("affiliatePayoutRuns").doc();
  const budget = { balance, cap: RUN_CAP_CENTS() };
  const results: Result[] = [];
  for (const uid of uids) {
    try {
      const r = await payOne(uid, live, runRef.id, budget);
      results.push(r);
      if (r.outcome === "needs_otp") break; // switch is off in Paystack: stop before locking more
    } catch (e: any) {
      logger.error("affiliate payout failed", { uid, msg: e?.message });
      results.push({ uid, name: uid, code: "", amountCents: 0, outcome: "error", note: String(e?.message || e).slice(0, 200) });
    }
  }
  const paidCents = results.filter((r) => ["paid", "sent", "unconfirmed", "needs_otp"].includes(r.outcome)).reduce((s, r) => s + r.amountCents, 0);
  await runRef.set({ at: FieldValue.serverTimestamp(), by, mode: m, live, dryRun, considered: uids.length, results, paidCents });
  await log(by, live ? "affiliate_payout_run" : "affiliate_payout_preview", { runId: runRef.id, considered: uids.length, paidCents });
  return { live, mode: m, results, paidCents };
}

/** Monthly: the 1st at 09:00 (Johannesburg). Does nothing unless AFFILIATE_AUTO_PAYOUTS is "dry" or "live". */
export const affiliateAutoPayouts = onSchedule({ schedule: "0 9 1 * *", timeZone: "Africa/Johannesburg" }, async () => {
  if (mode() === "off") return;
  const r = await runPayouts("system", false);
  logger.info("affiliate payouts run", { mode: r.mode, paidCents: r.paidCents, promoters: r.results.length });
});

/** Admin: preview what would be paid (always allowed), or pay now (only when AFFILIATE_AUTO_PAYOUTS=live). */
export const affiliateRunPayouts = onCall({}, async (req) => {
  const staff = await requireStaff(req);
  if (staff.role !== "admin") throw new HttpsError("permission-denied", "Only admins can run payouts.");
  const dryRun = req.data?.dryRun !== false; // default to a preview
  if (!dryRun && mode() !== "live") {
    throw new HttpsError("failed-precondition", "Automatic payouts aren't switched on. Set AFFILIATE_AUTO_PAYOUTS=live in functions/.env and deploy.");
  }
  return await runPayouts(staff.uid, dryRun);
});

/** Staff: let a promoter be paid automatically again after checking why a payout failed. */
export const affiliateClearPayoutHold = onCall({}, async (req) => {
  const staff = await requireStaff(req);
  if (staff.role !== "admin") throw new HttpsError("permission-denied", "Only admins can clear a payout hold.");
  const uid = clean(req.data?.uid, 128);
  if (!uid) throw new HttpsError("invalid-argument", "Missing promoter.");
  await fs().collection("affiliates").doc(uid).update({ payoutHold: FieldValue.delete() });
  await log(staff.uid, "affiliate_payout_hold_cleared", { affiliateUid: uid });
  return { ok: true };
});

/* ------------------------------------------------------------------ */
/* Hearing back from Paystack                                           */
/* ------------------------------------------------------------------ */

/** Ask Paystack how a transfer ended and finish the payout to match. */
async function settle(payoutId: string, payout: any) {
  let status = "";
  try {
    const tr = await paystack<any>("get", `/transfer/verify/${encodeURIComponent(payoutId)}`);
    status = String(tr?.status || "").toLowerCase();
  } catch (e: any) {
    // Paystack has no such transfer and we never got a reply: it was never created, so release the commissions.
    if (payout.status === "processing" && /not found|no transfer|invalid/i.test(String(e?.message))) {
      await finalizePayout(payoutId, "failed", "Transfer was never created");
    } else {
      logger.warn("affiliate payout still unconfirmed", { payoutId, msg: e?.message });
    }
    return;
  }
  if (status === "success") await finalizePayout(payoutId, "paid");
  else if (status === "failed") await finalizePayout(payoutId, "failed", "Paystack couldn't send the transfer");
  else if (status === "reversed") await finalizePayout(payoutId, "reversed", "The transfer was reversed by the bank");
  // pending / otp / queued: keep waiting
}

/** Called from the Paystack webhook for transfer.success / transfer.failed / transfer.reversed. Returns true if it was ours. */
export async function handleAffiliateTransfer(event: any): Promise<boolean> {
  const ref = String(event?.data?.reference || "");
  if (!ref.startsWith("p_")) return false;
  const payout = (await fs().collection("affiliatePayouts").doc(ref).get()).data();
  if (!payout || payout.method !== "auto") return false;
  await settle(ref, payout); // re-verify with Paystack instead of trusting the webhook payload alone
  return true;
}

/** Hourly: finish any payout that is still waiting for Paystack's answer. */
export const affiliatePayoutCheck = onSchedule({ schedule: "every 60 minutes", timeZone: "Africa/Johannesburg" }, async () => {
  const cutoff = Date.now() - 30 * MINUTE;
  for (const status of ["processing", "sent"]) {
    const open = await fs().collection("affiliatePayouts").where("status", "==", status).get();
    for (const d of open.docs) {
      if (d.get("method") !== "auto") continue;
      if ((toMs(d.get("createdAt")) ?? 0) > cutoff) continue;
      try {
        await settle(d.id, d.data());
      } catch (e: any) {
        logger.error("affiliate payout check failed", { id: d.id, msg: e?.message });
      }
    }
  }
});

// Timestamp is imported for typing parity with affiliates.ts
void Timestamp;
