// functions/src/business.ts
// Business verification. A business (Paystack payee with role "merchant") can only be paid in
// Wiji once the Wiji team has checked who runs it. The owner fills in details and uploads
// documents in the app (draft); these functions are the only way verification moves forward:
// draft -> submitted -> in_review -> verified / declined / changes requested; verified <-> suspended.
// Every staff action is written to businessReviewLog.
import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { requireStaff } from "./staff.js";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getStorage } from "firebase-admin/storage";

const fs = () => getFirestore();

export const BUSINESS_TYPES = ["informal", "sole_proprietor", "company", "nonprofit"] as const;
const NEEDS_REGISTRATION = ["company", "nonprofit"];
const DOC_LABELS: Record<string, string> = {
  ownerId: "owner's ID",
  proofOfAddress: "proof of business address",
  registration: "CIPC registration document",
  storefront: "photo of the business",
};

function requireUser(req: CallableRequest<any>) {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");
  return uid;
}


async function pushTo(uids: string[], title: string, body: string, data: Record<string, string> = {}) {
  try {
    const tokens: string[] = [];
    for (const uid of uids) {
      const u = await fs().collection("users").doc(uid).get();
      for (const t of u.get("fcmTokens") || []) if (typeof t === "string" && t) tokens.push(t);
    }
    if (!tokens.length) return;
    await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data,
      android: { priority: "high", notification: { channelId: "default" } },
    });
  } catch (e: any) {
    logger.warn("business push failed", e?.message);
  }
}

const staffUids = async () => (await fs().collection("safetyTeam").get()).docs.map((d) => d.id);

async function log(uid: string, staffUid: string | null, action: string, details: Record<string, unknown> = {}) {
  await fs().collection("businessReviewLog").add({ uid, staffUid, action, ...details, at: FieldValue.serverTimestamp() });
}

/** Public shop profile shown on the map (businesses/{uid}). Owner settings are kept on re-publish. */
async function publishBusiness(uid: string, app: any, active: boolean) {
  const db = fs();
  const d = app.details || {};
  const ref = db.collection("businesses").doc(uid);
  const existing = (await ref.get()).data();
  let coverPath: string | null = existing?.coverPath || null;
  const storefront = app.documents?.storefront;
  if (storefront?.path && storefront.contentType !== "application/pdf") {
    try {
      const bucket = getStorage().bucket();
      coverPath = `business_public/${uid}/cover.jpg`;
      await bucket.file(storefront.path).copy(bucket.file(coverPath));
    } catch (e: any) {
      logger.warn("cover copy failed", e?.message);
    }
  }
  await ref.set(
    {
      ownerId: uid,
      name: String(d.tradingName || "").trim(),
      category: String(d.category || "").trim(),
      type: d.type || null,
      address: String(d.address || "").trim(),
      location: { lat: d.location.lat, lng: d.location.lng },
      latitude: d.location.lat,
      longitude: d.location.lng,
      coverPath,
      verified: true,
      active,
      updatedAt: FieldValue.serverTimestamp(),
      ...(existing ? {} : { isOpen: true, collectEnabled: true, deliveryEnabled: false, deliveryFeeCents: 0, createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true }
  );
}

/* ---------- Business owner: submit for verification ---------- */
export const submitBusinessVerification = onCall({}, async (req) => {
  const uid = requireUser(req);
  const db = fs();
  const ref = db.collection("business_verifications").doc(uid);
  const app = (await ref.get()).data();
  if (!app) throw new HttpsError("not-found", "Fill in your business details first.");
  if (app.status !== "draft") throw new HttpsError("failed-precondition", "This has already been submitted.");

  const d = app.details || {};
  const docs = app.documents || {};
  const missing: string[] = [];
  if (String(d.tradingName || "").trim().length < 2) missing.push("business name");
  if (String(d.ownerName || "").trim().split(/\s+/).length < 2) missing.push("owner's full name");
  if (!BUSINESS_TYPES.includes(d.type)) missing.push("business type");
  if (!String(d.category || "").trim()) missing.push("what the business sells");
  if (String(d.address || "").trim().length < 5 || d.addressVerified !== true) missing.push("business address (choose it from the suggestions)");
  const loc = d.location || {};
  if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng) || Math.abs(loc.lat) > 90 || Math.abs(loc.lng) > 180) missing.push("business location on the map");
  if (!/^(\+27|0)\d{9}$/.test(String(d.phone || "").replace(/[\s-]+/g, ""))) missing.push("SA contact number");
  if (NEEDS_REGISTRATION.includes(d.type)) {
    if (!/^\d{4}\/\d{6}\/\d{2}$/.test(String(d.cipcNumber || "").trim())) missing.push("CIPC registration number (e.g. 2019/123456/07)");
    if (!docs.registration?.path) missing.push(DOC_LABELS.registration);
  }
  for (const k of ["ownerId", "proofOfAddress", "storefront"]) if (!docs[k]?.path) missing.push(DOC_LABELS[k]);
  const payee = (await db.collection("payees").doc(uid).get()).data();
  if (!payee?.subaccountCode) missing.push("payout bank account (Wallet → Set up payouts)");
  if (missing.length) throw new HttpsError("failed-precondition", `Still needed: ${missing.join(", ")}.`);

  await ref.update({ status: "submitted", submittedAt: FieldValue.serverTimestamp(), decision: FieldValue.delete() });
  await db.collection("payees").doc(uid).set({ verification: "submitted", verified: false }, { merge: true });
  await log(uid, null, "submitted");
  await pushTo(await staffUids(), "New business to verify", `${String(d.tradingName).trim()} submitted their details.`, { type: "admin", kind: "business", uid });
  return { ok: true };
});

