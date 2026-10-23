// functions/src/drivers.ts
// Wiji Rides, phase 1: driver registration and verification.
// Drivers fill in their application in the app (draft). These functions are the ONLY way an
// application moves forward: submit -> in review -> approved / declined / changes requested.
// Every staff action is written to driverReviewLog for accountability.
//
// Env (functions/.env):
//   SAFETY_ADMIN_EMAILS=you@example.com   (comma-separated; may grant safety-team roles)
import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { requireStaff, staffRole } from "./staff.js";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { getMessaging } from "firebase-admin/messaging";

const fs = () => getFirestore(); // lazy: admin app is initialised in index.ts

/* ---------- What a complete application needs ---------- */
export const REQUIRED_DOCS = [
  "idDocument",
  "selfie",
  "licence",
  "prdp",
  "proofOfAddress",
  "licenceDisc",
  "roadworthy",
  "insurance",
  "operatingLicence",
  "carFront",
  "carBack",
  "carLeft",
  "carRight",
] as const;
/** Documents with an expiry date the driver must enter (operating licence may be an application receipt). */
const EXPIRING_DOCS = ["licence", "prdp", "licenceDisc", "roadworthy", "insurance"] as const;
export const CHECKS = ["identity", "licence", "prdp", "criminalRecord", "vehicle", "insurance", "operatingLicence"] as const;
type Check = (typeof CHECKS)[number];

function requireUser(req: CallableRequest<any>) {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");
  return uid;
}


/** South African ID number: 13 digits with a valid Luhn check digit. */
export function isValidSaId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let d = Number(id.charAt(12 - i));
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** A real calendar date (no 31 Feb), after today, and within 10 years. Dates are compared in SA time. */
function isValidExpiry(s: unknown) {
  const m = typeof s === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return false;
  const todaySA = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
  return (s as string) > todaySA && y <= new Date().getUTCFullYear() + 10;
}

const DOC_LABELS: Record<string, string> = {
  idDocument: "ID document",
  selfie: "live selfie",
  licence: "driver's licence",
  prdp: "PrDP",
  proofOfAddress: "proof of address",
  licenceDisc: "licence disc",
  roadworthy: "roadworthy certificate",
  insurance: "insurance",
  operatingLicence: "operating licence",
  carFront: "car photo (front)",
  carBack: "car photo (back)",
  carLeft: "car photo (left)",
  carRight: "car photo (right)",
};

async function log(uid: string, staffUid: string | null, action: string, details: Record<string, unknown> = {}) {
  await fs().collection("driverReviewLog").add({ uid, staffUid, action, ...details, at: FieldValue.serverTimestamp() });
}

async function notify(uid: string, title: string, body: string, data: Record<string, string> = {}) {
  try {
    const user = await fs().collection("users").doc(uid).get();
    const tokens: string[] = (user.get("fcmTokens") || []).filter((t: unknown) => typeof t === "string" && t);
    if (!tokens.length) return;
    await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: { type: "driver", ...data },
      android: { priority: "high", notification: { channelId: "default" } },
    });
  } catch (e: any) {
    logger.warn("driver notify failed", { uid, msg: e?.message });
  }
}

/** Push to everyone on the Wiji team (safetyTeam collection). */
async function notifyStaff(title: string, body: string, data: Record<string, string> = {}) {
  const team = await fs().collection("safetyTeam").get().catch(() => null);
  await Promise.all((team?.docs || []).map((d) => notify(d.id, title, body, { type: "staff_driver", ...data })));
}

/** Today in South Africa as YYYY-MM-DD. */
const saDay = (ms: number) => new Date(ms + 2 * 3600e3).toISOString().slice(0, 10);

/** Which documents (and car details) each check depends on. If none of them changed in a
 *  re-verification, the previous "passed" result is kept so the team only re-checks what's new. */
const CHECK_DOCS: Record<Check, string[]> = {
  identity: ["idDocument", "selfie", "proofOfAddress"],
  licence: ["licence"],
  prdp: ["prdp"],
  criminalRecord: [],
  vehicle: ["licenceDisc", "roadworthy", "carFront", "carBack", "carLeft", "carRight", "vehicle"],
  insurance: ["insurance"],
  operatingLicence: ["operatingLicence"],
};

