// services/routes.ts: driving routes for trips, and how far someone is from the route.
// Uses Google Directions when EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is set (and the Directions API is enabled),
// otherwise the free OpenStreetMap router (OSRM), so routes always show.
import { useEffect, useState } from "react";

export type LatLng = { lat: number; lng: number };
export type PlannedRoute = { points: LatLng[]; distanceM: number; durationS: number; source: "google" | "osm" };

const GOOGLE_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "";
let googleDown = false;

/** Google / OSRM encoded polyline (precision 5) → points */
export function decodePolyline(str: string): LatLng[] {
  const out: LatLng[] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b: number;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d;
      else lng += d;
    }
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

async function googleRoute(a: LatLng, b: LatLng): Promise<PlannedRoute> {
  const params = new URLSearchParams({ origin: `${a.lat},${a.lng}`, destination: `${b.lat},${b.lng}`, mode: "driving", region: "za", key: GOOGLE_KEY });
  const res = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params}`);
  const data = await res.json();
  if (data.status !== "OK" || !data.routes?.length) throw new Error(data.status || "no_route");
  const r = data.routes[0];
  const leg = r.legs?.[0] || {};
  return { points: decodePolyline(r.overview_polyline.points), distanceM: leg.distance?.value || 0, durationS: leg.duration?.value || 0, source: "google" };
}

async function osmRoute(a: LatLng, b: LatLng): Promise<PlannedRoute> {
  const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=polyline`);
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.length) throw new Error(data.code || "no_route");
  const r = data.routes[0];
  return { points: decodePolyline(r.geometry), distanceM: r.distance || 0, durationS: r.duration || 0, source: "osm" };
}

const cache = new Map<string, PlannedRoute>();
/** The suggested driving route from a to b (cached), or null if no router could be reached. */
export async function getRoute(a: LatLng, b: LatLng): Promise<PlannedRoute | null> {
  const key = [a.lat, a.lng, b.lat, b.lng].map((n) => n.toFixed(4)).join(",");
  if (cache.has(key)) return cache.get(key)!;
  let r: PlannedRoute | null = null;
  if (GOOGLE_KEY && !googleDown) {
    try {
      r = await googleRoute(a, b);
    } catch (e: any) {
      if (["REQUEST_DENIED", "OVER_QUERY_LIMIT"].includes(e?.message)) googleDown = true;
    }
  }
  if (!r) {
    try {
      r = await osmRoute(a, b);
    } catch {
      r = null;
    }
  }
  if (r) cache.set(key, r);
  return r;
}

/** Metres from point p to the nearest part of the route */
export function distanceToRouteM(p: LatLng, route: LatLng[]): number {
  if (!route.length) return Infinity;
  const R = 6371000;
  const toXY = (q: LatLng) => {
    const x = ((q.lng - p.lng) * Math.PI) / 180 * R * Math.cos((p.lat * Math.PI) / 180);
    const y = ((q.lat - p.lat) * Math.PI) / 180 * R;
    return { x, y };
  };
  let best = Infinity;
  let prev = toXY(route[0]);
  if (route.length === 1) return Math.hypot(prev.x, prev.y);
  for (let i = 1; i < route.length; i++) {
    const cur = toXY(route[i]);
    const dx = cur.x - prev.x, dy = cur.y - prev.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(prev.x * dx + prev.y * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(prev.x + t * dx, prev.y + t * dy));
    prev = cur;
  }
  return best;
}

/** React hook: the planned route between two points (re-fetched only when the points change). */
export function usePlannedRoute(from?: LatLng | null, to?: LatLng | null) {
  const [route, setRoute] = useState<PlannedRoute | null>(null);
  const key = from && to ? [from.lat, from.lng, to.lat, to.lng].map((n) => n.toFixed(4)).join(",") : "";
  useEffect(() => {
    if (!key || !from || !to) return setRoute(null);
    let alive = true;
    getRoute(from, to).then((r) => alive && setRoute(r));
    return () => {
      alive = false;
    };
  }, [key]);
  return route;
}

export const fmtDistance = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);
export const fmtDuration = (s: number) => {
  const m = Math.max(1, Math.round(s / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
