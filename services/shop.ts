// services/shop.ts — buying from verified businesses on the map (see functions/src/shop.ts)
import { getFunctions, httpsCallable } from "firebase/functions";
import { app, auth } from "../firebaseConfig";

const functions = getFunctions(app, "us-central1");
async function call<T = any>(name: string, data: any = {}): Promise<T> {
  if (!auth.currentUser) throw new Error("Please sign in first.");
  try {
    return (await httpsCallable(functions, name)(data)).data as T;
  } catch (e: any) {
    throw new Error(e?.message?.replace(/^.*?:\s*/, "") || "Something went wrong. Please try again.");
  }
}

export type Business = {
  id: string;
  ownerId: string;
  name: string;
  category?: string;
  address?: string;
  description?: string;
  latitude: number;
  longitude: number;
  coverPath?: string | null;
  active: boolean;
  isOpen?: boolean;
  collectEnabled?: boolean;
  deliveryEnabled?: boolean;
  deliveryFeeCents?: number;
};
export type MenuItem = { id: string; name: string; description?: string; priceCents: number; available: boolean; category?: string; photoUrl?: string };
export type CartLine = { kind: "menu" | "deal"; id: string; name: string; priceCents: number; qty: number };
export type OrderStatus = "payment_pending" | "paid" | "preparing" | "ready" | "out_for_delivery" | "completed" | "cancelled";

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: "info" | "good" | "warn" | "bad" }> = {
  payment_pending: { label: "Waiting for payment", tone: "warn" },
  paid: { label: "New order", tone: "info" },
  preparing: { label: "Preparing", tone: "info" },
  ready: { label: "Ready to collect", tone: "good" },
  out_for_delivery: { label: "Out for delivery", tone: "good" },
  completed: { label: "Completed", tone: "good" },
  cancelled: { label: "Cancelled", tone: "bad" },
};

export const createOrder = (input: {
  businessId: string;
  items: { kind: "menu" | "deal"; id: string; qty: number }[];
  fulfilment: "collect" | "delivery";
  deliveryAddress?: string;
  deliveryLocation?: { lat: number; lng: number } | null;
  note?: string;
}) => call<{ orderId: string; totalCents: number }>("createOrder", input);

export const updateOrderStatus = (orderId: string, status: OrderStatus, reason?: string) =>
  call<{ ok: boolean; refunded?: boolean }>("updateOrderStatus", { orderId, status, reason });

export const shortOrderId = (id: string) => id.slice(0, 6).toUpperCase();

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
