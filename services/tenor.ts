/**
 * GIF/sticker API for chat (WhatsApp-style).
 * Uses KLIPY (Tenor alternative). Set EXPO_PUBLIC_KLIPY_API_KEY in .env.
 * Re-exports for backward compatibility with GifStickerPicker and chat screens.
 */

import {
  fetchFeaturedGifs as klipyFeatured,
  searchGifs as klipySearch,
  isGifConfigured,
  GifItem,
} from './klipy';

export type TenorGif = GifItem;

export const fetchFeaturedGifs = klipyFeatured;
export const searchGifs = klipySearch;

/** Use KLIPY; show GIF option when EXPO_PUBLIC_KLIPY_API_KEY is set. */
export function isTenorConfigured(): boolean {
  return isGifConfigured();
}
