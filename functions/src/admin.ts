// functions/src/admin.ts
// Back end for the Wiji admin website (admin-web/): analytics and handling alerts.
// Only staff (custom claim role = "safety" or "admin") can call these.
import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { requireStaff } from "./staff.js";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, Timestamp, Query } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const fs = () => getFirestore();
const DAY = 864e5;
const SA_OFFSET = 2 * 3600e3; // South Africa is UTC+2 all year


async function notify(uid: string, title: string, body: string, data: Record<string, string> = {}) {
  try {
    const u = await fs().collection("users").doc(uid).get();
    const tokens: string[] = (u.get("fcmTokens") || []).filter((t: unknown) => typeof t === "string" && t);
    if (tokens.length) await getMessaging().sendEachForMulticast({ tokens, notification: { title, body }, data });
  } catch (e: any) {
    logger.warn("admin notify failed", e?.message);
  }
}

const adminLog = (staffUid: string, action: string, details: Record<string, unknown>) =>
  fs().collection("adminLog").add({ staffUid, action, ...details, at: FieldValue.serverTimestamp() });

const count = async (q: Query) => {
  try {
    return (await q.count().get()).data().count;
  } catch (e: any) {
    logger.warn("count failed", e?.message);
    return null;
  }
};

const toMillis = (v: any): number | null =>
  v?.toMillis ? v.toMillis() : v instanceof Date ? v.getTime() : typeof v === "number" ? v : typeof v === "string" && !isNaN(Date.parse(v)) ? Date.parse(v) : null;

/** SA calendar day (YYYY-MM-DD) for a timestamp. */
const saDay = (ms: number) => new Date(ms + SA_OFFSET).toISOString().slice(0, 10);

function emptySeries(days: number) {
  const out: Record<string, number> = {};
  for (let i = days - 1; i >= 0; i--) out[saDay(Date.now() - i * DAY)] = 0;
  return out;
}

/* ---------- Analytics for the Overview page ---------- */
export const adminDashboard = onCall({}, async (req) => {
  await requireStaff(req);
  const db = fs();
  const since = (days: number) => Timestamp.fromMillis(Date.now() - days * DAY);
  const ACTIVE = ["requested", "offered", "accepted", "arrived", "in_progress"];

  const [
    usersTotal, usersNew7, usersNew30,
    ridesTotal, ridesCompleted, ridesCancelled, ridesActive, ridesNoDrivers,
    driversActive, driversPaused, driversSuspended, driversOnline, driverAppsPending,
    businessesVerified, businessesPending, merchants,
    sosOpen, incidentsOpen, communities,
  ] = await Promise.all([
    count(db.collection("users")),
    count(db.collection("users").where("createdAt", ">=", since(7))),
    count(db.collection("users").where("createdAt", ">=", since(30))),
    count(db.collection("rides")),
    count(db.collection("rides").where("status", "==", "completed")),
    count(db.collection("rides").where("status", "==", "cancelled")),
    count(db.collection("rides").where("status", "in", ACTIVE)),
    count(db.collection("rides").where("status", "==", "no_drivers")),
    count(db.collection("drivers").where("status", "==", "active")),
    count(db.collection("drivers").where("status", "==", "paused")),
    count(db.collection("drivers").where("status", "==", "suspended")),
    count(db.collection("drivers_live").where("online", "==", true)),
    count(db.collection("driver_applications").where("status", "in", ["submitted", "in_review"])),
    count(db.collection("business_verifications").where("status", "==", "verified")),
    count(db.collection("business_verifications").where("status", "in", ["submitted", "in_review"])),
    count(db.collection("payees").where("role", "==", "merchant")),
    count(db.collection("safetyAlerts").where("status", "==", "open")),
    count(db.collection("incidentReports").where("status", "in", ["open", "investigating"])),
    count(db.collection("communities")),
  ]);

  // 30-day daily series (small pilot volumes: read the docs and bucket them by SA day)
  const DAYS = 30;
  const signups = emptySeries(DAYS);
  const rides = emptySeries(DAYS);
  const ridesDone = emptySeries(DAYS);
  const paidRand = emptySeries(DAYS);
  let paidCount = 0;
  let paidCents = 0;
  let failedPayments = 0;
  let fareCentsCompleted = 0;
  const incidentsByCategory: Record<string, number> = {};

  const [usersSnap, ridesSnap, paySnap, incSnap] = await Promise.all([
    db.collection("users").where("createdAt", ">=", since(DAYS)).select("createdAt").limit(10000).get().catch(() => null),
    db.collection("rides").where("createdAt", ">=", since(DAYS)).select("createdAt", "status", "fareCents").limit(10000).get().catch(() => null),
    db.collection("payments").where("createdAt", ">=", since(DAYS)).select("createdAt", "paidAt", "status", "amountCents").limit(10000).get().catch(() => null),
    db.collection("incidentReports").where("createdAt", ">=", since(DAYS)).select("category").limit(5000).get().catch(() => null),
  ]);
  usersSnap?.forEach((d) => {
    const ms = toMillis(d.get("createdAt"));
    if (ms) signups[saDay(ms)] = (signups[saDay(ms)] ?? 0) + 1;
  });
  ridesSnap?.forEach((d) => {
    const ms = toMillis(d.get("createdAt"));
    if (!ms) return;
    const day = saDay(ms);
    rides[day] = (rides[day] ?? 0) + 1;
    if (d.get("status") === "completed") {
      ridesDone[day] = (ridesDone[day] ?? 0) + 1;
      fareCentsCompleted += Number(d.get("fareCents") || 0);
    }
  });
  paySnap?.forEach((d) => {
    const status = d.get("status");
    if (status === "failed") failedPayments++;
    if (status !== "paid") return;
    const ms = toMillis(d.get("paidAt")) || toMillis(d.get("createdAt"));
    const cents = Number(d.get("amountCents") || 0);
    paidCount++;
    paidCents += cents;
    if (ms) paidRand[saDay(ms)] = (paidRand[saDay(ms)] ?? 0) + cents / 100;
  });
  incSnap?.forEach((d) => {
    const c = String(d.get("category") || "other");
    incidentsByCategory[c] = (incidentsByCategory[c] || 0) + 1;
  });

  const feePercent = Number(process.env.PAYSTACK_PLATFORM_FEE_PERCENT ?? "5");
  const series = (o: Record<string, number>) => Object.entries(o).map(([day, value]) => ({ day, value: Math.round(value * 100) / 100 }));

  return {
    generatedAt: Date.now(),
    users: { total: usersTotal, new7: usersNew7, new30: usersNew30 },
    rides: { total: ridesTotal, completed: ridesCompleted, cancelled: ridesCancelled, active: ridesActive, noDrivers: ridesNoDrivers, fareRandCompleted30: fareCentsCompleted / 100 },
    drivers: { active: driversActive, paused: driversPaused, suspended: driversSuspended, online: driversOnline, pendingApplications: driverAppsPending },
    businesses: { verified: businessesVerified, pending: businessesPending, merchants },
    payments: { paid30: paidCount, volumeRand30: paidCents / 100, feeRand30: Math.round(paidCents * feePercent) / 10000, failed30: failedPayments, feePercent },
    safety: { sosOpen, incidentsOpen, incidentsByCategory30: incidentsByCategory },
    communities,
    series: { signups: series(signups), rides: series(rides), ridesCompleted: series(ridesDone), paymentsRand: series(paidRand) },
  };
});