/* ---------- Driver: submit a finished application ---------- */
export const submitDriverApplication = onCall({}, async (req) => {
  const uid = requireUser(req);
  const ref = fs().collection("driver_applications").doc(uid);
  const app = (await ref.get()).data();
  if (!app) throw new HttpsError("not-found", "Start your application first.");
  if (app.status !== "draft") throw new HttpsError("failed-precondition", "This application has already been submitted.");

  const missing: string[] = [];
  const p = app.personal || {};
  if (!p.fullName || String(p.fullName).trim().split(/\s+/).length < 2) missing.push("full name");
  if (p.idType === "passport" ? !/^[A-Z0-9]{6,12}$/i.test(p.idNumber || "") : !isValidSaId(String(p.idNumber || ""))) missing.push("valid ID number");
  if (!/^(\+27|0)\d{9}$/.test(String(p.phone || "").replace(/[\s-]+/g, ""))) missing.push("SA mobile number");
  if (!String(p.homeArea || "").trim() || !Number.isFinite(p.homeAreaLocation?.lat)) missing.push("area you'll drive in (choose it from the suggestions)");
  const v = app.vehicle || {};
  for (const k of ["make", "model", "colour"]) if (!String(v[k] || "").trim()) missing.push(`car ${k}`);
  const year = Number(v.year);
  if (!/^\d{4}$/.test(String(v.year || "")) || year < 1990 || year > new Date().getUTCFullYear() + 1) missing.push("valid car year");
  if (!/^[A-Z0-9]{2,10}$/i.test(String(v.plate || "").replace(/[\s-]/g, ""))) missing.push("valid number plate");
  const docs = app.documents || {};
  for (const d of REQUIRED_DOCS) if (!docs[d]?.path) missing.push(DOC_LABELS[d] || d);
  for (const d of EXPIRING_DOCS) if (docs[d]?.path && !isValidExpiry(docs[d]?.expiry)) missing.push(`valid expiry date for ${DOC_LABELS[d] || d}`);
  if (docs.operatingLicence?.expiry && !isValidExpiry(docs.operatingLicence.expiry)) missing.push("valid expiry date for operating licence");
  if (!app.consents?.backgroundCheck || !app.consents?.dataUse || !app.consents?.codeOfConduct) missing.push("consents");
  if (!app.induction?.passed) missing.push("safety induction");
  if (missing.length) throw new HttpsError("failed-precondition", `Still needed: ${missing.join(", ")}.`);

  const checks: Record<string, unknown> = {};
  const reverify = !!app.reverify && !!app.lastApproved;
  const changed: string[] = [];
  if (reverify) {
    const before = app.lastApproved || {};
    for (const d of REQUIRED_DOCS) {
      const a = before.documents?.[d] || {};
      const b = docs[d] || {};
      if (a.path !== b.path || (a.expiry || "") !== (b.expiry || "")) changed.push(d);
    }
    const carKeys = ["make", "model", "colour", "year", "plate"];
    if (carKeys.some((k) => String(before.vehicle?.[k] ?? "") !== String(v[k] ?? ""))) changed.push("vehicle");
    if (!changed.length) throw new HttpsError("failed-precondition", "You haven't changed anything yet. Upload the new document first.");
    // The annual criminal record check is redone when it's due within 30 days
    const drv = (await fs().collection("drivers").doc(uid).get()).data() || {};
    const recheckDue = !drv.nextCheckDue || drv.nextCheckDue <= saDay(Date.now() + 30 * 864e5);
    for (const c of CHECKS) {
      const prev = app.checks?.[c];
      const deps = CHECK_DOCS[c];
      const unchanged = c === "criminalRecord" ? !recheckDue : deps.every((d) => !changed.includes(d));
      checks[c] = unchanged && prev?.result === "passed" ? { ...prev, carriedOver: true } : { result: "pending" };
    }
  } else {
    for (const c of CHECKS) checks[c] = { result: "pending" };
  }
  await ref.update({
    status: "submitted",
    submittedAt: FieldValue.serverTimestamp(),
    checks,
    decision: FieldValue.delete(),
    ...(reverify ? { changedDocs: changed } : {}),
  });
  await log(uid, null, reverify ? "resubmitted" : "submitted", reverify ? { changed } : {});
  const name = String(app.personal?.fullName || "A driver");
  await notifyStaff(
    reverify ? "Driver documents to re-check" : "New driver application",
    reverify ? `${name} sent updated documents: ${changed.map((d) => DOC_LABELS[d] || "car details").join(", ")}.` : `${name} applied to drive.`,
    { uid }
  );
  return { ok: true };
});

