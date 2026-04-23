/**
 * Derive a native segwit (P2WPKH) receive address per group from a server-held BIP39 mnemonic.
 * Spending requires the same mnemonic on the server — treat as custodial for operations.
 */

import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';
import * as ecc from '@bitcoinerlab/secp256k1';
import { bech32 } from 'bech32';
import { sha256 } from '@noble/hashes/sha2';
import { ripemd160 } from '@noble/hashes/legacy';
import axios from 'axios';

const bip32 = BIP32Factory(ecc);

const NET = {
  mainnet: {
    wif: 0x80,
    bip32Public: 0x0488b21e,
    bip32Private: 0x0488ade4,
    coinType: 0,
    hrp: 'bc' as const,
  },
  testnet: {
    wif: 0xef,
    bip32Public: 0x043587cf,
    bip32Private: 0x04358394,
    coinType: 1,
    hrp: 'tb' as const,
  },
};

function pubkeyToP2wpkhAddress(pubkey: Uint8Array, hrp: 'bc' | 'tb'): string {
  const hash160 = ripemd160(sha256(pubkey));
  const words = bech32.toWords(Buffer.from(hash160));
  words.unshift(0);
  return bech32.encode(hrp, words);
}

export function deriveGroupReceiveAddress(
  mnemonic: string,
  derivationIndex: number,
  testnet: boolean
): string {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!bip39.validateMnemonic(normalized)) {
    throw new Error('GROUP_WALLET_MNEMONIC is not a valid BIP39 phrase');
  }
  const seed = bip39.mnemonicToSeedSync(normalized);
  const p = testnet ? NET.testnet : NET.mainnet;
  const root = bip32.fromSeed(seed, {
    wif: p.wif,
    bip32: { public: p.bip32Public, private: p.bip32Private },
  });
  const path = `m/84'/${p.coinType}'/0'/0/${derivationIndex}`;
  const child = root.derivePath(path);
  return pubkeyToP2wpkhAddress(child.publicKey, p.hrp);
}

export function isGroupBtcTestnet(): boolean {
  const v = (process.env.GROUP_BTC_NETWORK || process.env.BTC_NETWORK || '')
    .toLowerCase()
    .trim();
  return v === 'testnet' || v === 'test';
}

function mempoolBase(testnet: boolean): string {
  return testnet
    ? 'https://mempool.space/testnet/api'
    : 'https://mempool.space/api';
}

export async function fetchAddressBalanceSats(
  address: string,
  testnet: boolean
): Promise<number> {
  const base = mempoolBase(testnet);
  const { data } = await axios.get(`${base}/address/${address}`, {
    timeout: 25_000,
  });
  const cs = data?.chain_stats ?? {};
  const ms = data?.mempool_stats ?? {};
  const funded = Number(cs.funded_txo_sum ?? 0) + Number(ms.funded_txo_sum ?? 0);
  const spent = Number(cs.spent_txo_sum ?? 0) + Number(ms.spent_txo_sum ?? 0);
  return Math.max(0, Math.floor(funded - spent));
}

/** Mempool.space transaction shape (subset). */
export type MempoolTx = {
  txid: string;
  vout?: Array<{ value?: number; scriptpubkey_address?: string }>;
  status?: {
    confirmed?: boolean;
    block_height?: number;
    block_time?: number;
  };
};

export async function fetchAddressTxs(
  address: string,
  testnet: boolean
): Promise<MempoolTx[]> {
  const base = mempoolBase(testnet);
  const { data } = await axios.get<MempoolTx[]>(
    `${base}/address/${address}/txs`,
    { timeout: 25_000 }
  );
  return Array.isArray(data) ? data : [];
}

export function satsReceivedToAddress(tx: MempoolTx, address: string): number {
  let s = 0;
  for (const v of tx.vout ?? []) {
    if (v.scriptpubkey_address === address) {
      s += Math.floor(Number(v.value ?? 0));
    }
  }
  return s;
}
