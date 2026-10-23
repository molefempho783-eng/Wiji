// services/business.ts — app side of business verification (see functions/src/business.ts)
import { getFunctions, httpsCallable } from "firebase/functions";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";
import { app, auth, db, storage } from "../firebaseConfig";

const functions = getFunctions(app, "us-central1");

export type BusinessType = "informal" | "sole_proprietor" | "company" | "nonprofit";
export const BUSINESS_TYPES: { key: BusinessType; label: string; help: string }[] = [
  { key: "informal", label: "Informal / spaza", help: "Not registered with CIPC, e.g. a spaza, stall or home business" },
  { key: "sole_proprietor", label: "Sole proprietor", help: "You trade in your own name" },
  { key: "company", label: "Company (Pty) Ltd", help: "Registered with CIPC" },
  { key: "nonprofit", label: "Non-profit / NPC", help: "Registered NPC or NPO" },
];
export const needsRegistration = (t?: string) => t === "company" || t === "nonprofit";

export type BizDocKey = "ownerId" | "proofOfAddress" | "registration" | "storefront";
export type BizDocMeta = { key: BizDocKey; label: string; help: string };
export const BUSINESS_DOCS: BizDocMeta[] = [
  { key: "ownerId", label: "Owner's ID", help: "Smart ID card (both sides), green ID book or passport of the person who runs the business" },
  { key: "proofOfAddress", label: "Proof of business address", help: "Utility bill, lease or bank letter from the last 3 months" },
  { key: "registration", label: "CIPC registration document", help: "Your CoR 14.3 / registration certificate" },
  { key: "storefront", label: "Photo of the business", help: "The shop front, stall or where you trade, with the name visible if possible" },
];

export const STATUS_TEXT: Record<string, { title: string; body: string; tone: "info" | "good" | "warn" | "bad" }> = {
  not_started: { title: "Sell on Wiji", body: "Verify your business to put your shop on the map, add your menu and deals, and take orders paid by card. It takes a few minutes to send.", tone: "info" },
  draft: { title: "Finish verifying your business", body: "Customers can pay you once your business is verified.", tone: "warn" },
  changes_requested: { title: "Your business details need changes", body: "See what the Wiji team asked for below, then send again.", tone: "warn" },
  submitted: { title: "We're checking your business", body: "This usually takes 1–2 working days. We'll notify you.", tone: "info" },
  in_review: { title: "We're checking your business", body: "The Wiji team is reviewing your details now.", tone: "info" },
  verified: { title: "Verified business", body: "Your shop is on the map and customers can order and pay in Wiji.", tone: "good" },
  declined: { title: "Your business wasn't verified", body: "See the reason below. Contact Wiji support if you think this is a mistake.", tone: "bad" },
  suspended: { title: "Payments are paused", body: "The Wiji team paused payments to your business. See the reason below.", tone: "bad" },
};

export async function saveBusinessDraft(patch: Record<string, any>) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Please sign in first.");
  await setDoc(doc(db, "business_verifications", uid), { ...patch, uid, status: "draft", updatedAt: serverTimestamp() }, { merge: true });
}

export async function uploadBusinessDoc(key: BizDocKey, uri: string, mimeType = "image/jpeg") {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Please sign in first.");
  const ext = mimeType === "application/pdf" ? "pdf" : "jpg";
  const path = `business_docs/${uid}/${key}_${Date.now()}.${ext}`;
  const blob = await (await fetch(uri)).blob();
  await uploadBytes(ref(storage, path), blob, { contentType: mimeType });
  await saveBusinessDraft({ documents: { [key]: { path, contentType: mimeType, uploadedAt: serverTimestamp() } } });
  return path;
}

export async function submitBusiness() {
  try {
    return (await httpsCallable(functions, "submitBusinessVerification")({})).data;
  } catch (e: any) {
    throw new Error(e?.message?.replace(/^.*?:\s*/, "") || "Something went wrong. Please try again.");
  }
}

/** What's still missing (same rules as the server). */
export function businessProblems(app: any, hasMerchantPayout: boolean): string[] {
  const d = app?.details || {};
  const docs = app?.documents || {};
  const out: string[] = [];
  if (String(d.tradingName || "").trim().length < 2) out.push("Business name");
  if (String(d.ownerName || "").trim().split(/\s+/).length < 2) out.push("Owner's full name (first name and surname)");
  if (!BUSINESS_TYPES.some((t) => t.key === d.type)) out.push("Business type");
  if (!String(d.category || "").trim()) out.push("What you sell");
  if (String(d.address || "").trim().length < 5 || !d.addressVerified) out.push("Business address (choose it from the suggestions)");
  if (!Number.isFinite(d.location?.lat) || !Number.isFinite(d.location?.lng)) out.push("Shop location on the map");
  if (!/^(\+27|0)\d{9}$/.test(String(d.phone || "").replace(/[\s-]+/g, ""))) out.push("SA contact number, e.g. 082 123 4567");
  if (needsRegistration(d.type) && !/^\d{4}\/\d{6}\/\d{2}$/.test(String(d.cipcNumber || "").trim())) out.push("CIPC number, e.g. 2019/123456/07");
  for (const m of BUSINESS_DOCS) {
    if (m.key === "registration" && !needsRegistration(d.type)) continue;
    if (!docs[m.key]?.path) out.push(m.label);
  }
  if (!hasMerchantPayout) out.push("Payout bank account (Wallet → Set up payouts)");
  return out;
}