/* ---------- Handle an emergency alert or incident report ---------- */
const CASE_STATUSES: Record<string, string[]> = {
  sos: ["acknowledged", "resolved"],
  incident: ["investigating", "resolved", "no_action"],
};

export const updateSafetyCase = onCall({}, async (req) => {
  const staff = await requireStaff(req);
  const { kind, id, status, note } = (req.data || {}) as Record<string, string>;
  if (!CASE_STATUSES[kind]?.includes(status)) throw new HttpsError("invalid-argument", "Unknown case type or status.");
  const text = String(note || "").trim();
  if (status !== "acknowledged" && status !== "investigating" && text.length < 10) {
    throw new HttpsError("invalid-argument", "Write down what was done (at least a sentence).");
  }
  const db = fs();
  const ref = db.collection(kind === "sos" ? "safetyAlerts" : "incidentReports").doc(String(id));
  const data = (await ref.get()).data();
  if (!data) throw new HttpsError("not-found", "Case not found.");
  await ref.update({
    status,
    handledBy: staff.uid,
    updatedAt: FieldValue.serverTimestamp(),
    history: FieldValue.arrayUnion({ status, note: text.slice(0, 2000), by: staff.uid, at: Timestamp.now() }),
  });
  if (kind === "sos" && status === "resolved" && data.rideId) {
    await db.collection("rides").doc(String(data.rideId)).update({ sosActive: false }).catch(() => undefined);
  }
  await adminLog(staff.uid, `case:${kind}:${status}`, { caseId: id, note: text.slice(0, 500) });
  return { ok: true };
});

/* ---------- Pause or reinstate a verified driver ---------- */
export const setDriverStatus = onCall({}, async (req) => {
  const staff = await requireStaff(req);
  const { uid, status, reason } = (req.data || {}) as Record<string, string>;
  if (!["active", "suspended"].includes(status)) throw new HttpsError("invalid-argument", "Status must be active or suspended.");
  const why = String(reason || "").trim();
  if (why.length < 10) throw new HttpsError("invalid-argument", "Write down why (at least a sentence).");
  if (uid === staff.uid) throw new HttpsError("permission-denied", "You can't change your own driver account.");
  const db = fs();
  const ref = db.collection("drivers").doc(String(uid));
  const drv = (await ref.get()).data();
  if (!drv?.verified) throw new HttpsError("not-found", "Verified driver not found.");
  if (status === "active") {
    const today = saDay(Date.now());
    const expired = Object.entries(drv.docExpiries || {}).filter(([, d]) => String(d) < today).map(([k]) => k);
    if (drv.nextCheckDue && drv.nextCheckDue < today) expired.push("annual re-check");
    if (expired.length) throw new HttpsError("failed-precondition", `Can't reinstate: expired ${expired.join(", ")}.`);
    await ref.update({
      status: "active",
      reinstatedAt: FieldValue.serverTimestamp(),
      suspendedReason: FieldValue.delete(),
      pausedReason: FieldValue.delete(),
    });
    await notify(uid, "You can drive on Wiji again", "Your driver account is active again.", { type: "driver" });
  } else {
    await ref.update({ status: "suspended", suspendedReason: why.slice(0, 500), suspendedAt: FieldValue.serverTimestamp() });
    await db.collection("drivers_live").doc(uid).delete().catch(() => undefined);
    await notify(uid, "Your Wiji driver account is paused", "Open Wiji to see why.", { type: "driver" });
  }
  await db.collection("driverReviewLog").add({ uid, staffUid: staff.uid, action: status === "active" ? "reinstated" : "suspended", reason: why, at: FieldValue.serverTimestamp() });
  return { ok: true };
});