/* ---------- Safety team: review an application ---------- */
export const reviewDriverApplication = onCall({}, async (req) => {
  const staff = await requireStaff(req);
  const { uid, action, check, result, note, reason } = (req.data || {}) as Record<string, string>;
  if (!uid) throw new HttpsError("invalid-argument", "uid required");
  const db = fs();
  const ref = db.collection("driver_applications").doc(uid);
  const snap = await ref.get();
  const app = snap.data();
  if (!app) throw new HttpsError("not-found", "Application not found.");
  if (uid === staff.uid) throw new HttpsError("permission-denied", "You can't review your own application.");
  const reviewable = ["submitted", "in_review"].includes(app.status);

  if (action === "setCheck") {
    if (!reviewable) throw new HttpsError("failed-precondition", "This application isn't waiting for review.");
    if (!CHECKS.includes(check as Check)) throw new HttpsError("invalid-argument", "Unknown check.");
    if (!["passed", "failed", "pending"].includes(result)) throw new HttpsError("invalid-argument", "Result must be passed, failed or pending.");
    if (result === "failed" && !String(note || "").trim()) throw new HttpsError("invalid-argument", "Write down why the check failed.");
    await ref.update({
      status: "in_review",
      [`checks.${check}`]: { result, note: String(note || "").slice(0, 500), by: staff.uid, at: Timestamp.now() },
    });
    await log(uid, staff.uid, "setCheck", { check, result, note: note || "" });
    return { ok: true };
  }

  if (action === "approve") {
    if (!reviewable) throw new HttpsError("failed-precondition", "This application isn't waiting for review.");
    const notPassed = CHECKS.filter((c) => app.checks?.[c]?.result !== "passed");
    if (notPassed.length) throw new HttpsError("failed-precondition", `These checks haven't passed yet: ${notPassed.join(", ")}.`);

    // Publish the verified selfie as the driver's public photo
    let photoPath: string | null = null;
    try {
      const bucket = getStorage().bucket();
      const from = app.documents?.selfie?.path;
      if (from) {
        photoPath = `driver_public/${uid}/photo.jpg`;
        await bucket.file(from).copy(bucket.file(photoPath));
      }
    } catch (e: any) {
      logger.warn("photo copy failed", e?.message);
      photoPath = null;
    }

    const docExpiries: Record<string, string> = {};
    for (const d of [...EXPIRING_DOCS, "operatingLicence"]) if (app.documents?.[d]?.expiry) docExpiries[d] = app.documents[d].expiry;
    const existing = (await db.collection("drivers").doc(uid).get()).data();
    const due = new Date();
    due.setFullYear(due.getFullYear() + 1);
    // Re-verification that didn't redo the criminal record check keeps the old re-check date
    const nextCheckDue = app.checks?.criminalRecord?.carriedOver && existing?.nextCheckDue ? existing.nextCheckDue : due.toISOString().slice(0, 10);
    // A driver paused by the safety team stays paused; a pause for expired documents is lifted
    const keepSuspended = existing?.status === "suspended";

    await db.collection("drivers").doc(uid).set(
      {
        uid,
        firstName: String(app.personal.fullName).trim().split(/\s+/)[0],
        photoPath,
        vehicle: {
          make: app.vehicle.make,
          model: app.vehicle.model,
          colour: app.vehicle.colour,
          plate: String(app.vehicle.plate).toUpperCase(),
          year: app.vehicle.year,
        },
        status: keepSuspended ? "suspended" : "active",
        verified: true,
        verifiedAt: FieldValue.serverTimestamp(),
        nextCheckDue,
        docExpiries,
        expiryReminders: FieldValue.delete(),
        ...(keepSuspended ? {} : { pausedReason: FieldValue.delete(), pausedForExpiry: FieldValue.delete() }),
        trips: FieldValue.increment(0),
      },
      { merge: true }
    );
    await ref.update({
      status: "approved",
      approvedAt: FieldValue.serverTimestamp(),
      reverify: FieldValue.delete(),
      lastApproved: FieldValue.delete(),
      changedDocs: FieldValue.delete(),
      decision: { outcome: "approved", by: staff.uid, at: Timestamp.now(), reason: String(reason || "") },
    });
    await log(uid, staff.uid, app.reverify ? "reverified" : "approved");
    if (app.reverify) await notify(uid, "Your updated documents are approved", keepSuspended ? "Your documents are up to date. Your account is still paused by the safety team." : "Your documents are up to date. You can keep driving on Wiji.");
    else await notify(uid, "You're approved to drive on Wiji", "Your checks are complete. Set up payouts in the Wallet to get paid.");
    return { ok: true };
  }

  if (action === "decline" || action === "requestChanges") {
    const why = String(reason || "").trim();
    if (why.length < 10) throw new HttpsError("invalid-argument", "Give the applicant a clear reason (at least a sentence).");
    if (!reviewable) throw new HttpsError("failed-precondition", "This application isn't waiting for review.");
    const declined = action === "decline";
    await ref.update({
      status: declined ? "declined" : "draft",
      decision: { outcome: declined ? "declined" : "changes_requested", by: staff.uid, at: Timestamp.now(), reason: why.slice(0, 1000) },
    });
    if (declined && app.reverify) {
      await db.collection("drivers").doc(uid).set({ status: "paused", pausedReason: `Updated documents not approved: ${why.slice(0, 300)}`, pausedAt: FieldValue.serverTimestamp() }, { merge: true });
      await db.collection("drivers_live").doc(uid).delete().catch(() => undefined);
    }
    await log(uid, staff.uid, declined ? "declined" : "changesRequested", { reason: why });
    await notify(
      uid,
      declined ? "Your driver application was not approved" : "Your driver application needs changes",
      declined ? "Open Wiji to see the reason and how to ask for a review." : "Open Wiji to see what to update, then submit again."
    );
    return { ok: true };
  }

  throw new HttpsError("invalid-argument", "Unknown action.");
});

