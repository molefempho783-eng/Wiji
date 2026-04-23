/**
 * Simple in-memory user store for mapping usernames and pubkeys.
 * For production you should back this with a real database.
 */

export interface UserRecord {
  username: string;
  pubkey: string;
}

const usersByName = new Map<string, UserRecord>();
const usersByPubkey = new Map<string, UserRecord>();

export function upsertUser(username: string, pubkey: string): UserRecord {
  const key = username.trim().toLowerCase();
  const record: UserRecord = { username: key, pubkey };
  usersByName.set(key, record);
  usersByPubkey.set(pubkey, record);
  return record;
}

export function findUserByName(username: string): UserRecord | undefined {
  const key = username.trim().toLowerCase();
  return usersByName.get(key);
}

export function findUserByPubkey(pubkey: string): UserRecord | undefined {
  return usersByPubkey.get(pubkey);
}

