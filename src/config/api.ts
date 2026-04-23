/**
 * Square Backend API configuration.
 * Base URL for the managed Lightning node backend.
 * Never send seed phrase or private keys to the backend.
 */

export const API_CONFIG = {
  /** Base URL for Square Lightning backend (invoice, pay, balance, username). */
  baseUrl: process.env.EXPO_PUBLIC_SQUARE_API_URL ?? 'https://api.square.example.com',
} as const;

export function getApiBaseUrl(): string {
  return API_CONFIG.baseUrl.replace(/\/$/, '');
}
