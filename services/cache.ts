// services/cache.ts — small on-device cache (AsyncStorage) so lists show instantly when the app opens
// or the network is slow, and then update live from Firestore ("show cached, then refresh").
// Keys are per signed-in user; everything is cleared on log out.
import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "@wiji_cache_v1:";
const timers: Record<string, ReturnType<typeof setTimeout>> = {};

export async function readCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw).data as T) : null;
  } catch {
    return null;
  }
}

/** Save (debounced, so fast-changing live data doesn't hammer storage). */
export function writeCache(key: string, data: unknown, delayMs = 800) {
  if (timers[key]) clearTimeout(timers[key]);
  timers[key] = setTimeout(() => {
    AsyncStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), data })).catch(() => undefined);
  }, delayMs);
}

export async function clearCaches() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(PREFIX) || k.startsWith("cached_communities")));
  } catch {}
}