/* ---------- Driver: update documents after being approved (renewals) ---------- */
// Reopens the approved application for editing. The driver keeps driving (unless something has
// expired) while the team checks what changed. The approved documents are kept so the update can be
// cancelled and so only changed documents need re-checking.
export const reopenDriverApplication = onCall({}, async (req) => {
  const uid = requireUser(req);
  const ref = fs().collection("driver_applications").doc(uid);
  const app = (await ref.get()).data();
  if (!app) throw new HttpsError("not-found", "No driver application found.");
  if (app.status === "draft" && app.reverify) return { ok: true };
  if (app.status !== "approved") throw new HttpsError("failed-precondition", "You can update your documents once you're an approved driver.");
  await ref.update({
    status: "draft",
    reverify: true,
    reopenedAt: FieldValue.serverTimestamp(),
    lastApproved: { documents: app.documents || {}, vehicle: app.vehicle || {}, checks: app.checks || {}, decision: app.decision || null },
  });
  await log(uid, null, "reopenedForUpdate");
  return { ok: true };
});

/** Driver: stop updating and go back to the approved documents. */
export const cancelDriverUpdate = onCall({}, async (req) => {
  const uid = requireUser(req);
  const ref = fs().collection("driver_applications").doc(uid);
  const app = (await ref.get()).data();
  if (!app?.reverify || !app.lastApproved) throw new HttpsError("failed-precondition", "There's no update to cancel.");
  if (app.status !== "draft") throw new HttpsError("failed-precondition", "Your update is already with the safety team.");
  await ref.update({
    status: "approved",
    documents: app.lastApproved.documents || {},
    vehicle: app.lastApproved.vehicle || {},
    checks: app.lastApproved.checks || {},
    decision: app.lastApproved.decision || FieldValue.delete(),
    reverify: FieldValue.delete(),
    lastApproved: FieldValue.delete(),
    changedDocs: FieldValue.delete(),
  });
  await log(uid, null, "updateCancelled");
  return { ok: true };
});

