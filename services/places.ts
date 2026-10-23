// services/places.ts — place search suggestions, so people can only pick places that really exist.
// Uses Google Places Autocomplete (South Africa only, biased to where you are). If Google isn't
// available (key missing, Places API not enabled, quota), it falls back to free OpenStreetMap
// search (Photon), so suggestions keep working.

export type PlaceSuggestion = {
  id: string;
  title: string; // e.g. "Menlyn Maine"
  subtitle: string; // e.g. "Waterkloof Glen, Pretoria"
  source: "google" | "osm";
  placeId?: string; // Google: coordinates come from Place Details
  lat?: number; // OSM: coordinates come with the suggestion
  lng?: number;
};
export type ResolvedPlace = { lat: number; lng: number; address: string };

const GOOGLE_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "";
const ZA_BBOX = "16.3,-34.9,33.0,-22.1"; // lon/lat box around South Africa

/** One session per search (typing → pick). Google bills a whole session as a single lookup. */
export function newSearchSession() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

let googleDown = false; // stop retrying Google for the rest of this app run if it refuses our key

export type PlaceKind = "any" | "area";

async function googleSuggestions(text: string, session: string, near?: { lat: number; lng: number }, kind: PlaceKind = "any") {
  const params = new URLSearchParams({
    input: text,
    key: GOOGLE_KEY,
    components: "country:za",
    sessiontoken: session,
    language: "en",
  });
  if (kind === "area") params.set("types", "(regions)"); // suburbs, towns and cities only
  if (near) {
    params.set("location", `${near.lat},${near.lng}`);
    params.set("radius", "50000");
  }
  const res = await fetch(`https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`);
  const data = await res.json();
  if (data.status === "ZERO_RESULTS") return [];
  if (data.status !== "OK") throw new Error(data.status || "google_error");
  return (data.predictions || []).slice(0, 6).map(
    (p: any): PlaceSuggestion => ({
      id: p.place_id,
      placeId: p.place_id,
      title: p.structured_formatting?.main_text || p.description,
      subtitle: p.structured_formatting?.secondary_text || "",
      source: "google",
    })
  );
}

async function osmSuggestions(text: string, near?: { lat: number; lng: number }, kind: PlaceKind = "any") {
  const params = new URLSearchParams({ q: text, limit: "8", lang: "en", bbox: ZA_BBOX });
  if (kind === "area") ["city", "district", "locality"].forEach((l) => params.append("layer", l));
  if (near) {
    params.set("lat", String(near.lat));
    params.set("lon", String(near.lng));
  }
  const res = await fetch(`https://photon.komoot.io/api/?${params}`);
  const data = await res.json();
  const seen = new Set<string>();
  const out: PlaceSuggestion[] = [];
  for (const f of data.features || []) {
    const p = f.properties || {};
    if (p.countrycode && String(p.countrycode).toUpperCase() !== "ZA") continue;
    const [lng, lat] = f.geometry?.coordinates || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const street = [p.housenumber, p.street].filter(Boolean).join(" ");
    const title = p.name || street || p.district || p.city;
    if (!title) continue;
    const subtitle = [p.name ? street : "", p.district || p.locality, p.city, p.state]
      .filter((x, i, a) => x && x !== title && a.indexOf(x) === i)
      .join(", ");
    const key = `${title}|${subtitle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: `${p.osm_type || "o"}${p.osm_id || out.length}`, title, subtitle, lat, lng, source: "osm" });
    if (out.length >= 6) break;
  }
  return out;
}

/** Suggestions for what the user has typed so far (needs at least 2 characters). */
export async function searchPlaces(text: string, session: string, near?: { lat: number; lng: number }, kind: PlaceKind = "any"): Promise<PlaceSuggestion[]> {
  const q = text.trim();
  if (q.length < 2) return [];
  if (GOOGLE_KEY && !googleDown) {
    try {
      return await googleSuggestions(q, session, near, kind);
    } catch (e: any) {
      if (["REQUEST_DENIED", "OVER_QUERY_LIMIT", "INVALID_REQUEST"].includes(e?.message)) googleDown = true;
    }
  }
  try {
    return await osmSuggestions(q, near, kind);
  } catch {
    return [];
  }
}

/** Exact coordinates for the suggestion the user picked. */
export async function resolvePlace(s: PlaceSuggestion, session: string): Promise<ResolvedPlace | null> {
  const address = [s.title, s.subtitle].filter(Boolean).join(", ");
  if (Number.isFinite(s.lat) && Number.isFinite(s.lng)) return { lat: s.lat!, lng: s.lng!, address };
  if (!s.placeId || !GOOGLE_KEY) return null;
  try {
    const params = new URLSearchParams({ place_id: s.placeId, key: GOOGLE_KEY, fields: "geometry,formatted_address", sessiontoken: session });
    const res = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params}`);
    const data = await res.json();
    const loc = data?.result?.geometry?.location;
    // Google's full address, without ", South Africa" at the end
    const full = String(data?.result?.formatted_address || "").replace(/,\s*South Africa$/i, "");
    return loc ? { lat: loc.lat, lng: loc.lng, address: full || address } : null;
  } catch {
    return null;
  }
}
