// services/payments.ts — app side of Paystack payments (see functions/src/paystack.ts)
import { getFunctions, httpsCallable } from "firebase/functions";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { app, auth } from "../firebaseConfig";

const functions = getFunctions(app, "us-central1");

export async function call<T = any>(name: string, data: any = {}): Promise<T> {
  if (!auth.currentUser) throw new Error("Please sign in first.");
  try {
    const res = await httpsCallable(functions, name)(data);
    return res.data as T;
  } catch (e: any) {
    // Firebase wraps server messages; surface the human-readable part
    throw new Error(e?.message?.replace(/^.*?:\s*/, "") || "Something went wrong. Please try again.");
  }
}

export type Bank = { name: string; code: string };
export type PaymentStatus = "pending" | "paid" | "failed" | "abandoned" | "review";

/** Prefix used in pay QR codes: wiji-pay:<uid> */
export const PAY_CODE_PREFIX = "wiji-pay:";
export const payCodeFor = (uid: string) => `${PAY_CODE_PREFIX}${uid}`;
export const uidFromPayCode = (value: string) =>
  value.startsWith(PAY_CODE_PREFIX) ? value.slice(PAY_CODE_PREFIX.length).trim() || null : null;

export const listBanks = () => call<Bank[]>("paystackListBanks");

export type AccountType = "cheque" | "savings" | "transmission";
/** Role (driver or business) is decided by the server from Wiji's records. */
export const registerPayee = (input: {
  businessName: string;
  accountHolder: string;
  accountType: AccountType;
  bankCode: string;
  bankName: string;
  accountNumber: string;
}) => call("paystackRegisterPayee", input);

export const removeCard = (cardId: string) => call("paystackRemoveCard", { cardId });

/** Pay with a new card through Paystack's secure checkout page. */
/** For an order, pass orderId: the server takes the amount and payee from the order. */
export async function payWithCheckout(input: { payeeUid: string; amount: number; note?: string; saveCard: boolean; orderId?: string; rideId?: string }) {
  const returnUrl = Linking.createURL("paystack-return");
  const { reference, authorizationUrl } = await call<{ reference: string; authorizationUrl: string }>(
    "paystackStartPayment",
    { ...input, callbackUrl: returnUrl }
  );
  // Opens Paystack in a secure browser tab; resolves when it redirects back or the user closes it
  await WebBrowser.openAuthSessionAsync(authorizationUrl, returnUrl);
  const { status } = await call<{ status: PaymentStatus }>("paystackConfirmPayment", { reference });
  return { reference, status };
}

/** Pay again with a saved card, no checkout page needed. */
export async function payWithSavedCard(input: { cardId: string; payeeUid: string; amount: number; note?: string; orderId?: string; rideId?: string }) {
  const res = await call<{ reference: string; status: PaymentStatus }>("paystackPayWithSavedCard", input);
  if (res.status === "pending") {
    await new Promise((r) => setTimeout(r, 2500));
    const again = await call<{ status: PaymentStatus }>("paystackConfirmPayment", { reference: res.reference });
    return { reference: res.reference, status: again.status };
  }
  return res;
}

export const formatRand = (cents: number) =>
  `R${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, " ")}`;