/* ---------- Admin: give someone a safety-team role ---------- */
export const grantSafetyRole = onCall({}, async (req) => {
  const callerUid = requireUser(req);
  const callerEmail = String((req.auth?.token as any)?.email || "").toLowerCase();
  const callerRole = await staffRole(callerUid);
  const bootstrap = String(process.env.SAFETY_ADMIN_EMAILS || "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (callerRole !== "admin" && !bootstrap.includes(callerEmail)) {
    throw new HttpsError("permission-denied", "Only admins can grant safety-team roles.");
  }
  const { email, role } = (req.data || {}) as Record<string, string>;
  if (!["safety", "admin", "none"].includes(role)) throw new HttpsError("invalid-argument", "Role must be safety, admin or none.");
  const target = await getAuth().getUserByEmail(String(email || "").trim()).catch(() => null);
  if (!target) throw new HttpsError("not-found", "No Wiji account uses that email.");
  // Clean up the old custom-claim role if this account had one (roles now live in safetyTeam/{uid})
  if ((target.customClaims as any)?.role) {
    const { role: _old, ...rest } = target.customClaims as Record<string, unknown>;
    await getAuth().setCustomUserClaims(target.uid, rest);
  }
  // The Wiji team list: grants access and is used to alert them about emergencies and reports
  const teamRef = fs().collection("safetyTeam").doc(target.uid);
  if (role === "none") await teamRef.delete().catch(() => undefined);
  else await teamRef.set({ email: target.email || "", role, updatedAt: FieldValue.serverTimestamp() });
  await log(target.uid, callerUid, "roleChanged", { role });
  return { ok: true, uid: target.uid, role };
});

/* ---------- Daily: expiring documents ---------- */
// Drivers get a reminder 30, 7 and 1 day(s) before a document expires (once each). On the day
// after it expires the account is paused and taken offline. The Wiji team gets a push for every
// pause and a daily summary of documents expiring within 7 days; the admin website shows both.
const EXPIRY_LABELS: Record<string, string> = { ...DOC_LABELS, annualRecheck: "annual re-check" };
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5);

export const checkDriverDocumentExpiry = onSchedule({ schedule: "every day 06:00", timeZone: "Africa/Johannesburg" }, async () => {
  const db = fs();
  const today = saDay(Date.now());
  const snap = await db.collection("drivers").where("status", "==", "active").get();
  const soonForStaff: string[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    const name = String(data.firstName || "A driver");
    const expiries: Record<string, string> = { ...(data.docExpiries || {}) };
    if (data.nextCheckDue) expiries.annualRecheck = data.nextCheckDue;
    const expired = Object.entries(expiries).filter(([, date]) => date < today).map(([k]) => k);

    if (expired.length) {
      const what = expired.map((k) => EXPIRY_LABELS[k] || k).join(", ");
      await d.ref.update({ status: "paused", pausedReason: `Expired: ${what}. Update your documents to drive again.`, pausedForExpiry: expired, pausedAt: FieldValue.serverTimestamp() });
      await db.collection("drivers_live").doc(d.id).delete().catch(() => undefined);
      await log(d.id, null, "pausedForExpiry", { expired });
      await notify(d.id, "Your Wiji driver account is paused", `Your ${what} expired. Go to Profile → My documents and upload the renewed one to drive again.`, { screen: "DriverApplicationScreen" });
      await notifyStaff("Driver paused: document expired", `${name}'s ${what} expired. They've been taken offline.`, { uid: d.id });
      continue;
    }

    // Reminders: one each at 30, 7 and 1 day(s) left, per document and expiry date
    const sent: Record<string, string> = { ...(data.expiryReminders || {}) };
    const due: string[] = [];
    for (const [k, date] of Object.entries(expiries)) {
      const left = daysBetween(today, date);
      const bucket = left <= 1 ? 1 : left <= 7 ? 7 : left <= 30 ? 30 : null;
      if (left <= 7) soonForStaff.push(`${name}: ${EXPIRY_LABELS[k] || k} (${date})`);
      if (!bucket || sent[k] === `${date}:${bucket}`) continue;
      sent[k] = `${date}:${bucket}`;
      due.push(`${EXPIRY_LABELS[k] || k} expires ${left <= 0 ? "today" : left === 1 ? "tomorrow" : `in ${left} days`} (${date})`);
    }
    if (due.length) {
      await d.ref.update({ expiryReminders: sent });
      await notify(d.id, due.length > 1 ? "Driver documents expire soon" : "A driver document expires soon", `${due.join("; ")}. Upload the renewed one in Profile → My documents so you can keep driving.`, { screen: "DriverApplicationScreen" });
    }
  }
  if (soonForStaff.length) {
    await notifyStaff(
      `${soonForStaff.length} driver document${soonForStaff.length > 1 ? "s" : ""} expire within 7 days`,
      soonForStaff.slice(0, 5).join(" · ") + (soonForStaff.length > 5 ? ` and ${soonForStaff.length - 5} more` : ""),
      {}
    );
  }
});
