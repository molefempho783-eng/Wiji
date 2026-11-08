// Wiji promoter (affiliate) programme: shared helpers for the app.
// The rules and payouts live in Cloud Functions (functions/src/affiliates.ts).
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebaseConfig";

export const SITE = "https://communitychat-f3fb0.web.app";

// Keep in step with functions/.env (AFFILIATE_*) and admin-web/js/affiliate/portal.js
export const PROGRAM = { rate: 20, holdDays: 30, payerDays: 90, payeeDays: 180, minPayoutRand: 200, claimDays: 7 };

export const PROMOTER_PAGE = `${SITE}/promoters/`;
export const PROMOTER_TERMS_URL = `${SITE}/promoters/terms/`;
export const TERMS_URL = `${SITE}/terms/`;
export const PRIVACY_URL = `${SITE}/privacy/`;

export type AffiliateStatus = "pending" | "approved" | "declined" | "frozen";

export const promoterLink = (code: string) => `${SITE}/r/${code}/`;
export const cleanCode = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15);
export const zar = (cents: number) =>
  `R${(Number(cents || 0) / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const millis = (v: any): number | null => (v?.toMillis ? v.toMillis() : v?.seconds ? v.seconds * 1000 : typeof v === "number" ? v : null);

/** Totals for a promoter's commissions. */
export function summarise(entries: any[], now = Date.now()) {
  const t = { waiting: 0, ready: 0, paid: 0, checking: 0, paying: 0 };
  for (const e of entries) {
    const c = Number(e.commissionCents) || 0;
    if (e.status === "paid") t.paid += c;
    else if (e.status === "pending") ((millis(e.availableAt) ?? Infinity) <= now ? (t.ready += c) : (t.waiting += c));
    else if (e.status === "flagged" || e.status === "held") t.checking += c;
    else if (e.status === "processing") t.paying += c;
  }
  return t;
}

/** Where a commission stands, in plain words, with a tone for its colour. */
export function entryState(e: any, now = Date.now()): { label: string; tone: "good" | "bad" | "warn" | "info" | "muted" } {
  if (e.status === "paid") return { label: "Paid", tone: "good" };
  if (e.status === "reversed") return { label: "Cancelled", tone: "bad" };
  if (e.status === "processing") return { label: "Being sent", tone: "info" };
  if (e.status === "flagged") return { label: "Being checked", tone: "warn" };
  if (e.status === "held") return { label: "On hold", tone: "warn" };
  return (millis(e.availableAt) ?? Infinity) <= now ? { label: "Ready to pay", tone: "info" } : { label: "Waiting", tone: "muted" };
}

export const entryDate = (v: any) => {
  const ms = millis(v);
  return ms ? new Date(ms).toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) : "";
};

export async function applyToPromote(data: { name: string; code: string; channels: string; audience: string; acceptTerms: boolean }) {
  try {
    return (await httpsCallable(functions, "affiliateApply")(data)).data as { ok: boolean; code: string };
  } catch (e: any) {
    throw new Error(String(e?.message || "Something went wrong.").replace(/^.*?:\s*/, ""));
  }
}

/** A new user adds the code of the promoter who told them about Wiji (allowed in their first PROGRAM.claimDays days). */
export async function claimPromoterCode(code: string) {
  try {
    return (await httpsCallable(functions, "affiliateClaimReferral")({ code })).data as { ok: boolean; name?: string };
  } catch (e: any) {
    throw new Error(String(e?.message || "Something went wrong.").replace(/^.*?:\s*/, ""));
  }
}
