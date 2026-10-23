// functions/src/rides.ts
// Wiji Rides, phase 2 (closed pilot): ride requests, matching, trip states with a PIN,
// live trip sharing, the emergency button and incident reports.
// Trip status is changed ONLY here; the apps can't move a ride forward by themselves.
//
// Env (functions/.env):
//   RIDES_BASE_FARE_CENTS=1500  RIDES_PER_KM_CENTS=800  RIDES_MIN_FARE_CENTS=3000
import { onCall, onRequest, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { randomBytes, randomInt } from "node:crypto";

const fs = () => getFirestore();
const OFFER_SECONDS = 30;
const MAX_PICKUP_KM = 10;
const LIVE_FRESH_MS = 3 * 60 * 1000;

const ACTIVE = ["requested", "offered", "accepted", "arrived", "in_progress"];

/* ---------- helpers ---------- */
function requireUser(req: CallableRequest<any>) {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");
  return { uid, email: String((req.auth?.token as any)?.email || "").toLowerCase() };
}

const envNum = (k: string, d: number) => {
  const n = Number(process.env[k]);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function validPoint(p: any) {
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

/** Fare estimate: straight-line distance x 1.3 for roads. Final fare = estimate (pilot). */
function fareFor(distanceKm: number) {
  const cents = envNum("RIDES_BASE_FARE_CENTS", 1500) + Math.round(distanceKm * envNum("RIDES_PER_KM_CENTS", 800));
  return Math.max(envNum("RIDES_MIN_FARE_CENTS", 3000), Math.round(cents / 100) * 100);
}

async function push(uids: string[], title: string, body: string, data: Record<string, string> = {}) {
  const db = fs();
  const tokens: string[] = [];
  for (const uid of uids) {
    const u = await db.collection("users").doc(uid).get();
    for (const t of u.get("fcmTokens") || []) if (typeof t === "string" && t) tokens.push(t);
  }
  if (!tokens.length) return;
  try {
    await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data,
      android: { priority: "high", notification: { channelId: "default" } },
    });
  } catch (e: any) {
    logger.warn("push failed", e?.message);
  }
}

async function staffUids(): Promise<string[]> {
  const snap = await fs().collection("safetyTeam").get();
  return snap.docs.map((d) => d.id);
}

/** Wiji friends = people you have a one-to-one chat with (the same rule the Chats and Calls tabs use). */
async function friendUids(uid: string): Promise<Set<string>> {
  const db = fs();
  const out = new Set<string>();
  const add = (p: any) => {
    const ids: string[] = Array.isArray(p) ? p : p && typeof p === "object" ? Object.keys(p) : [];
    if (ids.length !== 2 || !ids.includes(uid)) return;
    for (const id of ids) if (typeof id === "string" && id && id !== uid) out.add(id);
  };
  const chatIds: string[] = ((await db.collection("users").doc(uid).get()).get("chatIds") || [])
    .filter((x: any) => typeof x === "string" && x)
    .slice(0, 300);
  for (let i = 0; i < chatIds.length; i += 100) {
    const refs = chatIds.slice(i, i + 100).map((id) => db.collection("chats").doc(id));
    (await db.getAll(...refs)).forEach((d) => d.exists && add(d.get("participants")));
  }
  const q = await db.collection("chats").where("participants", "array-contains", uid).limit(300).get();
  q.forEach((d) => add(d.get("participants")));
  return out;
}

/** The user's trusted friends (max 5), re-checked against their current friends every time. */
async function trustedFriends(uid: string): Promise<{ uids: string[]; autoShare: boolean }> {
  const s = (await fs().collection("users").doc(uid).collection("safety").doc("settings").get()).data() || {};
  const wanted: string[] = (Array.isArray(s.trustedUids) ? s.trustedUids : []).filter((x: any) => typeof x === "string").slice(0, 5);
  if (!wanted.length) return { uids: [], autoShare: !!s.autoShare };
  const friends = await friendUids(uid);
  return { uids: wanted.filter((id) => friends.has(id)), autoShare: !!s.autoShare };
}

/** Reuse the trip's live link if one exists, otherwise make one. */
async function shareUrlFor(rideId: string, riderUid: string, createdBy: string) {
  const db = fs();
  const existing = await db.collection("tripShares").where("rideId", "==", rideId).where("active", "==", true).limit(1).get();
  let token = existing.empty ? "" : existing.docs[0].id;
  if (!token) {
    token = randomBytes(18).toString("base64url");
    await db.collection("tripShares").doc(token).set({ rideId, riderUid, createdBy, active: true, createdAt: FieldValue.serverTimestamp() });
  }
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
  return `https://us-central1-${project}.cloudfunctions.net/tripShare?t=${token}`;
}

function carText(driver: any) {
  const v = driver?.vehicle || {};
  return [v.colour, v.make].filter(Boolean).join(" ") + (v.plate ? ` (${v.plate})` : "");
}

/** Notify trusted friends that someone shared a trip with them. */
/** The one-to-one chat between two people: the usual id (sorted uids), an older chat that has
 *  both of them, or a new one. */
async function chatBetween(a: string, b: string) {
  const db = fs();
  const ref = db.collection("chats").doc([a, b].sort().join("_"));
  if ((await ref.get()).exists) return ref;
  const q = await db.collection("chats").where("participants", "array-contains", a).limit(300).get();
  const old = q.docs.find((d) => {
    const p = d.get("participants");
    return Array.isArray(p) && p.length === 2 && p.includes(b);
  });
  if (old) return old.ref;
  await ref.set({ participants: [a, b], createdAt: FieldValue.serverTimestamp() }, { merge: true });
  await Promise.all([a, b].map((u) => db.collection("users").doc(u).update({ chatIds: FieldValue.arrayUnion(ref.id) }).catch(() => undefined)));
  return ref;
}

/** Post a message from `fromUid` into their chat with each friend. The push is sent separately
 *  (with the live link), so these messages don't trigger the normal new-message push. */
async function postToChats(fromUid: string, uids: string[], text: string, extra: Record<string, unknown> = {}) {
  await Promise.all(
    uids.map(async (to) => {
      try {
        const chat = await chatBetween(fromUid, to);
        await chat.collection("messages").add({ senderId: fromUid, text, createdAt: FieldValue.serverTimestamp(), skipPush: true, ...extra });
      } catch (e: any) {
        logger.warn("trip chat message failed", { to, msg: e?.message });
      }
    })
  );
}

async function sendTripToFriends(uids: string[], rideId: string, ride: any, url: string) {
  if (!uids.length) return;
  const who = ride?.riderFirstName || "Your friend";
  const body = ride?.driver
    ? `With ${ride.driver.firstName} in a ${carText(ride.driver)}. Tap to follow the trip live.`
    : "Tap to follow the trip live.";
  await push(uids, `${who} shared a Wiji trip with you`, body, { type: "trip_share", rideId, url });
  // Also in the chat, so the link is easy to find again
  const car = ride?.driver ? ` with ${ride.driver.firstName} (${carText(ride.driver)})` : "";
  if (ride?.riderUid) {
    await postToChats(ride.riderUid, uids, `🚗 I'm on a Wiji ride${car}. Follow my trip live: ${url}`, { kind: "trip_share", rideId, url });
  }
}

async function firstName(uid: string) {
  const u = (await fs().collection("users").doc(uid).get()).data();
  return String(u?.username || u?.displayName || "Passenger").split(/\s+/)[0];
}

/** Offer the ride to the nearest available verified driver, or mark it as having no drivers. */
async function dispatch(rideId: string) {
  const db = fs();
  const rideRef = db.collection("rides").doc(rideId);
  const ride = (await rideRef.get()).data();
  if (!ride || !["requested", "offered"].includes(ride.status)) return;
  const declined: string[] = ride.declinedBy || [];

  const live = await db.collection("drivers_live").where("online", "==", true).get();
  const now = Date.now();
  const candidates = live.docs
    .map((d) => ({ uid: d.id, ...(d.data() as any) }))
    .filter((d) => d.uid !== ride.riderUid && !d.rideId && !declined.includes(d.uid))
    .filter((d) => (d.updatedAt?.toMillis?.() ?? 0) > now - LIVE_FRESH_MS)
    .map((d) => ({ ...d, dist: km(ride.pickup, { lat: d.lat, lng: d.lng }) }))
    .filter((d) => d.dist <= MAX_PICKUP_KM)
    .sort((a, b) => a.dist - b.dist);

  for (const c of candidates) {
    const drv = (await db.collection("drivers").doc(c.uid).get()).data();
    if (drv?.status !== "active") continue;
    await rideRef.update({
      status: "offered",
      offeredTo: c.uid,
      offerExpiresAt: Timestamp.fromMillis(Date.now() + OFFER_SECONDS * 1000),
      offerPickupKm: Math.round(c.dist * 10) / 10,
    });
    await push([c.uid], "New ride request", `Pickup ${c.dist.toFixed(1)} km away. Respond within ${OFFER_SECONDS} seconds.`, { type: "ride_offer", rideId });
    return;
  }
  await rideRef.update({ status: "no_drivers", offeredTo: null, endedAt: FieldValue.serverTimestamp() });
  await push([ride.riderUid], "No drivers available", "No verified drivers are free near you right now. Please try again shortly.", { type: "ride", rideId });
}

async function freeDriver(driverUid?: string) {
  if (!driverUid) return;
  await fs().collection("drivers_live").doc(driverUid).set({ rideId: null }, { merge: true }).catch(() => undefined);
}

async function endShares(rideId: string) {
  const snap = await fs().collection("tripShares").where("rideId", "==", rideId).get();
  await Promise.all(snap.docs.map((d) => d.ref.update({ active: false })));
}

/* ---------- passenger: request a ride ---------- */
export const requestRide = onCall({}, async (req) => {
  const { uid } = requireUser(req);
  const { pickup, dropoff } = (req.data || {}) as any;
  if (!validPoint(pickup) || !validPoint(dropoff)) throw new HttpsError("invalid-argument", "Set a pickup and a destination.");
  const db = fs();

  const existing = await db.collection("rides").where("riderUid", "==", uid).where("status", "in", ACTIVE).limit(1).get();
  if (!existing.empty) throw new HttpsError("failed-precondition", "You already have a ride in progress.");

  const distanceKm = Math.round(km(pickup, dropoff) * 1.3 * 10) / 10;
  if (distanceKm < 0.3) throw new HttpsError("invalid-argument", "Your destination is too close to your pickup.");
  if (distanceKm > 150) throw new HttpsError("invalid-argument", "That trip is too long for Wiji Rides.");

  const rideRef = db.collection("rides").doc();
  await rideRef.set({
    riderUid: uid,
    riderFirstName: await firstName(uid),
    pickup: { lat: pickup.lat, lng: pickup.lng, address: String(pickup.address || "").slice(0, 200) },
    dropoff: { lat: dropoff.lat, lng: dropoff.lng, address: String(dropoff.address || "").slice(0, 200) },
    distanceKm,
    fareCents: fareFor(distanceKm),
    status: "requested",
    offeredTo: null,
    declinedBy: [],
    driverUid: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  // The PIN lives in a separate document only the passenger can read.
  await db.collection("ridePins").doc(rideRef.id).set({ riderUid: uid, pin: String(randomInt(0, 10000)).padStart(4, "0") });
  await dispatch(rideRef.id);
  return { rideId: rideRef.id };
});

/* ---------- driver: accept or decline an offer ---------- */
export const respondToRideOffer = onCall({}, async (req) => {
  const { uid } = requireUser(req);
  const { rideId, accept } = (req.data || {}) as any;
  const db = fs();
  const rideRef = db.collection("rides").doc(String(rideId));
  const ride = (await rideRef.get()).data();
  if (!ride || ride.status !== "offered" || ride.offeredTo !== uid) throw new HttpsError("failed-precondition", "This request is no longer available.");

  if (!accept) {
    await rideRef.update({ declinedBy: FieldValue.arrayUnion(uid), offeredTo: null, status: "requested" });
    await dispatch(rideRef.id);
    return { ok: true };
  }
  const drv = (await db.collection("drivers").doc(uid).get()).data();
  if (drv?.status !== "active") throw new HttpsError("permission-denied", "Your driver account isn't active.");
  await rideRef.update({
    status: "accepted",
    driverUid: uid,
    offeredTo: null,
    acceptedAt: FieldValue.serverTimestamp(),
    driver: { firstName: drv.firstName, photoPath: drv.photoPath || null, vehicle: drv.vehicle, verifiedAt: drv.verifiedAt || null },
  });
  await db.collection("drivers_live").doc(uid).set({ rideId: rideRef.id }, { merge: true });
  await push(
    [ride.riderUid],
    "Your driver is on the way",
    `${drv.firstName} in a ${drv.vehicle?.colour || ""} ${drv.vehicle?.make || ""} (${drv.vehicle?.plate || ""}). Check the plate before you get in.`,
    { type: "ride", rideId: rideRef.id }
  );
  // Auto-share with the rider's trusted friends, if they switched that on
  try {
    const t = await trustedFriends(ride.riderUid);
    if (t.autoShare && t.uids.length) {
      const url = await shareUrlFor(rideRef.id, ride.riderUid, ride.riderUid);
      await sendTripToFriends(t.uids, rideRef.id, { ...ride, driver: { firstName: drv.firstName, vehicle: drv.vehicle } }, url);
    }
  } catch (e: any) {
    logger.warn("auto-share failed", e?.message);
  }
  return { ok: true };
});

/* ---------- trip progress ---------- */
export const updateRide = onCall({}, async (req) => {
  const { uid } = requireUser(req);
  const { rideId, action, pin } = (req.data || {}) as any;
  const db = fs();
  const rideRef = db.collection("rides").doc(String(rideId));
  const ride = (await rideRef.get()).data();
  if (!ride) throw new HttpsError("not-found", "Ride not found.");
  const isRider = ride.riderUid === uid;
  const isDriver = ride.driverUid === uid;

  // Passenger cancels, or reports that the car/driver doesn't match the app
  if ((action === "cancel" || action === "not_my_driver") && isRider) {
    if (!["requested", "offered", "accepted", "arrived", "no_drivers"].includes(ride.status)) {
      throw new HttpsError("failed-precondition", "The trip has already started.");
    }
    await rideRef.update({
      status: "cancelled",
      cancelledBy: "rider",
      cancelReason: action,
      offeredTo: null,
      endedAt: FieldValue.serverTimestamp(),
    });
    await freeDriver(ride.driverUid);
    await endShares(rideRef.id);
    if (ride.driverUid) await push([ride.driverUid], "Trip cancelled", "The passenger cancelled this trip.", { type: "ride", rideId: rideRef.id });
    if (action === "not_my_driver") {
      // Treated as a safety report: the safety team follows up.
      await db.collection("incidentReports").add({
        rideId: rideRef.id,
        reporterUid: uid,
        reporterRole: "rider",
        againstUid: ride.driverUid || null,
        category: "driver_mismatch",
        severity: 2,
        description: "Passenger reported that the driver or car did not match the app at pickup.",
        status: "open",
        createdAt: FieldValue.serverTimestamp(),
      });
      await push(await staffUids(), "Safety report: driver mismatch", "A passenger said the driver or car didn't match the app.", { type: "safety" });
    }
    return { ok: true };
  }

  if (!isDriver) throw new HttpsError("permission-denied", "Only the trip's driver can do that.");

  if (action === "arrived") {
    if (ride.status !== "accepted") throw new HttpsError("failed-precondition", "You can only arrive after accepting.");
    await rideRef.update({ status: "arrived", arrivedAt: FieldValue.serverTimestamp() });
    await push([ride.riderUid], "Your driver has arrived", "Check the plate and the driver's photo, then give them your trip PIN.", { type: "ride", rideId: rideRef.id });
    return { ok: true };
  }

  if (action === "start") {
    if (ride.status !== "arrived") throw new HttpsError("failed-precondition", "Tap 'I've arrived' first.");
    const pinDoc = (await db.collection("ridePins").doc(rideRef.id).get()).data();
    const tries = Number(ride.pinTries || 0);
    if (tries >= 5) throw new HttpsError("resource-exhausted", "Too many wrong PINs. Cancel this trip.");
    if (!pinDoc || String(pin || "") !== pinDoc.pin) {
      await rideRef.update({ pinTries: tries + 1 });
      throw new HttpsError("invalid-argument", "That PIN doesn't match. Ask the passenger to read it from their app.");
    }
    await rideRef.update({ status: "in_progress", startedAt: FieldValue.serverTimestamp() });
    return { ok: true };
  }

  if (action === "complete") {
    if (ride.status !== "in_progress") throw new HttpsError("failed-precondition", "The trip hasn't started.");
    await rideRef.update({ status: "completed", completedAt: FieldValue.serverTimestamp(), endedAt: FieldValue.serverTimestamp() });
    await freeDriver(uid);
    await endShares(rideRef.id);
    await db.collection("drivers").doc(uid).update({ trips: FieldValue.increment(1), lastRideId: rideRef.id }).catch(() => undefined);
    await push([ride.riderUid], "You've arrived", "Your trip is complete. Pay your driver and rate your trip in the app.", { type: "ride", rideId: rideRef.id });
    return { ok: true };
  }

  if (action === "cancel") {
    if (!["accepted", "arrived"].includes(ride.status)) throw new HttpsError("failed-precondition", "You can't cancel now.");
    await rideRef.update({ status: "cancelled", cancelledBy: "driver", endedAt: FieldValue.serverTimestamp() });
    await freeDriver(uid);
    await endShares(rideRef.id);
    await push([ride.riderUid], "Your driver cancelled", "Sorry about that. Please request another ride.", { type: "ride", rideId: rideRef.id });
    return { ok: true };
  }

  throw new HttpsError("invalid-argument", "Unknown action.");
});

/* ---------- every minute: offers nobody answered ---------- */
/* ---------- Rating the driver after a trip ---------- */
const GOOD_TAGS = ["Safe driving", "Friendly", "Clean car", "On time", "Knew the way"];
const BAD_TAGS = ["Unsafe driving", "Rude", "Late", "Dirty car", "Took a long route", "Car didn't match"];

/** Passenger rates a completed trip once (1–5 stars). Updates the driver's average and trip log. */
export const rateRide = onCall({}, async (req) => {
  const { uid } = requireUser(req);
  const { rideId, stars, comment, tags } = (req.data || {}) as Record<string, any>;
  const n = Number(stars);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new HttpsError("invalid-argument", "Choose 1 to 5 stars.");
  const cleanTags = (Array.isArray(tags) ? tags : []).filter((t) => GOOD_TAGS.includes(t) || BAD_TAGS.includes(t)).slice(0, 6);
  const text = String(comment || "").trim().slice(0, 300);
  const db = fs();
  const rideRef = db.collection("rides").doc(String(rideId || ""));

  const result = await db.runTransaction(async (tx) => {
    const ride = (await tx.get(rideRef)).data();
    if (!ride || ride.riderUid !== uid) throw new HttpsError("not-found", "Trip not found.");
    if (ride.status !== "completed") throw new HttpsError("failed-precondition", "You can rate a trip once it's complete.");
    if (ride.rating) throw new HttpsError("already-exists", "You've already rated this trip.");
    const driverRef = db.collection("drivers").doc(String(ride.driverUid));
    const d = (await tx.get(driverRef)).data() || {};
    const sum = Number(d.ratingSum || 0) + n;
    const count = Number(d.ratingCount || 0) + 1;
    const rating = { stars: n, tags: cleanTags, comment: text, at: FieldValue.serverTimestamp() };
    tx.update(rideRef, { rating });
    tx.set(driverRef, { ratingSum: sum, ratingCount: count, ratingAvg: Math.round((sum / count) * 100) / 100 }, { merge: true });
    // Log of every rating (the driver sees it without the passenger's name; the safety team sees everything)
    tx.set(db.collection("driverRatings").doc(rideRef.id), {
      rideId: rideRef.id,
      driverUid: ride.driverUid,
      riderUid: uid,
      stars: n,
      tags: cleanTags,
      comment: text,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { driverUid: String(ride.driverUid), avg: Math.round((sum / count) * 10) / 10 };
  });

  await push([result.driverUid], `New rating: ${"★".repeat(n)}`, text ? `"${text.slice(0, 120)}"` : `Your rating is now ${result.avg}.`, { type: "rating", rideId: rideRef.id });
  // Very low ratings, or ones that mention unsafe driving, go to the safety team
  if (n <= 2 || cleanTags.includes("Unsafe driving") || cleanTags.includes("Car didn't match")) {
    await push(await staffUids(), `Low trip rating (${n}★)`, [cleanTags.join(", "), text].filter(Boolean).join(" · ").slice(0, 150) || "A passenger rated a trip poorly.", { type: "safety" });
  }
  return { ok: true };
});

export const expireRideOffers = onSchedule("every 1 minutes", async () => {
  const db = fs();
  const snap = await db.collection("rides").where("status", "==", "offered").get();
  for (const d of snap.docs) {
    const r = d.data();
    if ((r.offerExpiresAt?.toMillis?.() ?? 0) < Date.now()) {
      await d.ref.update({ declinedBy: FieldValue.arrayUnion(r.offeredTo), offeredTo: null, status: "requested" });
      await dispatch(d.id);
    }
  }
});

/* ---------- Share my trip ---------- */
export const createTripShare = onCall({}, async (req) => {
  const { uid } = requireUser(req);
  const rideId = String(req.data?.rideId || "");
  const ride = (await fs().collection("rides").doc(rideId).get()).data();
  if (!ride || ride.riderUid !== uid) throw new HttpsError("not-found", "Ride not found.");
  if (!ACTIVE.includes(ride.status)) throw new HttpsError("failed-precondition", "This trip has ended.");
  return { url: await shareUrlFor(rideId, uid, uid) };
});

/** Send the live trip to the rider's trusted friends in Wiji (push notification). */
export const shareTripWithFriends = onCall({}, async (req) => {
  const { uid } = requireUser(req);
  const rideId = String(req.data?.rideId || "");
  const ride = (await fs().collection("rides").doc(rideId).get()).data();
  if (!ride || ride.riderUid !== uid) throw new HttpsError("not-found", "Ride not found.");
  if (!ACTIVE.includes(ride.status)) throw new HttpsError("failed-precondition", "This trip has ended.");
  const { uids } = await trustedFriends(uid);
  if (!uids.length) throw new HttpsError("failed-precondition", "Choose your trusted friends first.");
  const url = await shareUrlFor(rideId, uid, uid);
  await sendTripToFriends(uids, rideId, ride, url);
  return { sent: uids.length, url };
});

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

/** Public live-trip page opened from the trusted-friend notification (or a shared link); no login needed; stops working when the trip ends. */
export const tripShare = onRequest(async (req, res) => {
  const token = String(req.query.t || "");
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex");
  const share = token ? (await fs().collection("tripShares").doc(token).get()).data() : null;
  const ride = share ? (await fs().collection("rides").doc(share.rideId).get()).data() : null;
  const live = share?.active && ride?.driverUid ? (await fs().collection("drivers_live").doc(ride.driverUid).get()).data() : null;
  const ended = !share?.active || !ride || !ACTIVE.includes(ride.status);
  const data = {
    ended,
    status: ride?.status || "unknown",
    rider: ride?.riderFirstName || "",
    driver: ended ? null : ride?.driver ? { firstName: ride.driver.firstName, vehicle: ride.driver.vehicle } : null,
    destination: ended ? null : ride?.dropoff?.address || "",
    location: !ended && live ? { lat: live.lat, lng: live.lng, at: live.updatedAt?.toMillis?.() || null } : null,
  };
  if (req.query.format === "json") {
    res.json(data);
    return;
  }
  const statusText: Record<string, string> = {
    requested: "Finding a driver",
    offered: "Finding a driver",
    accepted: "Driver on the way to pickup",
    arrived: "Driver at pickup",
    in_progress: "On the trip",
    completed: "Arrived safely",
    cancelled: "Trip cancelled",
  };
  const v = data.driver?.vehicle || {};
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wiji trip</title><style>body{font-family:system-ui,sans-serif;margin:0;background:#F6F4FB;color:#15102B}
.card{background:#fff;margin:16px;padding:16px;border-radius:16px}h1{font-size:20px;margin:0 0 4px}.muted{color:#5B5670}
iframe{width:100%;height:320px;border:0;border-radius:12px;margin-top:12px}.plate{font-weight:800;font-size:18px}
.sos{background:#B00020;color:#fff;padding:12px;border-radius:12px;text-align:center;text-decoration:none;display:block;margin-top:12px;font-weight:700}</style></head>
<body><div class="card"><h1>${esc(data.rider)}'s Wiji trip</h1><div class="muted" id="status">${esc(statusText[data.status] || data.status)}</div>
${data.ended ? `<p>This trip link is no longer active.</p>` : `
<p>Driver: <b>${esc(data.driver?.firstName || "being matched")}</b><br>${esc([v.colour, v.make, v.model].filter(Boolean).join(" "))}<br><span class="plate">${esc(v.plate || "")}</span></p>
<p class="muted">Going to: ${esc(data.destination)}</p>
<div id="map">${data.location ? `<iframe src="https://maps.google.com/maps?q=${data.location.lat},${data.location.lng}&z=15&output=embed"></iframe>` : `<p class="muted">Live location appears once a driver is on the way.</p>`}</div>
<p class="muted" id="updated"></p>
<a class="sos" href="tel:10111">Worried? Call SAPS 10111</a>`}
</div><script>
const t=${JSON.stringify(token)};
async function tick(){try{const r=await fetch('?format=json&t='+encodeURIComponent(t));const d=await r.json();
if(d.ended){location.reload();return;}
if(d.location){document.getElementById('map').innerHTML='<iframe src="https://maps.google.com/maps?q='+d.location.lat+','+d.location.lng+'&z=15&output=embed"></iframe>';
document.getElementById('updated').textContent='Updated '+new Date(d.location.at||Date.now()).toLocaleTimeString();}}catch(e){}}
${data.ended ? "" : "setInterval(tick,15000);"}
</script></body></html>`);
});

/* ---------- Emergency button ---------- */
export const raiseEmergency = onCall({}, async (req) => {
  const { uid } = requireUser(req);
  const { rideId, lat, lng } = (req.data || {}) as any;
  const db = fs();
  let role = "user";
  let ride: any = null;
  if (rideId) {
    ride = (await db.collection("rides").doc(String(rideId)).get()).data();
    if (ride?.riderUid === uid) role = "rider";
    else if (ride?.driverUid === uid) role = "driver";
    else ride = null;
  }
  const alert = await db.collection("safetyAlerts").add({
    raisedBy: uid,
    role,
    rideId: ride ? String(rideId) : null,
    location: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
    status: "open",
    createdAt: FieldValue.serverTimestamp(),
  });
  if (ride) await db.collection("rides").doc(String(rideId)).update({ sosActive: true, sosAlertId: alert.id });
  await push(await staffUids(), "EMERGENCY on a Wiji trip", `A ${role} pressed the emergency button. Open the safety console now.`, {
    type: "sos",
    alertId: alert.id,
  });
  // Tell the person's trusted friends, with their last location and the live trip link
  try {
    const { uids } = await trustedFriends(uid);
    if (uids.length) {
      const hasLoc = Number.isFinite(lat) && Number.isFinite(lng);
      const mapsUrl = hasLoc ? `https://maps.google.com/?q=${lat},${lng}` : "";
      const tripUrl = ride && ACTIVE.includes(ride.status) ? await shareUrlFor(String(rideId), ride.riderUid, uid) : "";
      const name = await firstName(uid);
      await push(
        uids,
        `EMERGENCY: ${name} needs help`,
        `${name} pressed the emergency button${ride ? " on a Wiji trip" : ""}. Tap to see where they are. If you can't reach them, call SAPS on 10111.`,
        { type: "trip_share", emergency: "1", url: tripUrl || mapsUrl, ...(ride ? { rideId: String(rideId) } : {}) }
      );
      const link = tripUrl || mapsUrl;
      await postToChats(
        uid,
        uids,
        `🚨 EMERGENCY: I pressed the Wiji emergency button and need help.${link ? ` See where I am: ${link}` : ""} If you can't reach me, call SAPS on 10111.`,
        { kind: "sos", ...(ride ? { rideId: String(rideId) } : {}), ...(link ? { url: link } : {}) }
      );
    }
  } catch (e: any) {
    logger.warn("SOS friend alert failed", e?.message);
  }
  logger.warn("SOS raised", { alertId: alert.id, rideId, role });
  return { alertId: alert.id };
});

/* ---------- Incident reports ---------- */
const CATEGORY_SEVERITY: Record<string, number> = {
  sexual_misconduct: 2,
  threats_violence: 2,
  unsafe_driving: 2,
  driver_mismatch: 2,
  route_fare: 3,
  rudeness: 3,
  passenger_conduct: 3,
  other: 3,
};

export const reportIncident = onCall({}, async (req) => {
  const { uid } = requireUser(req);
  const { rideId, category, description } = (req.data || {}) as any;
  if (!(category in CATEGORY_SEVERITY)) throw new HttpsError("invalid-argument", "Choose what happened.");
  const text = String(description || "").trim();
  if (text.length < 10) throw new HttpsError("invalid-argument", "Tell us a little about what happened (at least a sentence).");
  const db = fs();
  const ride = (await db.collection("rides").doc(String(rideId)).get()).data();
  if (!ride || (ride.riderUid !== uid && ride.driverUid !== uid)) throw new HttpsError("not-found", "Trip not found.");
  const reporterRole = ride.riderUid === uid ? "rider" : "driver";
  const againstUid = reporterRole === "rider" ? ride.driverUid : ride.riderUid;
  const severity = CATEGORY_SEVERITY[category];

  const report = await db.collection("incidentReports").add({
    rideId: String(rideId),
    reporterUid: uid,
    reporterRole,
    againstUid: againstUid || null,
    category,
    severity,
    description: text.slice(0, 4000),
    status: "open",
    createdAt: FieldValue.serverTimestamp(),
  });

  // Serious reports against a driver: precautionary suspension while the safety team investigates.
  if (severity <= 2 && reporterRole === "rider" && againstUid) {
    await db.collection("drivers").doc(againstUid).set(
      { status: "suspended", suspendedReason: "Paused while a safety report is investigated", suspendedAt: FieldValue.serverTimestamp(), suspendedByReport: report.id },
      { merge: true }
    );
    await db.collection("drivers_live").doc(againstUid).set({ online: false }, { merge: true }).catch(() => undefined);
    await db.collection("driverReviewLog").add({ uid: againstUid, staffUid: null, action: "suspendedPendingInvestigation", reportId: report.id, at: FieldValue.serverTimestamp() });
    await push([againstUid], "Your driver account is paused", "A safety report about a recent trip is being reviewed. The safety team will contact you and hear your side.", { type: "driver" });
  }
  await push(await staffUids(), severity <= 2 ? "Serious safety report" : "New trip report", "Open the safety console to review it.", { type: "safety", reportId: report.id });
  return { reportId: report.id, severity };
});
