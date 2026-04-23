/**
 * KLIPY API – WhatsApp-style GIFs & stickers (Tenor alternative).
 * Free API: https://klipy.com/developers
 *
 * Key can be set via:
 * 1) Firebase Functions secret (recommended): firebase functions:secrets:set KLIPY_SECRET
 *    Then deploy getKlipyTrending + getKlipySearch. App calls these when no client key is set.
 * 2) Firebase Remote Config: parameter "klipy_api_key". Call primeKlipyKeyFromFirebase() at app start.
 * 3) EAS Secrets / .env: EXPO_PUBLIC_KLIPY_API_KEY (for builds).
 */

let envKey = '';
let remoteConfigKey = '';

/** Read env at runtime so Expo-injected EXPO_PUBLIC_* is always picked up after bundle load. */
function readEnvKey(): string {
  try {
    const fromEnv = (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_KLIPY_API_KEY) || '';
    if (fromEnv && typeof fromEnv === 'string') envKey = fromEnv.trim();
  } catch (_) {}
  return envKey || remoteConfigKey;
}

/** Call once at app start to load KLIPY key from Firebase Remote Config (parameter: klipy_api_key). */
export async function primeKlipyKeyFromFirebase(): Promise<void> {
  if (readEnvKey()) return;
  // Skip Remote Config in React Native – the web SDK uses indexedDB which doesn't exist there.
  if (typeof globalThis !== 'undefined' && !('indexedDB' in globalThis)) {
    return;
  }
  try {
    const { getRemoteConfig, fetchAndActivate, getString } = await import('firebase/remote-config');
    const { app } = await import('../firebaseConfig');
    const rc = getRemoteConfig(app);
    await fetchAndActivate(rc);
    const str = getString(rc, 'klipy_api_key') ?? '';
    if (str) remoteConfigKey = str.trim();
  } catch (e) {
    console.warn('KLIPY: Remote Config not available or klipy_api_key missing.', e);
  }
}

/** Inject key from Remote Config (used after prime). Exported for tests. */
export function setKlipyApiKey(key: string): void {
  remoteConfigKey = key ? key.trim() : '';
}

function getApiKey(): string {
  return readEnvKey();
}

function getBaseUrl(): string {
  const key = getApiKey();
  if (!key) return '';
  return `https://api.klipy.com/api/v1/${key}/gifs`;
}

export interface GifItem {
  id: string;
  url: string;
  tinyUrl: string;
  title?: string;
}

/** Extract URL from a nested format object (e.g. { url: "https://..." }). */
function urlFromFormat(f: any): string {
  if (!f || typeof f !== 'object') return '';
  return f.url || f.uri || f.src || '';
}

/** KLIPY returns URLs in content_formats, media_formats, or files. Accept Tenor-style and Klipy-native shapes. */
function parseItem(item: any): GifItem {
  const id = item.id || item.slug || item.gif_id || item.slug_id || String(Math.random());
  let url = '';
  let tinyUrl = '';

  // Klipy native: content_formats (e.g. { gif: { url }, medium: { url }, tiny: { url } })
  const contentFormats = item.content_formats || item.media_formats || item.formats;
  if (contentFormats && typeof contentFormats === 'object') {
    const m = contentFormats;
    const gif = m.gif || m.mediumgif || m.medium || m.large;
    const tiny = m.tinygif || m.nanogif || m.tiny || m.small || m.nano || gif;
    url = urlFromFormat(gif) || urlFromFormat(tiny) || url;
    tinyUrl = urlFromFormat(tiny) || urlFromFormat(gif) || url || tinyUrl;
  }
  if (item.files && typeof item.files === 'object') {
    const f = item.files;
    url = urlFromFormat(f.gif) || urlFromFormat(f.medium) || urlFromFormat(f.large) || urlFromFormat(f.small) || url;
    tinyUrl = urlFromFormat(f.tiny) || urlFromFormat(f.small) || urlFromFormat(f.nano) || url || tinyUrl;
  }
  if (item.media && typeof item.media === 'object') {
    const m = item.media;
    url = urlFromFormat(m.gif) || urlFromFormat(m.medium) || urlFromFormat(m.small) || url;
    tinyUrl = urlFromFormat(m.tiny) || urlFromFormat(m.small) || url || tinyUrl;
  }
  if (!url && item.url) url = item.url;
  if (!url && item.src) url = item.src;
  if (!url && item.uri) url = item.uri;
  if (!tinyUrl) tinyUrl = url;
  if (!url && item.images?.original?.url) url = item.images.original.url;
  if (!tinyUrl && item.images?.fixed_height_small?.url) tinyUrl = item.images.fixed_height_small.url;
  if (!url && item.image) url = typeof item.image === 'string' ? item.image : urlFromFormat(item.image);

  // Last resort: scan object for any nested { url } (e.g. item.preview.url, item.assets.original.url), max depth 4
  if (!url && typeof item === 'object') {
    const visit = (o: any, depth: number): string => {
      if (!o || typeof o !== 'object' || depth > 4) return '';
      if (Array.isArray(o)) return '';
      if (typeof o.url === 'string' && o.url.startsWith('http')) return o.url;
      if (typeof o.uri === 'string' && o.uri.startsWith('http')) return o.uri;
      for (const k of Object.keys(o)) {
        const v = visit(o[k], depth + 1);
        if (v) return v;
      }
      return '';
    };
    url = visit(item, 0);
    if (url && !tinyUrl) tinyUrl = url;
  }

  return {
    id: String(id),
    url,
    tinyUrl: tinyUrl || url,
    title: item.content_description || item.title || item.description || item.name || item.title_short || '',
  };
}