/* ---------- Wiji team: review a business ---------- */
export const reviewBusinessVerification = onCall({}, async (req) => {
  const staff = await requireStaff(req);
  const { uid, action, reason } = (req.data || {}) as Record<string, string>;
  if (!uid) throw new HttpsError("invalid-argument", "uid required");
  if (uid === staff.uid) throw new HttpsError("permission-denied", "You can't review your own business.");
  const db = fs();
  const ref = db.collection("business_verifications").doc(uid);
  const app = (await ref.get()).data();
  if (!app) throw new HttpsError("not-found", "Business not found.");
  const why = String(reason || "").trim();
  const name = String(app.details?.tradingName || "Your business");
  const payeeRef = db.collection("payees").doc(uid);
  const waiting = ["submitted", "in_review"].includes(app.status);
  const decision = (outcome: string) => ({ outcome, by: staff.uid, at: Timestamp.now(), reason: why.slice(0, 1000) });

  switch (action) {
    case "startReview":
      if (app.status !== "submitted") throw new HttpsError("failed-precondition", "This isn't waiting for review.");
      await ref.update({ status: "in_review", reviewer: staff.uid });
      await log(uid, staff.uid, "startReview");
      return { ok: true };

    case "approve":
      if (!waiting) throw new HttpsError("failed-precondition", "This isn't waiting for review.");
      await ref.update({ status: "verified", verifiedAt: FieldValue.serverTimestamp(), decision: decision("verified") });
      await payeeRef.set({ role: "merchant", businessName: String(app.details?.tradingName || name), verified: true, verification: "verified", verifiedAt: FieldValue.serverTimestamp() }, { merge: true });
      await publishBusiness(uid, app, true);
      await log(uid, staff.uid, "verified");
      await pushTo([uid], `${name} is verified on Wiji`, "Your shop is now on the map. Add your menu and deals to start selling.", { type: "business" });
      return { ok: true };

    case "decline":
    case "requestChanges": {
      if (!waiting) throw new HttpsError("failed-precondition", "This isn't waiting for review.");
      if (why.length < 10) throw new HttpsError("invalid-argument", "Give the owner a clear reason (at least a sentence).");
      const declined = action === "decline";
      await ref.update({ status: declined ? "declined" : "draft", decision: decision(declined ? "declined" : "changes_requested") });
      await payeeRef.set({ verified: false, verification: declined ? "declined" : "changes_requested" }, { merge: true });
      await log(uid, staff.uid, declined ? "declined" : "changesRequested", { reason: why });
      await pushTo(
        [uid],
        declined ? "Your business wasn't verified" : "Your business details need changes",
        "Open Wiji to see why and what to do next.",
        { type: "business" }
      );
      return { ok: true };
    }

    case "suspend":
      if (app.status !== "verified") throw new HttpsError("failed-precondition", "Only verified businesses can be suspended.");
      if (why.length < 10) throw new HttpsError("invalid-argument", "Write down why (at least a sentence).");
      await ref.update({ status: "suspended", decision: decision("suspended") });
      await payeeRef.set({ verified: false, verification: "suspended" }, { merge: true });
      await fs().collection("businesses").doc(uid).set({ active: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await log(uid, staff.uid, "suspended", { reason: why });
      await pushTo([uid], "Payments to your business are paused", "Open Wiji to see why.", { type: "business" });
      return { ok: true };

    case "reinstate":
      if (app.status !== "suspended") throw new HttpsError("failed-precondition", "This business isn't suspended.");
      await ref.update({ status: "verified", decision: decision("reinstated") });
      await payeeRef.set({ role: "merchant", verified: true, verification: "verified" }, { merge: true });
      await fs().collection("businesses").doc(uid).set({ active: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await log(uid, staff.uid, "reinstated", { reason: why });
      await pushTo([uid], "Payments to your business are back on", "Customers can pay you in Wiji again.", { type: "business" });
      return { ok: true };
  }
  throw new HttpsError("invalid-argument", "Unknown action.");
});
