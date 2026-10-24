// services/groupSubscriptions.ts — app side of paid group chats (see functions/src/groupSubscriptions.ts)
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { Timestamp } from "firebase/firestore";
import { call, formatRand, PaymentStatus } from "./payments";

export type SubscriptionInterval = "monthly" | "yearly";

/** Stored on the group doc as `subscription`. */
export type GroupSubscriptionSettings = {
  enabled: boolean;
  interval: SubscriptionInterval;
  priceCents: number;
  currency: "ZAR";
};

/** groupSubscriptions/{communityId}_{groupId}_{uid} (written only by Cloud Functions). */
export type GroupSubscription = {
  uid: string;
  communityId: string;
  groupId: string;
  groupName?: string;
  creatorUid: string;
  interval: SubscriptionInterval;
  priceCents: number;
  status: "active" | "past_due" | "expired" | "ended";
  autoRenew: boolean;
  cardId?: string | null;
  currentPeriodEnd?: Timestamp;
  lastFailure?: string;
};

export const GROUP_SUB_MIN_RAND = 5;
export const GROUP_SUB_MAX_RAND = 20000;

export const subscriptionDocId = (communityId: string, groupId: string, uid: string) => `${communityId}_${groupId}_${uid}`;

/** The group's settings if it's a paid group, otherwise null. */
export function paidGroupSettings(data: any): GroupSubscriptionSettings | null {
  const s = data?.subscription;
  if (!s?.enabled || !Number.isFinite(Number(s.priceCents))) return null;
  return { enabled: true, interval: s.interval === "yearly" ? "yearly" : "monthly", priceCents: Number(s.priceCents), currency: "ZAR" };
}

export const perLabel = (interval: SubscriptionInterval) => (interval === "yearly" ? "year" : "month");
/** "R50/month" */
export const priceLabel = (s: { priceCents: number; interval: SubscriptionInterval }) => `${formatRand(s.priceCents)}/${perLabel(s.interval)}`;

export const formatDate = (t?: Timestamp | Date | null) => {
  const d = t instanceof Date ? t : t?.toDate?.();
  return d ? d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "";
};

/** Has paid time left (past_due still has access during the grace period). */
export const hasAccess = (sub?: GroupSubscription | null) =>
  !!sub && (sub.status === "active" || sub.status === "past_due");

type StartResult =
  | { status: "active"; alreadyActive: true; currentPeriodEnd: string }
  | { reference: string; status: PaymentStatus }
  | { reference: string; authorizationUrl: string };

/**
 * Subscribe to a paid group. With cardId, charges that saved card; otherwise opens Paystack checkout.
 * Resolves with the final status ("paid" means the member is in the group).
 */
export async function subscribeToGroup(input: {
  communityId: string;
  groupId: string;
  autoRenew: boolean;
  cardId?: string | null;
  payAhead?: boolean;
}): Promise<{ status: PaymentStatus | "active"; reference?: string }> {
  const returnUrl = Linking.createURL("paystack-return");
  const res = await call<StartResult>("groupSubStart", { ...input, cardId: input.cardId || undefined, callbackUrl: returnUrl });
  if ("alreadyActive" in res) return { status: "active" };
  if ("authorizationUrl" in res) {
    await WebBrowser.openAuthSessionAsync(res.authorizationUrl, returnUrl);
    const { status } = await call<{ status: PaymentStatus }>("paystackConfirmPayment", { reference: res.reference });
    return { status, reference: res.reference };
  }
  if (res.status === "pending") {
    await new Promise((r) => setTimeout(r, 2500));
    const again = await call<{ status: PaymentStatus }>("paystackConfirmPayment", { reference: res.reference });
    return { status: again.status, reference: res.reference };
  }
  return res;
}

export const setGroupAutoRenew = (input: { communityId: string; groupId: string; autoRenew: boolean; cardId?: string }) =>
  call<{ ok: true; autoRenew: boolean }>("groupSubSetAutoRenew", input);