/** Fetch trending GIFs (like WhatsApp default picker). Uses KLIPY directly or Firebase callable when no client key. */
export async function fetchFeaturedGifs(
  limit = 24,
  pos?: string
): Promise<{ gifs: GifItem[]; next: string | null }> {
  const base = getBaseUrl();
  if (!base) {
    try {
      const { getFunctions, httpsCallable } = await import('firebase/functions');
      const { app } = await import('../firebaseConfig');
      const fn = httpsCallable<{ limit?: number; page?: string }, { gifs: GifItem[]; next: string | null }>(
        getFunctions(app, 'us-central1'),
        'getKlipyTrending'
      );
      const page = pos || '1';
      const { data } = await fn({ limit, page });
      return data ?? { gifs: [], next: null };
    } catch (e: any) {
      const msg = e?.message || e?.code || String(e);
      throw new Error(`GIFs unavailable: ${msg}. Set EXPO_PUBLIC_KLIPY_API_KEY or Firebase Remote Config klipy_api_key.`);
    }
  }
  const page = pos ? String(Math.max(1, parseInt(pos, 10) || 1)) : '1';
  const perPage = Math.min(50, Math.max(8, limit));
  const params = new URLSearchParams({ per_page: String(perPage), page });
  const res = await fetch(`${base}/trending?${params}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = json?.error || json?.message || res.statusText || '';
    throw new Error(`KLIPY trending: ${res.status} ${errMsg}`.trim());
  }
  const payload =
    json?.data?.data ??
    json?.data?.results ??
    json?.data?.items ??
    json?.data?.gifs ??
    json?.data ??
    json?.results ??
    json?.items ??
    json?.gifs ??
    (Array.isArray(json) ? json : []);
  const list = Array.isArray(payload) ? payload : [];
  const gifs = list.map(parseItem).filter((g: GifItem) => g.url);
  if (list.length > 0 && gifs.length === 0) {
    throw new Error('KLIPY returned items but none had a valid URL. Check API response format.');
  }
  const hasNext = json?.data?.has_next === true;
  const nextPage = hasNext ? String((parseInt(page, 10) || 1) + 1) : null;
  return { gifs, next: nextPage };
}

/** Search GIFs (e.g. "happy", "thanks", "love"). Uses KLIPY directly or Firebase callable when no client key. */
export async function searchGifs(
  query: string,
  limit = 24,
  pos?: string
): Promise<{ gifs: GifItem[]; next: string | null }> {
  const base = getBaseUrl();
  if (!base) {
    try {
      const { getFunctions, httpsCallable } = await import('firebase/functions');
      const { app } = await import('../firebaseConfig');
      const fn = httpsCallable<
        { query?: string; limit?: number; page?: string },
        { gifs: GifItem[]; next: string | null }
      >(getFunctions(app, 'us-central1'), 'getKlipySearch');
      const page = pos || '1';
      const { data } = await fn({ query: query.trim(), limit, page });
      return data ?? { gifs: [], next: null };
    } catch (e: any) {
      const msg = e?.message || e?.code || String(e);
      throw new Error(`GIF search failed: ${msg}. Set EXPO_PUBLIC_KLIPY_API_KEY or Firebase Remote Config klipy_api_key.`);
    }
  }
  const q = query.trim();
  if (!q) return fetchFeaturedGifs(limit, pos);
  const page = pos ? String(Math.max(1, parseInt(pos, 10) || 1)) : '1';
  const perPage = Math.min(50, Math.max(8, limit));
  const params = new URLSearchParams({ q, per_page: String(perPage), page });
  const res = await fetch(`${base}/search?${params}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = json?.error || json?.message || res.statusText || '';
    throw new Error(`KLIPY search: ${res.status} ${errMsg}`.trim());
  }
  const payload =
    json?.data?.data ??
    json?.data?.results ??
    json?.data?.items ??
    json?.data?.gifs ??
    json?.data ??
    json?.results ??
    json?.items ??
    json?.gifs ??
    (Array.isArray(json) ? json : []);
  const list = Array.isArray(payload) ? payload : [];
  const gifs = list.map(parseItem).filter((g: GifItem) => g.url);
  if (list.length > 0 && gifs.length === 0) {
    throw new Error('KLIPY returned items but none had a valid URL. Check API response format.');
  }
  const hasNext = json?.data?.has_next === true;
  const nextPage = hasNext ? String((parseInt(page, 10) || 1) + 1) : null;
  return { gifs, next: nextPage };
}

/** True when a client-side key is set or we can try Firebase callable (getKlipyTrending). */
export function isGifConfigured(): boolean {
  return true;
}
