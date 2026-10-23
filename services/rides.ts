// services/rides.ts — app side of Wiji Rides (see functions/src/rides.ts)
import { getFunctions, httpsCallable } from "firebase/functions";
import { collection, doc, getDoc, getDocs, query, setDoc, serverTimestamp, where } from "firebase/firestore";
import { Linking } from "react-native";
import { app, auth, db } from "../firebaseConfig";

const functions = getFunctions(app, "us-central1");

async function call<T = any>(name: string, data: any = {}): Promise<T> {
  if (!auth.currentUser) throw new Error("Please sign in first.");
  try {
    return (await httpsCallable(functions, name)(data)).data as T;
  } catch (e: any) {
    throw new Error(e?.message?.replace(/^.*?:\s*/, "") || "Something went wrong. Please try again.");
  }
}

export type Point = { lat: number; lng: number; address?: string };
export type RideStatus =
  | "requested" | "offered" | "accepted" | "arrived" | "in_progress"
  | "completed" | "cancelled" | "no_drivers";
export const ACTIVE_STATUSES: RideStatus[] = ["requested", "offered", "accepted", "arrived", "in_progress"];

export const requestRide = (pickup: Point, dropoff: Point) => call<{ rideId: string }>("requestRide", { pickup, dropoff });
export const respondToOffer = (rideId: string, accept: boolean) => call("respondToRideOffer", { rideId, accept });
export const updateRide = (rideId: string, action: "cancel" | "not_my_driver" | "arrived" | "start" | "complete", pin?: string) =>
  call("updateRide", { rideId, action, pin });
/** Passenger rates the driver once after a completed trip */
export const rateRide = (rideId: string, stars: number, tags: string[], comment: string) => call("rateRide", { rideId, stars, tags, comment });
export const RATING_TAGS = {
  good: ["Safe driving", "Friendly", "Clean car", "On time", "Knew the way"],
  bad: ["Unsafe driving", "Rude", "Late", "Dirty car", "Took a long route", "Car didn't match"],
};
/** "★ 4.8 · 120 trips" style summary for a driver doc */
export function driverStatsText(d?: { ratingAvg?: number; ratingCount?: number; trips?: number } | null) {
  const trips = Number(d?.trips || 0);
  const tripText = `${trips} trip${trips === 1 ? "" : "s"}`;
  return d?.ratingCount ? `★ ${Number(d.ratingAvg || 0).toFixed(1)} (${d.ratingCount}) · ${tripText}` : `New driver · ${tripText}`;
}

export const createTripShare = (rideId: string) => call<{ url: string }>("createTripShare", { rideId });
export const raiseEmergency = (input: { rideId?: string; lat?: number; lng?: number }) => call("raiseEmergency", input);
export const reportIncident = (rideId: string, category: string, description: string) =>
  call<{ reportId: string; severity: number }>("reportIncident", { rideId, category, description });

/** Same estimate the server uses (base R15 + R8/km on 1.3x straight-line distance, min R30). */
export function estimateFareCents(a: Point, b: Point) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const km = 2 * R * Math.asin(Math.sqrt(x)) * 1.3;
  const cents = 1500 + Math.round(km * 800);
  return { km: Math.round(km * 10) / 10, cents: Math.max(3000, Math.round(cents / 100) * 100) };
}

/* ---------- trusted friends (private to the user) ---------- */
// Trusted friends are people you already chat with on Wiji. They get a push notification with
// your live trip, and are alerted if you press the emergency button.
export const MAX_TRUSTED = 5;
export type SafetySettings = { trustedUids: string[]; autoShare: boolean };
export type Friend = { uid: string; username: string; profilePic?: string };

export async function getSafetySettings(): Promise<SafetySettings> {
  const uid = auth.currentUser?.uid;
  if (!uid) return { trustedUids: [], autoShare: false };
  const s = await getDoc(doc(db, "users", uid, "safety", "settings"));
  const d = s.data() || {};
  return {
    trustedUids: Array.isArray(d.trustedUids) ? d.trustedUids.filter((x: any) => typeof x === "string").slice(0, MAX_TRUSTED) : [],
    autoShare: !!d.autoShare,
  };
}

export async function saveSafetySettings(settings: SafetySettings) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Please sign in first.");
  await setDoc(doc(db, "users", uid, "safety", "settings"), {
    trustedUids: settings.trustedUids.slice(0, MAX_TRUSTED),
    autoShare: settings.autoShare,
    updatedAt: serverTimestamp(),
  });
}

/** Your Wiji friends: everyone you have a one-to-one chat with (same rule as the Chats tab). */
export async function loadFriends(): Promise<Friend[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  const others = new Set<string>();
  const add = (p: any) => {
    const ids: string[] = Array.isArray(p) ? p : p && typeof p === "object" ? Object.keys(p) : [];
    if (ids.length !== 2 || !ids.includes(uid)) return;
    ids.forEach((id) => id && id !== uid && others.add(id));
  };
  const me = await getDoc(doc(db, "users", uid));
  const chatIds: string[] = Array.isArray(me.data()?.chatIds) ? me.data()!.chatIds : [];
  if (chatIds.length) {
    const chats = await Promise.all(chatIds.slice(0, 300).map((id) => getDoc(doc(db, "chats", id)).catch(() => null)));
    chats.forEach((c) => c?.exists() && add(c.data().participants));
  } else {
    const q = await getDocs(query(collection(db, "chats"), where("participants", "array-contains", uid)));
    q.forEach((c) => add(c.data().participants));
  }
  const users = await Promise.all([...others].map((id) => getDoc(doc(db, "users", id)).catch(() => null)));
  return users
    .filter((u): u is NonNullable<typeof u> => !!u && u.exists())
    .map((u) => {
      const d: any = u.data() || {};
      return { uid: u.id, username: String(d.username || "Wiji user"), profilePic: d.profilePic || undefined };
    })
    .sort((x, y) => x.username.localeCompare(y.username));
}

/** Push the live trip to your trusted friends. */
export const shareTripWithFriends = (rideId: string) => call<{ sent: number; url: string }>("shareTripWithFriends", { rideId });

export const callNumber = (n: string) => Linking.openURL(`tel:${n}`);

export const EMERGENCY_NUMBERS = [
  { label: "SAPS emergency", number: "10111" },
  { label: "Emergency from any mobile", number: "112" },
  { label: "GBV Command Centre (24 hours)", number: "0800428428" },
];

export const formatRand = (cents: number) => `R${(cents / 100).toFixed(0)}`;
