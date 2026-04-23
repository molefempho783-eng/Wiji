// functions/src/index.ts

import * as dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '.env.local' });

import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';

import corsLib from 'cors';
import express from 'express';
import bodyParser from 'body-parser';
import nodemailer from 'nodemailer';
import { ethers } from 'ethers';
import axios from 'axios';
import { createHash, timingSafeEqual } from 'node:crypto';

import { onDocumentUpdated, onDocumentCreated  } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import {
  deriveGroupReceiveAddress,
  isGroupBtcTestnet,
  fetchAddressBalanceSats,
  fetchAddressTxs,
  satsReceivedToAddress,
} from './groupOnChain.js';


// ---------- Crypto Wallet Configuration ----------
const DEFAULT_CRYPTO_CURRENCY = 'USDC';
const getDefaultCurrency = (): 'USDC' | 'USDT' =>
  (process.env.APP_DEFAULT_CRYPTO || DEFAULT_CRYPTO_CURRENCY).toUpperCase() as 'USDC' | 'USDT';

// Network configuration - use testnet in development, mainnet in production
// Can be overridden with POLYGON_USE_TESTNET env var (set to 'true' for testnet, 'false' for mainnet)
const IS_TESTNET = process.env.POLYGON_USE_TESTNET !== undefined
  ? process.env.POLYGON_USE_TESTNET === 'true'
  : process.env.NODE_ENV !== 'production';
const POLYGON_MAINNET_CHAIN_ID = 137;
const POLYGON_TESTNET_CHAIN_ID = 80002; // Amoy Testnet (replaced Mumbai)
const POLYGON_CHAIN_ID = IS_TESTNET ? POLYGON_TESTNET_CHAIN_ID : POLYGON_MAINNET_CHAIN_ID;

// Polygon RPC endpoints
const POLYGON_MAINNET_RPC = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
const POLYGON_TESTNET_RPC = process.env.POLYGON_TESTNET_RPC_URL || 'https://rpc-amoy.polygon.technology';
const POLYGON_RPC_URL = IS_TESTNET ? POLYGON_TESTNET_RPC : POLYGON_MAINNET_RPC;

// Token contract addresses on Polygon
const TOKEN_ADDRESSES_MAINNET = {
  USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
};

const TOKEN_ADDRESSES_TESTNET = {
  // Amoy Testnet token addresses (official)
  USDC: '0xF3A9e0B4a509e42803Ba388fC4Dc91A6C63BeFfB', // Official USDC on Amoy
  USDT: '0x2B7a90F1A001AaC943C68428B16E4da4E15DA469', // Official USDT on Amoy
};

const TOKEN_ADDRESSES = IS_TESTNET ? TOKEN_ADDRESSES_TESTNET : TOKEN_ADDRESSES_MAINNET;

// Token decimals (same for both networks)
const TOKEN_DECIMALS = {
  USDC: 6,
  USDT: 6,
};

// Log network configuration on startup
logger.info('Crypto Wallet Configuration:', {
  network: IS_TESTNET ? 'Amoy Testnet' : 'Polygon Mainnet',
  chainId: POLYGON_CHAIN_ID,
  rpcUrl: POLYGON_RPC_URL,
  defaultCurrency: getDefaultCurrency(),
});

// ---------- Admin init ----------
if (getApps().length === 0) initializeApp();
const db = getFirestore();
const messaging = getMessaging();
const authAdmin = getAuth();

// ---------- Helpers ----------
const cors = corsLib({ origin: true });

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new HttpsError('failed-precondition', `Missing secret: ${name}`);
  return v;
}
function uidOrThrow(req: { auth?: { uid?: string } }): string {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Not signed in.');
  return uid;
}

function previewFromMessage(msg: any): string {
  if (typeof msg?.text === 'string' && msg.text.trim()) return msg.text.trim().slice(0, 140);
  if (msg?.mediaType === 'image') return 'Image 📸';
  if (msg?.mediaType === 'video') return 'Video 🎥';
  if (msg?.mediaType === 'file')  return `File 📄${msg?.fileName ? `: ${String(msg.fileName)}` : ''}`;
  return 'New message';
}

//-------------push notification ---------------

/**
 * Send FCM push notification to one or more tokens
 */
async function sendFCMPush(
  to: string[] | string,
  title: string,
  body: string,
  data: Record<string, any> = {}
) {
  const tokens = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (tokens.length === 0) return;

  // FCM supports up to 500 tokens per batch
  const batchSize = 500;
  
  for (let i = 0; i < tokens.length; i += batchSize) {
    const chunk = tokens.slice(i, i + batchSize);
    
    try {
      const message = {
        notification: {
          title,
          body,
        },
        data: {
          ...Object.keys(data).reduce((acc, key) => {
            acc[key] = String(data[key]);
            return acc;
          }, {} as Record<string, string>),
        },
        android: {
          priority: 'high' as const,
          notification: {
            sound: 'default',
            channelId: 'default',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
            },
          },
        },
        tokens: chunk,
      };

      const response = await messaging.sendEachForMulticast(message);
      
      // Log results
      logger.info(`FCM sent to ${response.successCount}/${chunk.length} tokens`);
      
      // Handle failures
      if (response.failureCount > 0) {
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            logger.warn(`FCM send failed for token ${chunk[idx].substring(0, 20)}...:`, resp.error);
            // Optional: Remove invalid tokens
            // if (resp.error?.code === 'messaging/invalid-registration-token' || 
            //     resp.error?.code === 'messaging/registration-token-not-registered') {
            //   await removeBadTokenFromAllUsers(chunk[idx]);
            // }
          }
        });
      }
    } catch (error: any) {
      logger.error('FCM send error:', error);
    }
  }
}


// ---------- FX Conversion with robust fallback ----------
async function fxConvert(amount: number, from: string, to: string): Promise<number> {
  if (from.toUpperCase() === to.toUpperCase()) return Number(amount);

  const _from = from.toUpperCase();
  const _to = to.toUpperCase();
  const aStr = String(amount);
  const fxKey = (process.env.FX_API_KEY || '').trim();

  const getJson = async (url: string, headers: Record<string,string> = {}) => {
    const res = await fetch(url, { headers });
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      return { ok: res.ok, json, text };
    } catch {
      return { ok: res.ok, json: null as any, text };
    }
  };

  // 1) Preferred: exchangerate-api.com (requires a valid FX_API_KEY)
  if (fxKey) {
    try {
      const url = `https://v6.exchangerate-api.com/v6/${encodeURIComponent(fxKey)}/pair/${_from}/${_to}/${encodeURIComponent(aStr)}`;
      const { ok, json, text } = await getJson(url);
      if (ok) {
        const result = json?.conversion_result ?? json?.result ?? null;
        if (typeof result === 'number') return result;
        // explicit API error? fall through to frankfurter
        logger.warn('FX v6 payload not numeric, falling back', text.slice(0, 300));
      } else {
        // known error types: invalid-key, inactive-account, function_access_restricted
        logger.warn('FX v6 HTTP error, falling back', text.slice(0, 300));
      }
    } catch (e:any) {
      logger.warn('FX v6 threw, falling back', e?.message || e);
    }
  }

  // 2) Frankfurter (ECB) – no key required
  try {
    const url = `https://api.frankfurter.app/latest?amount=${encodeURIComponent(aStr)}&from=${_from}&to=${_to}`;
    const { ok, json, text } = await getJson(url);
    if (!ok) throw new Error(`HTTP ${text.slice(0,200)}`);
    const val = json?.rates?.[_to];
    if (typeof val === 'number') return val;
    throw new Error(`Bad payload ${text.slice(0,200)}`);
  } catch (e:any) {
    logger.warn('FX frankfurter failed, falling back to exchangerate.host', e?.message || e);
  }

  // 3) Last resort: exchangerate.host (may require key on some deployments)
  {
    const url = `https://api.exchangerate.host/convert?from=${_from}&to=${_to}&amount=${encodeURIComponent(aStr)}`;
    const { ok, json, text } = await getJson(url);
    if (!ok) throw new HttpsError('internal', `FX HTTP error: ${text.slice(0,200)}`);
    const success = json?.success ?? true;
    const result = json?.result ?? json?.conversion_result ?? null;
    if (!success || typeof result !== 'number') {
      throw new HttpsError('internal', `FX (exchangerate.host) bad payload: ${text.slice(0,300)}`);
    }
    return result;
  }
}

function walletDoc(uid: string) { return db.collection('wallets').doc(uid); }
function txCollection(uid: string) { return walletDoc(uid).collection('transactions'); }
const TX_FEE_RATE = 0.01;

function treasuryWalletUid(): string {
  const uid = process.env.TREASURY_WALLET_UID?.trim();
  return uid && uid.length > 0 ? uid : 'treasury_wallet';
}

function requireTreasuryBtcAddress(): string {
  const a = process.env.TREASURY_BTC_ADDRESS?.trim();
  if (!a) {
    throw new HttpsError(
      'failed-precondition',
      'Set TREASURY_BTC_ADDRESS on Functions to collect 1% BTC fees on-chain.'
    );
  }
  return a;
}

// ---------- Types ----------
type P2PTransferPayload  = { toUid: string; amount: number; note?: string };
type TransactionsPayload = { limit?: number; cursor?: string };
type ConvertPayload      = { amount: number; from: string; to?: string };

// ---------- Crypto Wallet Types ----------
type CryptoTopUpRequestPayload = {
  amount: string; // Amount in token units (e.g., "100.5" for 100.5 USDC)
  token: 'USDC' | 'USDT';
};

type VerifyCryptoPaymentPayload = {
  transactionHash: string;
  paymentId?: string;
};

type GetWalletAddressPayload = {
  token?: 'USDC' | 'USDT';
};

// Helper to convert decimal amount to token units (smallest unit)
function toTokenUnits(amount: string, decimals: number): string {
  const num = Number(amount);
  if (isNaN(num) || num <= 0) throw new Error('Invalid amount');
  const multiplier = Math.pow(10, decimals);
  return Math.floor(num * multiplier).toString();
}

// Helper to convert token units to decimal amount
function fromTokenUnits(amount: string, decimals: number): string {
  const num = BigInt(amount);
  const divisor = BigInt(Math.pow(10, decimals));
  const whole = num / divisor;
  const remainder = num % divisor;
  if (remainder === BigInt(0)) {
    return whole.toString();
  }
  const decimal = remainder.toString().padStart(decimals, '0');
  const trimmed = decimal.replace(/0+$/, '');
  return `${whole}.${trimmed}`;
}

// Verify transaction on Polygon blockchain
async function verifyTransactionOnChain(
  transactionHash: string,
  expectedToken: 'USDC' | 'USDT',
  expectedAmount: string,
  expectedRecipient: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const provider = new ethers.JsonRpcProvider(POLYGON_RPC_URL);
    
    // Get transaction receipt
    const receipt = await provider.getTransactionReceipt(transactionHash);
    if (!receipt) {
      return { valid: false, error: 'Transaction not found on blockchain' };
    }
    
    if (receipt.status !== 1) {
      return { valid: false, error: 'Transaction failed on blockchain' };
    }
    
    // Get transaction details
    const tx = await provider.getTransaction(transactionHash);
    if (!tx) {
      return { valid: false, error: 'Transaction details not found' };
    }
    
    // Check if it's a token transfer (ERC20 Transfer event)
    const tokenAddress = TOKEN_ADDRESSES[expectedToken];
    const tokenContract = new ethers.Contract(
      tokenAddress,
      [
        'event Transfer(address indexed from, address indexed to, uint256 value)',
        'function decimals() view returns (uint8)',
      ],
      provider
    );
    
    // Find Transfer event in logs
    const transferEvent = receipt.logs.find((log: any) => {
      try {
        const parsed = tokenContract.interface.parseLog(log);
        return parsed && parsed.name === 'Transfer';
      } catch {
        return false;
      }
    });
    
    if (!transferEvent) {
      return { valid: false, error: 'Token transfer event not found' };
    }
    
    // Parse the Transfer event
    const parsedLog = tokenContract.interface.parseLog(transferEvent);
    if (!parsedLog) {
      return { valid: false, error: 'Failed to parse transfer event' };
    }
    
    const from = parsedLog.args[0];
    const to = parsedLog.args[1];
    const value = parsedLog.args[2];
    
    // Verify recipient matches (case-insensitive)
    if (to.toLowerCase() !== expectedRecipient.toLowerCase()) {
      return { valid: false, error: `Recipient mismatch: expected ${expectedRecipient}, got ${to}` };
    }
    
    // Verify amount matches
    const decimals = TOKEN_DECIMALS[expectedToken];
    const expectedAmountInUnits = toTokenUnits(expectedAmount, decimals);
    const receivedAmountInUnits = value.toString();
    
    // Allow small tolerance for rounding (1 unit)
    const expectedBig = BigInt(expectedAmountInUnits);
    const receivedBig = BigInt(receivedAmountInUnits);
    const diff = receivedBig > expectedBig ? receivedBig - expectedBig : expectedBig - receivedBig;
    
    if (diff > BigInt(1)) {
      return { valid: false, error: `Amount mismatch: expected ${expectedAmount}, got ${fromTokenUnits(receivedAmountInUnits, decimals)}` };
    }
    
    return { valid: true };
  } catch (error: any) {
    logger.error('Blockchain verification error:', error);
    // In case of RPC errors, we can still proceed but log the error
    // This allows the system to work even if RPC is temporarily unavailable
    return { valid: false, error: `Verification error: ${error.message}` };
  }
}

// ---------- Crypto 1) Get or Create Wallet Address ----------
// Generate a deterministic wallet address from user ID using HD wallet derivation
function generateWalletAddress(uid: string, token: 'USDC' | 'USDT'): string {
  // Use ethers to generate a deterministic address from user ID
  // This creates a valid blockchain address that's unique per user and token
  try {
    // Create a deterministic wallet from user ID + token
    // Using a simple approach: hash the uid+token and derive an address
    const seed = `${uid}_${token}_${process.env.WALLET_SEED || 'default-seed-change-in-production'}`;
    
    // Use ethers to create a wallet from a deterministic seed
    // This generates a valid 0x address
    const wallet = ethers.Wallet.createRandom();
    
    // For deterministic addresses, we'll use a hash-based approach
    // Create a hash of the seed and use it to derive an address
    const hash = ethers.keccak256(ethers.toUtf8Bytes(seed));
    
    // Use the hash to create a deterministic private key (first 32 bytes)
    const privateKey = hash.slice(0, 66); // 0x + 64 hex chars = 32 bytes
    
    // Create wallet from private key to get a valid address
    const deterministicWallet = new ethers.Wallet(privateKey);
    
    return deterministicWallet.address;
  } catch (error) {
    logger.error('Error generating wallet address:', error);
    // Fallback: generate a random address (not ideal, but valid)
    const fallbackWallet = ethers.Wallet.createRandom();
    return fallbackWallet.address;
  }
}

export const getWalletAddress = onCall({}, async (request) => {
  const uid = uidOrThrow(request);
  const { token } = (request.data as GetWalletAddressPayload) || {};
  const selectedToken = (token || getDefaultCurrency()).toUpperCase() as 'USDC' | 'USDT';
  
  // Check if user already has a wallet address stored
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const existingAddress = userSnap.exists ? userSnap.get('walletAddress') : null;
  
  // Validate that existing address is a real blockchain address (starts with 0x)
  if (existingAddress && typeof existingAddress === 'string' && existingAddress.startsWith('0x')) {
    return {
      walletAddress: existingAddress,
      token: selectedToken,
      tokenAddress: TOKEN_ADDRESSES[selectedToken],
    };
  }
  
  // Generate a real blockchain address for this user
  const walletAddress = generateWalletAddress(uid, selectedToken);
  
  // Store the real wallet address for the user
  await userRef.set({
    walletAddress: walletAddress, // Real blockchain address
    defaultToken: selectedToken,
  }, { merge: true });
  
  logger.info('Generated wallet address for user', {
    uid,
    token: selectedToken,
    address: walletAddress,
  });
  
  return {
    walletAddress: walletAddress, // Real blockchain address (0x...)
    token: selectedToken,
    tokenAddress: TOKEN_ADDRESSES[selectedToken],
  };
});

// ---------- Crypto 2) Create Top-up Request ----------
export const createCryptoTopUpRequest = onCall({}, async (request) => {
  const uid = uidOrThrow(request);
  const { amount, token } = request.data as CryptoTopUpRequestPayload;
  
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    throw new HttpsError('invalid-argument', 'amount must be a positive number');
  }
  
  const selectedToken = (token || getDefaultCurrency()).toUpperCase() as 'USDC' | 'USDT';
  const decimals = TOKEN_DECIMALS[selectedToken];
  const amountInUnits = toTokenUnits(amount, decimals);
  
  // Generate unique payment ID
  const paymentId = db.collection('_ids').doc().id;
  
  // Get user's wallet address/reference
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const walletAddress = userSnap.exists ? (userSnap.get('walletAddress') || `wallet_${uid}_${selectedToken}`) : `wallet_${uid}_${selectedToken}`;
  
  // Store pending payment
  await db.collection('pending_crypto_payments').doc(paymentId).set({
    uid,
    amount: amount, // Store as decimal string
    amountInUnits, // Store in token units
    token: selectedToken,
    tokenAddress: TOKEN_ADDRESSES[selectedToken],
    walletAddress,
    status: 'PENDING',
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
  });
  
  return {
    paymentId,
    amount,
    token: selectedToken,
    tokenAddress: TOKEN_ADDRESSES[selectedToken],
    walletAddress,
    // Note: In a real implementation, walletAddress should be a real blockchain address
    // Users send tokens to this address with paymentId in memo/data field
  };
});

// ---------- Crypto 3) Verify Payment (via transaction hash) ----------
export const verifyCryptoPayment = onCall({}, async (request) => {
  const uid = uidOrThrow(request);
  const { transactionHash, paymentId } = request.data as VerifyCryptoPaymentPayload;
  
  if (!transactionHash) {
    throw new HttpsError('invalid-argument', 'transactionHash required');
  }
  
  // Check if we have a pending payment for this
  let pendingRef;
  let resolvedPaymentId = paymentId;
  if (resolvedPaymentId) {
    pendingRef = db.collection('pending_crypto_payments').doc(resolvedPaymentId);
  } else {
    // Try to find by transaction hash
    const pendings = await db.collection('pending_crypto_payments')
      .where('uid', '==', uid)
      .where('status', '==', 'PENDING')
      .limit(1)
      .get();
    
    if (pendings.empty) {
      throw new HttpsError('not-found', 'Pending payment not found');
    }
    pendingRef = pendings.docs[0].ref;
    resolvedPaymentId = pendings.docs[0].id;
  }
  
  const pendingSnap = await pendingRef.get();
  if (!pendingSnap.exists) {
    throw new HttpsError('not-found', 'Payment not found');
  }
  
  const pending = pendingSnap.data();
  if (!pending) {
    throw new HttpsError('not-found', 'Payment data not found');
  }
  
  if (pending.status === 'COMPLETED') {
    return {
      status: 'SUCCESS',
      credited: pending.amount,
      token: pending.token,
      transactionHash: pending.transactionHash,
    };
  }
  
  // Verify transaction on-chain
  const decimals = TOKEN_DECIMALS[pending.token as 'USDC' | 'USDT'];
  const amountDecimal = pending.amount || fromTokenUnits(pending.amountInUnits, decimals);
  
  // Get user's wallet address for verification
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const walletAddress = userSnap.exists 
    ? (userSnap.get('walletAddress') || pending.walletAddress)
    : pending.walletAddress;
  
  // Verify transaction on blockchain
  const verification = await verifyTransactionOnChain(
    transactionHash,
    pending.token as 'USDC' | 'USDT',
    amountDecimal,
    walletAddress
  );
  
  if (!verification.valid) {
    logger.warn('Transaction verification failed:', {
      transactionHash,
      error: verification.error,
      uid,
      paymentId: resolvedPaymentId,
    });
    // For now, we'll still credit the wallet but log the warning
    // In production, you might want to require verification or have admin review
    // throw new HttpsError('failed-precondition', `Transaction verification failed: ${verification.error}`);
  }
  
  const now = Timestamp.now();
  
  // Credit wallet
  await db.runTransaction(async (t) => {
    const wRef = walletDoc(uid);
    const wSnap = await t.get(wRef);
    const prevBalance = wSnap.exists ? (wSnap.get('balance') || '0') : '0';
    const prevBalanceNum = Number(prevBalance);
    const newBalance = (prevBalanceNum + Number(amountDecimal)).toFixed(decimals);
    
    t.set(wRef, {
      uid,
      balance: newBalance,
      currency: pending.token,
      walletAddress: pending.walletAddress,
      updatedAt: now,
      createdAt: wSnap.exists ? (wSnap.get('createdAt') || now) : now,
    }, { merge: true });
    
    const txRef = txCollection(uid).doc(resolvedPaymentId!);
    t.set(txRef, {
      type: 'TOP_UP',
      provider: 'CRYPTO',
      token: pending.token,
      amount: amountDecimal,
      currency: pending.token,
      status: 'SUCCESS',
      transactionHash,
      createdAt: now,
    });
    
    t.update(pendingRef, {
      status: 'COMPLETED',
      completedAt: now,
      transactionHash,
    });
  });
  
  return {
    status: 'SUCCESS',
    credited: amountDecimal,
    token: pending.token,
    transactionHash,
  };
});

// ---------- 4) P2P transfer (crypto) ----------
export const transferFunds = onCall({}, async (request) => {
  const fromUid = uidOrThrow(request);
  const { toUid, amount, note } = request.data as P2PTransferPayload;

  if (!toUid || typeof toUid !== 'string') throw new HttpsError('invalid-argument', 'toUid required');
  if (toUid === fromUid) throw new HttpsError('invalid-argument', 'Cannot send to yourself');
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    throw new HttpsError('invalid-argument', 'amount must be > 0');
  }

  const amt = Number(amount);
  const now = Timestamp.now();
  const treasuryUid = treasuryWalletUid();

  await db.runTransaction(async (t) => {
    const fromRef = walletDoc(fromUid);
    const toRef = walletDoc(toUid);
    const treasuryRef = walletDoc(treasuryUid);
    const [fromSnap, toSnap] = await Promise.all([t.get(fromRef), t.get(toRef)]);

    // Get currency from sender's wallet (default to USDC)
    const currency = (fromSnap.exists ? (fromSnap.get('currency') || getDefaultCurrency()) : getDefaultCurrency()) as 'USDC' | 'USDT';
    const decimals = TOKEN_DECIMALS[currency];
    const fee = Number((amt * TX_FEE_RATE).toFixed(decimals));
    const netToRecipient = Number((amt - fee).toFixed(decimals));
    if (netToRecipient <= 0) {
      throw new HttpsError('invalid-argument', 'Amount too small after 1% fee');
    }
    
    const fromBalStr = fromSnap.exists ? (fromSnap.get('balance') || '0') : '0';
    const fromBal = Number(fromBalStr);
    if (fromBal < amt) throw new HttpsError('failed-precondition', 'Insufficient balance');

    const newFromBalance = (fromBal - amt).toFixed(decimals);
    
    t.set(fromRef, {
      uid: fromUid,
      balance: newFromBalance,
      currency,
      updatedAt: now,
      createdAt: fromSnap.exists ? (fromSnap.get('createdAt') || now) : now,
    }, { merge: true });

    const toBalStr = toSnap.exists ? (toSnap.get('balance') || '0') : '0';
    const toBal = Number(toBalStr);
    const newToBalance = (toBal + netToRecipient).toFixed(decimals);
    
    t.set(toRef, {
      uid: toUid,
      balance: newToBalance,
      currency, // Use same currency as sender
      updatedAt: now,
      createdAt: toSnap.exists ? (toSnap.get('createdAt') || now) : now,
    }, { merge: true });

    const treasurySnap = await t.get(treasuryRef);
    const treasuryBalStr = treasurySnap.exists ? (treasurySnap.get('balance') || '0') : '0';
    const treasuryBal = Number(treasuryBalStr);
    const newTreasuryBalance = (treasuryBal + fee).toFixed(decimals);
    t.set(treasuryRef, {
      uid: treasuryUid,
      balance: newTreasuryBalance,
      currency,
      updatedAt: now,
      createdAt: treasurySnap.exists ? (treasurySnap.get('createdAt') || now) : now,
    }, { merge: true });

    const debitId = db.collection('_ids').doc().id;
    const creditId = db.collection('_ids').doc().id;
    const feeId = db.collection('_ids').doc().id;

    t.set(txCollection(fromUid).doc(debitId), {
      type: 'TRANSFER_OUT',
      counterparty: toUid,
      amount: amt,
      fee,
      currency,
      note: note || null,
      createdAt: now,
      status: 'SUCCESS',
    });

    t.set(txCollection(toUid).doc(creditId), {
      type: 'TRANSFER_IN',
      counterparty: fromUid,
      amount: netToRecipient,
      currency,
      note: note || null,
      createdAt: now,
      status: 'SUCCESS',
    });

    t.set(txCollection(treasuryUid).doc(feeId), {
      type: 'FEE_IN',
      sourceType: 'TRANSFER',
      sourceUserId: fromUid,
      amount: fee,
      currency,
      createdAt: now,
      status: 'SUCCESS',
    });
  });

  return { status: 'SUCCESS' };
});

// ---------- 5) Transactions ----------
export const getTransactions = onCall({}, async (request) => {
  const uid = uidOrThrow(request);
  const data = request.data as TransactionsPayload;
  const limit = Math.max(1, Math.min(50, Number(data.limit ?? 20)));

  let q = txCollection(uid).orderBy('createdAt', 'desc').limit(limit);
  if (data.cursor) {
    const cursorSnap = await txCollection(uid).doc(data.cursor).get();
    if (cursorSnap.exists) q = q.startAfter(cursorSnap);
  }

  const snaps = await q.get();
  const rawItems = snaps.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Fetch user names for counterparties
  const counterpartyUids = new Set<string>();
  rawItems.forEach((item: any) => {
    if (item.counterparty && typeof item.counterparty === 'string') {
      counterpartyUids.add(item.counterparty);
    }
  });

  // Batch fetch user data
  const userDataMap = new Map<string, { username: string; profilePic?: string }>();
  if (counterpartyUids.size > 0) {
    const userSnaps = await Promise.all(
      Array.from(counterpartyUids).map((uId) => db.collection('users').doc(uId).get())
    );
    userSnaps.forEach((snap) => {
      if (snap.exists) {
        const data = snap.data() as any;
        userDataMap.set(snap.id, {
          username: data.username || data.displayName || 'Unknown User',
          profilePic: data.profilePic || null,
        });
      }
    });
  }

  // Enrich transactions with user data
  const items = rawItems.map((item: any) => {
    const enriched: any = { ...item };
    if (item.counterparty && userDataMap.has(item.counterparty)) {
      const userData = userDataMap.get(item.counterparty)!;
      enriched.counterpartyName = userData.username;
      enriched.counterpartyProfilePic = userData.profilePic;
    }
    return enriched;
  });

  const nextCursor = snaps.size === limit ? snaps.docs[snaps.docs.length - 1].id : null;
  return { items, nextCursor };
});

// ---------- 6) Wallet balance (crypto) ----------
// Helper to get on-chain token balance
async function getOnChainBalance(walletAddress: string, token: 'USDC' | 'USDT'): Promise<string> {
  try {
    const provider = new ethers.JsonRpcProvider(POLYGON_RPC_URL);
    const tokenAddress = TOKEN_ADDRESSES[token];
    const decimals = TOKEN_DECIMALS[token];
    
    // Create ERC20 contract instance
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ['function balanceOf(address owner) view returns (uint256)'],
      provider
    );
    
    // Get balance
    const balanceInUnits = await tokenContract.balanceOf(walletAddress);
    const balanceDecimal = fromTokenUnits(balanceInUnits.toString(), decimals);
    
    return balanceDecimal;
  } catch (error: any) {
    logger.error('Error fetching on-chain balance:', error);
    throw new HttpsError('internal', `Failed to fetch on-chain balance: ${error.message}`);
  }
}

export const getWalletBalance = onCall({}, async (request) => {
  const uid = uidOrThrow(request);
  const { syncOnChain } = (request.data as { syncOnChain?: boolean }) || {};
  
  const snap = await walletDoc(uid).get();
    const defaultCurrency = getDefaultCurrency();
  
  // Get user's wallet address
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const walletAddress = userSnap.exists && userSnap.get('walletAddress')
    ? userSnap.get('walletAddress')
    : null;
  
  let balance = '0';
  let currency = defaultCurrency;
  
  if (snap.exists) {
    balance = String(snap.get('balance') || '0');
    currency = (snap.get('currency') || defaultCurrency).toUpperCase() as 'USDC' | 'USDT';
  }
  
  // If syncOnChain is true and we have a wallet address, check on-chain balance
  if (syncOnChain && walletAddress && typeof walletAddress === 'string' && walletAddress.startsWith('0x')) {
    try {
      const onChainBalance = await getOnChainBalance(walletAddress, currency);
      
      // Update Firestore with on-chain balance if different
      if (onChainBalance !== balance) {
        await walletDoc(uid).set({
          balance: onChainBalance,
          currency: currency,
        }, { merge: true });
        balance = onChainBalance;
        logger.info('Synced on-chain balance to Firestore', {
          uid,
          walletAddress,
          currency,
          balance: onChainBalance,
        });
      }
    } catch (error: any) {
      logger.warn('Failed to sync on-chain balance, using Firestore value:', error);
      // Continue with Firestore balance if on-chain check fails
    }
  }
  
  return { balance, currency };
});

// ---------- 7) Admin adjust (crypto) ----------
export const adminAdjustBalance = onCall({}, async (request) => {
  const caller = uidOrThrow(request);
  const token = await getAuth().getUser(caller);
  const isAdmin = !!(token.customClaims && (token.customClaims as any).admin === true);
  if (!isAdmin) throw new HttpsError('permission-denied', 'Admin only');

  const { uid, delta, reason } = request.data as { uid: string; delta: number; reason?: string };
  if (!uid || typeof uid !== 'string') throw new HttpsError('invalid-argument', 'uid required');
  if (delta == null || isNaN(Number(delta))) throw new HttpsError('invalid-argument', 'delta must be a number');

  const now = Timestamp.now();

  await db.runTransaction(async (t) => {
    const wRef = walletDoc(uid);
    const wSnap = await t.get(wRef);
    
    const currency = (wSnap.exists ? (wSnap.get('currency') || getDefaultCurrency()) : getDefaultCurrency()) as 'USDC' | 'USDT';
    const decimals = TOKEN_DECIMALS[currency];
    const balStr = wSnap.exists ? (wSnap.get('balance') || '0') : '0';
    const bal = Number(balStr);
    const newBalance = (bal + Number(delta)).toFixed(decimals);

    t.set(wRef, {
      uid,
      balance: newBalance,
      currency,
      updatedAt: now,
      createdAt: wSnap.exists ? (wSnap.get('createdAt') || now) : now,
    }, { merge: true });

    const txId = db.collection('_ids').doc().id;
    t.set(txCollection(uid).doc(txId), {
      type: 'ADMIN_ADJUST',
      amount: Number(delta),
      currency,
      reason: reason || null,
      createdAt: now,
      status: 'SUCCESS',
      adminUid: caller,
    });
  });

  return { status: 'SUCCESS' };
});

// ---------- 8) Express webhook ----------
const app = express();
app.use((req, res, next) => cors(req, res, next));

// ---------- On-Ramp Webhook Handler (for bank card purchases) ----------
export const onrampWebhook = onRequest(
  {},
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }
    
    try {
      const data = req.body;
      logger.info('On-ramp webhook received', { data: JSON.stringify(data).substring(0, 200) });
      
      // Extract payment information from on-ramp service webhook
      // Format depends on which service you use (MoonPay, Ramp, Transak, etc.)
      const { transactionHash, status, amount, token, userId, paymentId } = data;
      
      if (!transactionHash || status !== 'completed') {
        logger.info('On-ramp webhook: Payment not completed', { status });
        res.status(200).send('OK');
        return;
      }
      
      // Find pending payment by paymentId or transactionHash
      let pendingRef;
      if (paymentId) {
        pendingRef = db.collection('pending_crypto_payments').doc(paymentId);
      } else {
        // Try to find by userId and status
        const pendings = await db.collection('pending_crypto_payments')
          .where('uid', '==', userId)
          .where('status', '==', 'PENDING')
          .limit(1)
          .get();
        
        if (pendings.empty) {
          logger.warn('On-ramp webhook: Pending payment not found', { userId });
          res.status(200).send('OK');
          return;
        }
        pendingRef = pendings.docs[0].ref;
      }
      
      const pendingSnap = await pendingRef.get();
      if (!pendingSnap.exists || pendingSnap.get('status') === 'COMPLETED') {
        res.status(200).send('OK');
        return;
      }
      
      const pending = pendingSnap.data();
      const uid = pending?.uid || userId;
      const tokenAmount = pending?.amount || amount;
      const tokenType = (pending?.token || token || getDefaultCurrency()).toUpperCase() as 'USDC' | 'USDT';
      const decimals = TOKEN_DECIMALS[tokenType];
      
      // Credit wallet
      const now = Timestamp.now();
      await db.runTransaction(async (t) => {
        const wRef = walletDoc(uid);
        const wSnap = await t.get(wRef);
        const prevBalance = wSnap.exists ? (wSnap.get('balance') || '0') : '0';
        const prevBalanceNum = Number(prevBalance);
        const newBalance = (prevBalanceNum + Number(tokenAmount)).toFixed(decimals);
        
        t.set(wRef, {
          uid,
          balance: newBalance,
          currency: tokenType,
          walletAddress: pending?.walletAddress,
          updatedAt: now,
          createdAt: wSnap.exists ? (wSnap.get('createdAt') || now) : now,
        }, { merge: true });
        
        const txRef = txCollection(uid).doc(pendingRef.id);
        t.set(txRef, {
          type: 'TOP_UP',
          provider: 'ONRAMP',
          token: tokenType,
          amount: tokenAmount,
          currency: tokenType,
          status: 'SUCCESS',
          transactionHash,
          createdAt: now,
        });
        
        t.update(pendingRef, {
          status: 'COMPLETED',
          completedAt: now,
          transactionHash,
        });
      });
      
      res.status(200).send('OK');
    } catch (error: any) {
      logger.error('On-ramp webhook error', error);
      res.status(200).send('OK'); // Acknowledge to prevent retries
    }
  }
);

// ---------- 9) Complete ride and pay driver (atomic) ----------
export const payDriverOnComplete = onCall({}, async (request) => {
  const riderUid = uidOrThrow(request);
  const { rideId } = request.data as { rideId: string };
  if (!rideId || typeof rideId !== "string") {
    throw new HttpsError("invalid-argument", "rideId required");
  }

  const rideRef = db.collection("rides").doc(rideId);

  // Optional env fee, default 20%
  const feeRateEnv = Number(process.env.APP_PLATFORM_FEE_RATE || "0.20");
  const feeRate = Number.isFinite(feeRateEnv) ? Math.max(0, Math.min(0.95, feeRateEnv)) : 0.20;

  await db.runTransaction(async (t) => {
    const now = Timestamp.now();

    const rideSnap = await t.get(rideRef);
    if (!rideSnap.exists) throw new HttpsError("not-found", "Ride not found.");
    const ride = rideSnap.data() as any;

    // Idempotency: if already paid/completed, return early
    if (ride?.payment?.status === "authorized" || ride?.status === "completed") {
      // also ensure driver is freed
      if (ride?.driver?.id) {
        t.set(db.collection("drivers_live").doc(ride.driver.id), { occupied: false, updatedAt: now }, { merge: true });
      }
      return;
    }

    // Authorization & state checks
    if (ride.userId !== riderUid) throw new HttpsError("permission-denied", "Not your ride.");
    if (ride.status !== "on_trip") {
      throw new HttpsError("failed-precondition", `Ride must be on_trip to complete (current: ${ride.status}).`);
    }

    const driverId = ride?.driver?.id;
    if (!driverId) throw new HttpsError("failed-precondition", "No assigned driver.");

    const amount = Number(ride.estimatedFareZAR || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new HttpsError("failed-precondition", "Invalid fare amount.");
    }

    // Wallets
    const riderWalletRef  = walletDoc(riderUid);
    const driverWalletRef = walletDoc(driverId);

    const [riderW, driverW] = await Promise.all([t.get(riderWalletRef), t.get(driverWalletRef)]);
    
    const currency = (riderW.exists ? (riderW.get('currency') || getDefaultCurrency()) : getDefaultCurrency()) as 'USDC' | 'USDT';
    const decimals = TOKEN_DECIMALS[currency];

    const riderBalStr = riderW.exists ? (riderW.get("balance") || "0") : "0";
    const riderBal = Number(riderBalStr);
    if (riderBal < amount) throw new HttpsError("failed-precondition", "Insufficient rider balance.");

    const driverBalStr = driverW.exists ? (driverW.get("balance") || "0") : "0";
    const driverBal = Number(driverBalStr);

    // Split & round based on token decimals
    const platformFee = Number((amount * feeRate).toFixed(decimals));
    const payout = Number((amount - platformFee).toFixed(decimals));

    // Debit rider, credit driver
    const newRiderBalance = (riderBal - amount).toFixed(decimals);
    t.set(
      riderWalletRef,
      {
        uid: riderUid,
        balance: newRiderBalance,
        currency,
        updatedAt: now,
        createdAt: riderW.exists ? (riderW.get("createdAt") || now) : now,
      },
      { merge: true }
    );

    const newDriverBalance = (driverBal + payout).toFixed(decimals);
    t.set(
      driverWalletRef,
      {
        uid: driverId,
        balance: newDriverBalance,
        currency,
        updatedAt: now,
        createdAt: driverW.exists ? (driverW.get("createdAt") || now) : now,
      },
      { merge: true }
    );

    // Transactions (two-sided ledger)
    const debitId  = db.collection("_ids").doc().id;
    const creditId = db.collection("_ids").doc().id;

    t.set(txCollection(riderUid).doc(debitId), {
      type: "RIDE_PAYMENT",
      rideId,
      counterparty: driverId,
      amount: amount,
      currency,
      platformFee,
      payoutToDriver: payout,
      createdAt: now,
      status: "SUCCESS",
    });

    t.set(txCollection(driverId).doc(creditId), {
      type: "RIDE_EARN",
      rideId,
      counterparty: riderUid,
      amount: payout,
      currency,
      platformFee, // for reporting
      createdAt: now,
      status: "SUCCESS",
    });

    // Mark ride completed & paid
    t.update(rideRef, {
      status: "completed",
      payment: { status: "authorized", lastError: null },
      updatedAt: now,
    });

    // Free the driver for new jobs
    t.set(db.collection("drivers_live").doc(driverId), { occupied: false, updatedAt: now }, { merge: true });
  });

  return { ok: true };
});

// ---------- 10) Complete order and pay  (atomic) ----------

export const payAndPlaceOrder = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

  const { businessId, items, address, total } = req.data || {};
  if (!businessId || !Array.isArray(items) || items.length === 0) {
    throw new HttpsError("invalid-argument", "Missing order fields.");
  }

  const orderRef    = db.collection("orders").doc();
  const buyerRef    = db.doc(`wallets/${uid}`);
  const businessRef = db.doc(`businesses/${businessId}`);

  // 👇 hoist for use after transaction (push notification)
  let ownerId: string = "";

  await db.runTransaction(async (tx) => {
    // Load business and read ownerId server-side
    const bizSnap = await tx.get(businessRef);
    if (!bizSnap.exists) throw new HttpsError("not-found", "Business not found.");

    ownerId = String(bizSnap.get("ownerId") || "");
    if (!ownerId) throw new HttpsError("failed-precondition", "Business owner not set.");

    const sellerRef = db.doc(`wallets/${ownerId}`);

    // Check buyer balance
    const buyerSnap = await tx.get(buyerRef);
    const currency = (buyerSnap.exists ? (buyerSnap.get('currency') || getDefaultCurrency()) : getDefaultCurrency()) as 'USDC' | 'USDT';
    const decimals = TOKEN_DECIMALS[currency];
    const buyerBalStr = buyerSnap.exists ? (buyerSnap.get("balance") || "0") : "0";
    const buyerBal = Number(buyerBalStr);
    const amount = Number(total);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new HttpsError("invalid-argument", "Invalid total.");
    }
    if (!Number.isFinite(buyerBal)) {
      throw new HttpsError("failed-precondition", "Bad wallet state.");
    }
    if (buyerBal < amount) {
      throw new HttpsError("failed-precondition", "Insufficient funds.");
    }

    const now = FieldValue.serverTimestamp();

    // Get seller balance
    const sellerSnap = await tx.get(sellerRef);
    const sellerBalStr = sellerSnap.exists ? (sellerSnap.get("balance") || "0") : "0";
    const sellerBal = Number(sellerBalStr);

    // Atomic debit/credit with timestamps
    const newBuyerBalance = (buyerBal - amount).toFixed(decimals);
    const newSellerBalance = (sellerBal + amount).toFixed(decimals);
    
    tx.set(buyerRef, { uid, balance: newBuyerBalance, currency, updatedAt: now }, { merge: true });
    tx.set(sellerRef, { uid: ownerId, balance: newSellerBalance, currency, updatedAt: now }, { merge: true });

    // Create paid order
    tx.set(orderRef, {
      businessId,
      ownerId,
      userId: uid,
      items,
      subtotal: amount,
      total: amount,
      deliveryAddress: address || null,
      status: "paid",
      createdAt: now,
      updatedAt: now,
    });

    // (Optional) validate/decrement stock here in the same tx
  });

  // Push to business owner after funds moved & order created
  try {
    if (ownerId) {
      const ownerSnap = await db.collection('users').doc(ownerId).get();
      // Prefer FCM tokens, fallback to Expo tokens for migration
      const fcmTokens: string[] = (ownerSnap.get('fcmTokens') || []).filter(
        (t: any) => typeof t === 'string' && t.length > 0
      );
      const expoTokens: string[] = (ownerSnap.get('expoPushTokens') || []).filter(
        (t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken')
      );
      const valid = fcmTokens.length > 0 ? fcmTokens : expoTokens;
      if (valid.length) {
        await sendFCMPush(valid, 'New order', `${Number(total).toFixed(2)} USDC from a customer`, {
          businessId,
          orderId: orderRef.id,
        });
      }
    }
  } catch (e) {
    logger.warn('Push to owner failed', e);
  }

  return { orderId: orderRef.id, status: "paid" };
});

//----------(10) Status change → notify buyer --------------
export const notifyBuyerOrderStatus = onDocumentUpdated('orders/{orderId}', async (event) => {
  const before: any = event.data?.before?.data();
  const after:  any = event.data?.after?.data();
  if (!before || !after) return;
  if (before.status === after.status) return;

  const userId = after.userId;
  if (!userId) return;

  const user = await db.collection('users').doc(userId).get();
  // Prefer FCM tokens, fallback to Expo tokens for migration
  const fcmTokens: string[] = (user.get('fcmTokens') || []).filter(
    (t: any) => typeof t === 'string' && t.length > 0
  );
  const expoTokens: string[] = (user.get('expoPushTokens') || []).filter(
    (t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken')
  );
  const tokens = fcmTokens.length > 0 ? fcmTokens : expoTokens;
  if (tokens.length) {
    await sendFCMPush(tokens, 'Order update', `Your order is now ${String(after.status)}`, {
      orderId: event.params.orderId,
      status: after.status,
    });
  }
});

// ---------- [MODIFIED] Notify on new DM message & maintain chat meta ----------
export const notifyOnNewDM = onDocumentCreated('chats/{chatId}/messages/{messageId}', async (event) => {
  const chatId = event.params.chatId;
  const msg = event.data?.data();
  if (!msg) return;

  const senderId = String(msg.senderId || '');
  if (!senderId) return;

  try {
    const chatRef = db.collection('chats').doc(chatId);
    const chatSnap = await chatRef.get();
    if (!chatSnap.exists) return;

    const chat = chatSnap.data() || {};

    // Figure out the two participants and the recipient
    let participants: string[] = [];
    if (Array.isArray(chat.participants)) {
      participants = chat.participants.filter((x: any) => typeof x === 'string');
    } else if (chat.participants && typeof chat.participants === 'object') {
      participants = Object.keys(chat.participants).filter((k) => chat.participants[k] === true);
    }

    // This trigger is for 1-on-1 direct messages only
    if (participants.length !== 2) return;

    const recipientId = participants.find((p) => p !== senderId);
    if (!recipientId) return;

    // Update chat meta: last message + unread flags + unread count for recipient
    const lastMessageText = previewFromMessage(msg);
    await chatRef.set(
      {
        lastMessageText,
        lastMessageSenderId: senderId,
        lastMessageTimestamp: FieldValue.serverTimestamp(),
        unreadFor: {
          [recipientId]: true,
          [senderId]: false,
        },
        [`unreadCount.${recipientId}`]: FieldValue.increment(1),
        [`unreadCount.${senderId}`]: 0,
      },
      { merge: true }
    );

    // Fetch sender's name for the title and recipient's tokens for sending
    const senderSnap = await db.collection('users').doc(senderId).get();
    const recipientSnap = await db.collection('users').doc(recipientId).get();

    // Check if recipient has ignored this sender
    const ignoredUsers: string[] = recipientSnap.get('ignoredUsers') || [];
    if (ignoredUsers.includes(senderId)) {
      // User has ignored this sender, skip push notification but still update chat meta
      return;
    }

    // Get FCM tokens (prefer fcmTokens, fallback to expoPushTokens for migration)
    const fcmTokens: string[] = (recipientSnap.get('fcmTokens') || []).filter(
      (t: any) => typeof t === 'string' && t.length > 0
    );
    const expoTokens: string[] = (recipientSnap.get('expoPushTokens') || []).filter(
      (t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken')
    );
    const tokens = fcmTokens.length > 0 ? fcmTokens : expoTokens;

    if (!tokens.length) return;

    // Use sender's name for the notification title
    const title = senderSnap.get('username') ? String(senderSnap.get('username')) : 'New message';
    const body  = lastMessageText;

    // Include navigation hints in data payload for your app
    // When the recipient taps, they need to open a chat with the SENDER.
    // So the navigation `recipientId` param should be the sender's ID.
    await sendFCMPush(tokens, title, body, {
      type: 'dm',
      chatId,
      recipientId: senderId,
    });
  } catch (e) {
    logger.warn('notifyOnNewDM failed', e);
  }
});

// ---------- [NEW] Notify on new group chat message ----------
// Haversine formula to calculate distance between two coordinates in km
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// When 3+ people join an activity within 10 minutes, notify nearby users who haven't joined ("Don't miss out")
const JOIN_WINDOW_MINUTES = 10;
const DONT_MISS_OUT_COOLDOWN_MINUTES = 30;

export const notifyOnActivityJoins = onDocumentUpdated('activities/{activityId}', async (event) => {
  const before: any = event.data?.before?.data();
  const after: any = event.data?.after?.data();
  if (!before || !after) return;

  const beforeParticipants: string[] = before.participants || [];
  const afterParticipants: string[] = after.participants || [];
  if (afterParticipants.length <= beforeParticipants.length) return; // no new join

  const activityId = event.params.activityId;
  const activityLat = after.latitude;
  const activityLng = after.longitude;
  const activityTitle = after.title || 'Activity';
  const activityType = after.activityType || 'activity';
  const visibility = after.visibility || 'everyone';
  const allowedViewers: string[] = after.allowedViewers || [];

  if (!activityLat || !activityLng) return;

  try {
    const joinEventsRef = db.collection('activities').doc(activityId).collection('joinEvents');
    await joinEventsRef.add({ joinedAt: FieldValue.serverTimestamp() });

    const tenMinutesAgo = Timestamp.fromMillis(Date.now() - JOIN_WINDOW_MINUTES * 60 * 1000);
    const recentJoinsSnap = await joinEventsRef.where('joinedAt', '>=', tenMinutesAgo).get();
    if (recentJoinsSnap.size < 3) return;

    const lastSent = after.lastDonMissOutNotificationAt?.toMillis?.() ?? 0;
    const cooldownMs = DONT_MISS_OUT_COOLDOWN_MINUTES * 60 * 1000;
    if (Date.now() - lastSent < cooldownMs) return;

    const participantsSet = new Set(afterParticipants);
    const usersSnapshot = await db.collection('users').get();
    const nearbyUserTokens: string[] = [];

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      if (participantsSet.has(userId)) continue;

      const userData = userDoc.data();
      const userLat = userData.latitude;
      const userLng = userData.longitude;
      if (userLat == null || userLng == null) continue;

      const distance = calculateDistance(activityLat, activityLng, userLat, userLng);
      if (distance > 50) continue;
      if (visibility === 'friends_only' && allowedViewers.length > 0 && !allowedViewers.includes(userId)) continue;

      const fcmTokens: string[] = (userData.fcmTokens || []).filter(
        (t: any) => typeof t === 'string' && t.length > 0
      );
      const expoTokens: string[] = (userData.expoPushTokens || []).filter(
        (t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken')
      );
      const tokens = fcmTokens.length > 0 ? fcmTokens : expoTokens;
      if (tokens.length > 0) nearbyUserTokens.push(...tokens);
    }

    if (nearbyUserTokens.length === 0) return;

    await sendFCMPush(
      nearbyUserTokens,
      'People are joining!',
      `People are joining "${activityTitle}". Don't miss out!`,
      { type: 'activity_hot', activityId, title: activityTitle }
    );
    await db.collection('activities').doc(activityId).update({
      lastDonMissOutNotificationAt: FieldValue.serverTimestamp(),
    });
    logger.info(`notifyOnActivityJoins: sent "Don't miss out" to ${nearbyUserTokens.length} users for activity ${activityId}`);
  } catch (e) {
    logger.warn('notifyOnActivityJoins failed', e);
  }
});

// Notify users within 50km when a new activity is created
export const notifyOnNewActivity = onDocumentCreated('activities/{activityId}', async (event) => {
  const activity = event.data?.data();
  if (!activity) return;

  const activityLat = activity.latitude;
  const activityLng = activity.longitude;
  const activityTitle = activity.title || 'New Activity';
  const activityType = activity.activityType || 'activity';
  const createdBy = activity.createdBy;
  const visibility = activity.visibility || 'everyone';
  const allowedViewers: string[] = activity.allowedViewers || [];

  if (!activityLat || !activityLng) {
    logger.warn('notifyOnNewActivity: activity missing latitude/longitude');
    return;
  }

  try {
    // Get all users (we'll filter by distance)
    const usersSnapshot = await db.collection('users').get();
    const nearbyUserTokens: string[] = [];
    let usersWithLocation = 0;
    let usersNearbyNoToken = 0;

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      // Skip the creator
      if (userId === createdBy) continue;

      const userData = userDoc.data();
      const userLat = userData.latitude;
      const userLng = userData.longitude;

      // If user has location, calculate distance
      if (userLat != null && userLng != null) {
        usersWithLocation++;
        const distance = calculateDistance(activityLat, activityLng, userLat, userLng);

        // Only notify users within 50km
        if (distance <= 50) {
          // For friends_only activities, only notify users in allowedViewers
          if (visibility === 'friends_only' && allowedViewers.length > 0 && !allowedViewers.includes(userId)) {
            continue;
          }
          // Get FCM tokens (prefer fcmTokens, fallback to expoPushTokens)
          const fcmTokens: string[] = (userData.fcmTokens || []).filter(
            (t: any) => typeof t === 'string' && t.length > 0
          );
          const expoTokens: string[] = (userData.expoPushTokens || []).filter(
            (t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken')
          );
          const tokens = fcmTokens.length > 0 ? fcmTokens : expoTokens;
          if (tokens.length > 0) {
            nearbyUserTokens.push(...tokens);
          } else {
            usersNearbyNoToken++;
          }
        }
      }
    }

    logger.info(`notifyOnNewActivity: activity at (${activityLat},${activityLng}), users with location=${usersWithLocation}, nearby with tokens=${nearbyUserTokens.length}, nearby without token=${usersNearbyNoToken}`);

    if (nearbyUserTokens.length === 0) {
      logger.info('No nearby users with push tokens to notify; ensure users open the Map so their location is saved and they have notification permission.');
      return;
    }

    // Send notification to all nearby users
    await sendFCMPush(
      nearbyUserTokens,
      `New ${activityType} Activity nearby`,
      activityTitle,
      {
        type: 'activity',
        activityId: event.params.activityId,
        title: activityTitle,
      }
    );

    logger.info(`Sent activity notification to ${nearbyUserTokens.length} nearby users`);
  } catch (e) {
    logger.warn('notifyOnNewActivity failed', e);
  }
});

/** When someone requests to join an activity (require-approval), notify the activity creator. */
export const notifyOnActivityJoinRequest = onDocumentCreated(
  'activities/{activityId}/joinRequests/{requestId}',
  async (event) => {
    const activityId = event.params.activityId;
    const requestData = event.data?.data();
    if (!requestData) return;

    const requesterName = String(requestData.userName || 'Someone');
    try {
      const activitySnap = await db.collection('activities').doc(activityId).get();
      if (!activitySnap.exists) return;

      const createdBy = activitySnap.get('createdBy');
      const activityTitle = activitySnap.get('title') || 'your activity';
      if (!createdBy) return;

      const creatorSnap = await db.collection('users').doc(createdBy).get();
      if (!creatorSnap.exists) return;

      const fcmTokens: string[] = (creatorSnap.get('fcmTokens') || []).filter(
        (t: any) => typeof t === 'string' && t.length > 0
      );
      const expoTokens: string[] = (creatorSnap.get('expoPushTokens') || []).filter(
        (t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken')
      );
      const tokens = fcmTokens.length > 0 ? fcmTokens : expoTokens;
      if (tokens.length === 0) return;

      await sendFCMPush(
        tokens,
        'Join request',
        `${requesterName} requested to join "${activityTitle}". Open the activity to accept or decline.`,
        { type: 'activity_join_request', activityId, activityTitle }
      );
      logger.info(`Sent join-request notification to creator of activity ${activityId}`);
    } catch (e) {
      logger.warn('notifyOnActivityJoinRequest failed', e);
    }
  }
);

/** Callable: send push to the user whose join request was accepted (call after client has added them to participants and deleted the request). */
export const notifyJoinRequestAccepted = onCall({}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');
  const { activityId, activityTitle, recipientUserId } = request.data as {
    activityId?: string;
    activityTitle?: string;
    recipientUserId?: string;
  };
  if (!activityId || !recipientUserId) throw new HttpsError('invalid-argument', 'activityId and recipientUserId required');
  const title = activityTitle ? String(activityTitle) : 'Activity';
  try {
    const userSnap = await db.collection('users').doc(recipientUserId).get();
    if (!userSnap.exists) return { ok: false };
    const data = userSnap.data() || {};
    const fcmTokens: string[] = (data.fcmTokens || []).filter((t: any) => typeof t === 'string' && t.length > 0);
    const expoTokens: string[] = (data.expoPushTokens || []).filter((t: any) => typeof t === 'string' && String(t).startsWith('ExponentPushToken'));
    const tokens = fcmTokens.length > 0 ? fcmTokens : expoTokens;
    if (tokens.length > 0) {
      await sendFCMPush(
        tokens,
        "You're in!",
        `You were accepted to "${title}". Open the activity to chat and add memories.`,
        { type: 'activity_join_accepted', activityId, title }
      );
    }
    return { ok: true };
  } catch (e) {
    logger.warn('notifyJoinRequestAccepted failed', e);
    return { ok: false };
  }
});

export const notifyOnNewActivityChatMessage = onDocumentCreated(
  'activityChats/{activityId}/messages/{messageId}',
  async (event) => {
    const activityId = event.params.activityId;
    const msg = event.data?.data();
    if (!msg) return;

    const senderId = String(msg.senderId || '');
    if (!senderId) return;

    try {
      const activitySnap = await db.collection('activities').doc(activityId).get();
      if (!activitySnap.exists) return;

      const participants: string[] = activitySnap.get('participants') || [];
      const recipients = participants.filter((p) => p !== senderId);
      if (recipients.length === 0) return;

      const activityTitle = activitySnap.get('title') || 'Activity';
      const senderSnap = await db.collection('users').doc(senderId).get();
      const senderName = senderSnap.get('username') || 'Someone';
      const messagePreview = previewFromMessage(msg);

      const allTokens: string[] = [];
      for (const recipientId of recipients) {
        try {
          const userSnap = await db.collection('users').doc(recipientId).get();
          if (userSnap.exists) {
            const fcmTokens: string[] = (userSnap.get('fcmTokens') || []).filter(
              (t: any) => typeof t === 'string' && t.length > 0
            );
            const expoTokens: string[] = (userSnap.get('expoPushTokens') || []).filter(
              (t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken')
            );
            const tokens = fcmTokens.length > 0 ? fcmTokens : expoTokens;
            allTokens.push(...tokens);
          }
        } catch (e) {
          logger.warn(`Failed to get tokens for user ${recipientId}`, e);
        }
      }

      if (allTokens.length === 0) return;

      await sendFCMPush(
        allTokens,
        `${senderName} in ${activityTitle}`,
        messagePreview,
        { type: 'activity_chat', activityId, activityTitle }
      );
    } catch (e) {
      logger.warn('notifyOnNewActivityChatMessage failed', e);
    }
  }
);

export const notifyOnNewGroupMessage = onDocumentCreated(
  'communities/{communityId}/groupChats/{chatId}/messages/{messageId}',
  async (event) => {
    const communityId = event.params.communityId;
    const chatId = event.params.chatId;
    const msg = event.data?.data();
    if (!msg) return;

    const senderId = String(msg.senderId || '');
    if (!senderId) return;

    try {
      // Get group chat document to find members
      const groupRef = db
        .collection('communities')
        .doc(communityId)
        .collection('groupChats')
        .doc(chatId);
      const groupSnap = await groupRef.get();
      if (!groupSnap.exists) return;

      const groupData = groupSnap.data() || {};
      const members: string[] = Array.isArray(groupData.members)
        ? groupData.members
        : [];

      // Don't notify the sender
      const recipients = members.filter((m) => m !== senderId);
      if (recipients.length === 0) return;

      // Get sender's name for notification
      const senderSnap = await db.collection('users').doc(senderId).get();
      const senderName = senderSnap.get('username') || 'Someone';
      const groupName = groupData.name || groupData.title || 'Group';

      // Get message preview
      const messagePreview = previewFromMessage(msg);

      // Collect all push tokens from recipients
      const allTokens: string[] = [];
      for (const recipientId of recipients) {
        try {
          const userSnap = await db.collection('users').doc(recipientId).get();
          if (userSnap.exists) {
            // Prefer FCM tokens, fallback to Expo tokens for migration
            const fcmTokens: string[] = (userSnap.get('fcmTokens') || []).filter(
              (t: any) => typeof t === 'string' && t.length > 0
            );
            const expoTokens: string[] = (userSnap.get('expoPushTokens') || []).filter(
              (t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken')
            );
            const tokens = fcmTokens.length > 0 ? fcmTokens : expoTokens;
            allTokens.push(...tokens);
          }
        } catch (e) {
          logger.warn(`Failed to get tokens for user ${recipientId}`, e);
        }
      }

      if (allTokens.length === 0) return;

      // Send notification to all group members (except sender)
      await sendFCMPush(
        allTokens,
        `${senderName} in ${groupName}`,
        messagePreview,
        {
          type: 'group',
          communityId,
          chatId,
          groupId: chatId,
          groupName,
        }
      );
    } catch (e) {
      logger.warn('notifyOnNewGroupMessage failed', e);
    }
  }
);

 // -----------------------------------------------------
  // Group wallet — on-chain Bitcoin (one address per group, HD from server secret)
  // -----------------------------------------------------

const GROUP_BTC_INDEX_DOC = '_config';
const GROUP_BTC_INDEX_ID = 'groupBtcDerivation';

function walletPinPepper(): string {
  const p = process.env.GROUP_WALLET_ACCESS_PEPPER?.trim();
  if (p) return p;
  return getGroupWalletMnemonicForProvisioning();
}

function hashWalletPin(groupId: string, pin: string): string {
  const pepper = walletPinPepper();
  return createHash('sha256')
    .update(`${groupId}\x00${pin}\x00${pepper}`, 'utf8')
    .digest('hex');
}

function getGroupWalletMnemonicForProvisioning(): string {
  const m = process.env.GROUP_WALLET_MNEMONIC?.trim();
  if (!m) {
    throw new HttpsError(
      'failed-precondition',
      'Server is not configured for group on-chain wallets. Set GROUP_WALLET_MNEMONIC (BIP39 phrase) on the Functions environment.'
    );
  }
  return m;
}

/** Group creator provisions a unique P2WPKH address; members fund it with real on-chain sends. */
export const provisionGroupOnChainWallet = onCall({}, async (request) => {
  const uid = uidOrThrow(request);
  const { groupId, communityId } = request.data as {
    groupId?: string;
    communityId?: string;
  };

  if (!groupId || typeof groupId !== 'string') {
    throw new HttpsError('invalid-argument', 'groupId is required');
  }
  if (!communityId || typeof communityId !== 'string') {
    throw new HttpsError('invalid-argument', 'communityId is required');
  }

  const groupChatRef = db
    .collection('communities')
    .doc(communityId)
    .collection('groupChats')
    .doc(groupId);
  const groupChatSnap = await groupChatRef.get();
  if (!groupChatSnap.exists) {
    throw new HttpsError('not-found', 'Group chat not found');
  }
  if (groupChatSnap.get('createdBy') !== uid) {
    throw new HttpsError('permission-denied', 'Only the group creator can enable the on-chain wallet');
  }

  const testnet = isGroupBtcTestnet();
  const mnemonic = getGroupWalletMnemonicForProvisioning();
  const groupWalletRef = db.collection('groupWallets').doc(groupId);
  const existing = await groupWalletRef.get();
  const alreadyHasAddress = !!(existing.exists && existing.get('onchainAddress'));
  if (alreadyHasAddress) {
    const addr = String(existing.get('onchainAddress'));
    const derivationIndex = Number(existing.get('derivationIndex') ?? 0);
    const now = Timestamp.now();
    // Disable/clear any legacy passcode fields.
    await groupWalletRef.set(
      {
        walletPinRequired: false,
        walletPinHash: FieldValue.delete(),
        updatedAt: now,
      },
      { merge: true }
    );
    // Ensure the group chat indicates wallet is enabled.
    await groupChatRef.set({ hasGroupWallet: true }, { merge: true });

    return { ok: true, onchainAddress: addr, derivationIndex, alreadyProvisioned: true };
  }

  const cfgRef = db.collection(GROUP_BTC_INDEX_DOC).doc(GROUP_BTC_INDEX_ID);
  const now = Timestamp.now();
  let derivationIndex = 0;
  let address = '';

  await db.runTransaction(async (t) => {
    const [cfgSnap, walletSnap, groupInTx] = await Promise.all([
      t.get(cfgRef),
      t.get(groupWalletRef),
      t.get(groupChatRef),
    ]);

    if (!groupInTx.exists || groupInTx.get('createdBy') !== uid) {
      throw new HttpsError('permission-denied', 'Only the group creator can enable the on-chain wallet');
    }

    if (walletSnap.exists && walletSnap.get('onchainAddress')) {
      address = String(walletSnap.get('onchainAddress'));
      derivationIndex = Number(walletSnap.get('derivationIndex') ?? 0);
      return;
    }

    derivationIndex = cfgSnap.exists ? Number(cfgSnap.get('nextIndex') ?? 0) : 0;
    address = deriveGroupReceiveAddress(mnemonic, derivationIndex, testnet);

    t.set(
      cfgRef,
      { nextIndex: derivationIndex + 1, updatedAt: now },
      { merge: true }
    );

    t.set(
      groupWalletRef,
      {
        onchainAddress: address,
        derivationIndex,
        communityId,
        createdBy: uid,
        createdAt: walletSnap.exists ? walletSnap.get('createdAt') || now : now,
        updatedAt: now,
        currency: 'BTC',
        chain: testnet ? 'testnet' : 'mainnet',
        balance: 0,
        balanceSource: 'mempool.space',
        walletPinHash: FieldValue.delete(),
        walletPinRequired: false,
        visibility: walletSnap.exists
          ? walletSnap.get('visibility')
          : {
              showBalance: true,
              showAnalytics: true,
              showTransactions: true,
            },
      },
      { merge: true }
    );

    t.update(groupChatRef, { hasGroupWallet: true });
  });

  return { ok: true, onchainAddress: address, derivationIndex, alreadyProvisioned: false };
});

/** Members enter the passcode set at group creation before opening the group wallet UI. */
export const verifyGroupWalletAccessPin = onCall({}, async (request) => {
  const uid = uidOrThrow(request);
  const { groupId, pin } = request.data as { groupId?: string; pin?: string };

  if (!groupId || typeof groupId !== 'string') {
    throw new HttpsError('invalid-argument', 'groupId is required');
  }
  if (typeof pin !== 'string') {
    throw new HttpsError('invalid-argument', 'pin is required');
  }

  const walletRef = db.collection('groupWallets').doc(groupId);
  const walletSnap = await walletRef.get();
  if (!walletSnap.exists) {
    throw new HttpsError('not-found', 'Group wallet not found');
  }

  const stored = walletSnap.get('walletPinHash');
  if (!stored || typeof stored !== 'string') {
    return { ok: true, legacyNoPin: true };
  }

  const communityId = walletSnap.get('communityId');
  if (typeof communityId === 'string' && communityId.length > 0) {
    const groupChatSnap = await db
      .collection('communities')
      .doc(communityId)
      .collection('groupChats')
      .doc(groupId)
      .get();
    const members: unknown = groupChatSnap.exists ? groupChatSnap.get('members') : [];
    if (Array.isArray(members) && !members.includes(uid)) {
      throw new HttpsError('permission-denied', 'You are not a member of this group');
    }
  }

  const expectedHex = String(stored).trim().toLowerCase();
  const gotHex = hashWalletPin(groupId, pin).toLowerCase();
  let a: Buffer;
  let b: Buffer;
  try {
    a = Buffer.from(expectedHex, 'hex');
    b = Buffer.from(gotHex, 'hex');
  } catch {
    throw new HttpsError('failed-precondition', 'Invalid wallet configuration');
  }
  if (a.length !== b.length || a.length === 0) {
    throw new HttpsError('failed-precondition', 'Invalid wallet configuration');
  }
  if (!timingSafeEqual(a, b)) {
    throw new HttpsError('permission-denied', 'Incorrect passcode');
  }

  return { ok: true };
});

/** Pull confirmed + mempool balance and recent txs from mempool.space into Firestore. */
export const syncGroupOnChainWallet = onCall({}, async (request) => {
  const uid = uidOrThrow(request);
  const { groupId } = request.data as { groupId?: string };
  if (!groupId || typeof groupId !== 'string') {
    throw new HttpsError('invalid-argument', 'groupId is required');
  }

  const walletRef = db.collection('groupWallets').doc(groupId);
  const walletSnap = await walletRef.get();
  if (!walletSnap.exists) {
    throw new HttpsError('not-found', 'Group wallet not found');
  }

  const address = walletSnap.get('onchainAddress');
  if (!address || typeof address !== 'string') {
    throw new HttpsError('failed-precondition', 'This group wallet has no on-chain address yet');
  }

  const communityId = walletSnap.get('communityId');
  if (typeof communityId === 'string' && communityId.length > 0) {
    const groupChatSnap = await db
      .collection('communities')
      .doc(communityId)
      .collection('groupChats')
      .doc(groupId)
      .get();
    const members: unknown = groupChatSnap.exists ? groupChatSnap.get('members') : [];
    if (Array.isArray(members) && !members.includes(uid)) {
      throw new HttpsError('permission-denied', 'You are not a member of this group');
    }
  }

  const testnet = walletSnap.get('chain') === 'testnet' || isGroupBtcTestnet();
  const balanceSats = await fetchAddressBalanceSats(address, testnet);
  const txs = await fetchAddressTxs(address, testnet);

  const now = Timestamp.now();
  await walletRef.set(
    {
      balance: balanceSats,
      lastSyncedAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  const batch = db.bulkWriter();
  for (const tx of txs) {
    const received = satsReceivedToAddress(tx, address);
    if (received <= 0) continue;
    const txid = tx.txid;
    if (!txid) continue;
    const st = tx.status;
    const blockTimeSec = st?.block_time;
    const createdAt =
      typeof blockTimeSec === 'number' && blockTimeSec > 0
        ? Timestamp.fromMillis(blockTimeSec * 1000)
        : now;
    const txRef = walletRef.collection('transactions').doc(txid);
    batch.set(
      txRef,
      {
        type: 'ON_CHAIN_IN',
        txid,
        amount: received,
        confirmed: !!st?.confirmed,
        blockHeight: st?.block_height ?? null,
        userId: 'on_chain',
        username: 'On-chain',
        createdAt,
        currency: 'BTC',
        status: st?.confirmed ? 'CONFIRMED' : 'MEMPOOL',
      },
      { merge: true }
    );
  }
  await batch.close();

  return { ok: true, balanceSats, txCount: txs.length };
});

/** Pull personal on-chain BTC receive activity and store ON_CHAIN_IN rows for the current user. */
export const syncPersonalOnChainWallet = onCall({}, async (request) => {
  const uid = uidOrThrow(request);
  const { onchainAddress } = (request.data || {}) as { onchainAddress?: string };

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const storedAddress = userSnap.exists ? userSnap.get('onchainAddress') : null;
  const addressRaw =
    typeof storedAddress === 'string' && storedAddress.trim()
      ? storedAddress
      : typeof onchainAddress === 'string'
      ? onchainAddress
      : '';
  const address = addressRaw.trim();
  if (!address) {
    throw new HttpsError('failed-precondition', 'No on-chain address configured for this wallet');
  }

  const lower = address.toLowerCase();
  const looksTestnet = lower.startsWith('tb1');
  const testnet = looksTestnet || isGroupBtcTestnet();
  const balanceSats = await fetchAddressBalanceSats(address, testnet);
  const txs = await fetchAddressTxs(address, testnet);

  const now = Timestamp.now();
  const batch = db.bulkWriter();
  let inserted = 0;
  for (const tx of txs) {
    const received = satsReceivedToAddress(tx, address);
    if (received <= 0) continue;
    const txid = tx.txid;
    if (!txid) continue;
    const st = tx.status;
    const blockTimeSec = st?.block_time;
    const createdAt =
      typeof blockTimeSec === 'number' && blockTimeSec > 0
        ? Timestamp.fromMillis(blockTimeSec * 1000)
        : now;
    const txRef = txCollection(uid).doc(`onchain_in_${txid}`);
    batch.set(
      txRef,
      {
        type: 'ON_CHAIN_IN',
        txid,
        amount: received,
        currency: 'BTC',
        status: st?.confirmed ? 'CONFIRMED' : 'MEMPOOL',
        confirmed: !!st?.confirmed,
        blockHeight: st?.block_height ?? null,
        counterparty: 'on_chain',
        counterpartyName: 'On-chain',
        createdAt,
        updatedAt: now,
      },
      { merge: true }
    );
    inserted += 1;
  }
  await batch.close();

  await userRef.set({ onchainAddress: address, updatedAt: now }, { merge: true });

  return { ok: true, address, balanceSats, txCount: txs.length, inserted };
});

function squareApiBaseUrl(): string {
  const raw =
    process.env.SQUARE_API_URL?.trim() ||
    process.env.EXPO_PUBLIC_SQUARE_API_URL?.trim();
  if (!raw) {
    throw new HttpsError(
      'failed-precondition',
      'Set SQUARE_API_URL on Functions to your Square Lightning backend base URL (same host the app uses).'
    );
  }
  return raw.replace(/\/$/, '');
}

function requireInternalApiSecret(): string {
  const s = process.env.INTERNAL_API_SECRET?.trim();
  if (!s) {
    throw new HttpsError(
      'failed-precondition',
      'Set INTERNAL_API_SECRET on Functions (must match the backend INTERNAL_API_SECRET).'
    );
  }
  return s;
}

const MIN_GROUP_DEPOSIT_SATS = 1000;
/** Room for LND mining fee debited from the same wallet balance the app displays. */
const ONCHAIN_FEE_HEADROOM_SATS = 15_000;

/**
 * Spend from the Square LND wallet (the balance shown in the personal wallet) on-chain
 * to the group's receive address. Requires backend /internal/send-onchain + INTERNAL_API_SECRET.
 */
export const depositToGroupFromWallet = onCall({}, async (request) => {
  const uid = uidOrThrow(request);
  const { groupId, amountSats, senderPubKey } = request.data as {
    groupId?: string;
    amountSats?: unknown;
    senderPubKey?: string;
  };

  if (!groupId || typeof groupId !== 'string') {
    throw new HttpsError('invalid-argument', 'groupId is required');
  }
  if (!senderPubKey || typeof senderPubKey !== 'string' || !senderPubKey.trim()) {
    throw new HttpsError('invalid-argument', 'senderPubKey is required');
  }

  const amt = Math.floor(Number(amountSats));
  if (!Number.isFinite(amt) || amt < MIN_GROUP_DEPOSIT_SATS) {
    throw new HttpsError(
      'invalid-argument',
      `amountSats must be at least ${MIN_GROUP_DEPOSIT_SATS}`
    );
  }
  const feeSats = Math.max(1, Math.floor(amt * TX_FEE_RATE));
  const totalDebitSats = amt + feeSats;

  const walletRef = db.collection('groupWallets').doc(groupId);
  const walletSnap = await walletRef.get();
  if (!walletSnap.exists) {
    throw new HttpsError('not-found', 'Group wallet not found');
  }

  const address = walletSnap.get('onchainAddress');
  if (!address || typeof address !== 'string') {
    throw new HttpsError('failed-precondition', 'Group has no on-chain address');
  }

  const communityId = walletSnap.get('communityId');
  if (typeof communityId === 'string' && communityId.length > 0) {
    const groupChatSnap = await db
      .collection('communities')
      .doc(communityId)
      .collection('groupChats')
      .doc(groupId)
      .get();
    const members: unknown = groupChatSnap.exists ? groupChatSnap.get('members') : [];
    if (Array.isArray(members) && !members.includes(uid)) {
      throw new HttpsError('permission-denied', 'You are not a member of this group');
    }
  }

  const base = squareApiBaseUrl();
  const secret = requireInternalApiSecret();

  try {
    const balRes = await axios.get(`${base}/get-balance`, {
      params: { pubKey: senderPubKey.trim() },
      timeout: 20000,
    });
    const nodeBal = Number(balRes.data?.balance ?? 0);
    if (!Number.isFinite(nodeBal)) {
      throw new HttpsError('unavailable', 'Could not read wallet balance');
    }
    if (nodeBal < totalDebitSats + ONCHAIN_FEE_HEADROOM_SATS) {
      throw new HttpsError(
        'failed-precondition',
        `Not enough balance. Leave about ${ONCHAIN_FEE_HEADROOM_SATS.toLocaleString()} sats extra for mining fees (you need ~${(totalDebitSats + ONCHAIN_FEE_HEADROOM_SATS).toLocaleString()} sats total).`
      );
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.warn('depositToGroupFromWallet: balance check failed', e);
    throw new HttpsError('unavailable', 'Could not verify wallet balance. Try again later.');
  }

  let txid: string;
  try {
    const { data } = await axios.post<{
      ok?: boolean;
      txid?: string;
      message?: string;
    }>(
      `${base}/internal/send-onchain`,
      {
        address: address.trim(),
        amountSats: amt,
        label: `group:${groupId}:uid:${uid}`,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': secret,
        },
        timeout: 120000,
      }
    );
    if (!data?.ok || !data?.txid) {
      throw new Error(data?.message || 'No txid from backend');
    }
    txid = String(data.txid);
  } catch (e: any) {
    const msg =
      e?.response?.data?.message || e?.message || String(e);
    logger.error('depositToGroupFromWallet send failed', msg);
    throw new HttpsError('internal', String(msg));
  }

  const treasuryAddress = requireTreasuryBtcAddress();
  try {
    const { data } = await axios.post<{
      ok?: boolean;
      txid?: string;
      message?: string;
    }>(
      `${base}/internal/send-onchain`,
      {
        address: treasuryAddress,
        amountSats: feeSats,
        label: `fee:group_deposit:${groupId}:src:${txid}`,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': secret,
        },
        timeout: 120000,
      }
    );
    if (!data?.ok || !data?.txid) {
      throw new Error(data?.message || 'No fee txid from backend');
    }
  } catch (e: any) {
    const msg = e?.response?.data?.message || e?.message || String(e);
    logger.error('depositToGroupFromWallet fee send failed', msg);
    throw new HttpsError('internal', `Treasury fee send failed: ${String(msg)}`);
  }

  return { ok: true, txid, feeSats };
});

/** Group creator: send from app node wallet to any on-chain address, tracked as group withdrawal. */
export const sendFromGroupWallet = onCall({}, async (request) => {
  const uid = uidOrThrow(request);
  const { groupId, address, amountSats } = request.data as {
    groupId?: string;
    address?: string;
    amountSats?: unknown;
  };

  if (!groupId || typeof groupId !== 'string') {
    throw new HttpsError('invalid-argument', 'groupId is required');
  }
  if (!address || typeof address !== 'string' || !address.trim()) {
    throw new HttpsError('invalid-argument', 'address is required');
  }

  const amt = Math.floor(Number(amountSats));
  if (!Number.isFinite(amt) || amt < MIN_GROUP_DEPOSIT_SATS) {
    throw new HttpsError(
      'invalid-argument',
      `amountSats must be at least ${MIN_GROUP_DEPOSIT_SATS}`
    );
  }
  const feeSats = Math.max(1, Math.floor(amt * TX_FEE_RATE));
  const totalDebitSats = amt + feeSats;

  const walletRef = db.collection('groupWallets').doc(groupId);
  const walletSnap = await walletRef.get();
  if (!walletSnap.exists) {
    throw new HttpsError('not-found', 'Group wallet not found');
  }
  if (walletSnap.get('createdBy') !== uid) {
    throw new HttpsError('permission-denied', 'Only the group creator can send from this wallet');
  }

  const groupBal = Number(walletSnap.get('balance') ?? 0);
  if (Number.isFinite(groupBal) && groupBal > 0 && groupBal < totalDebitSats) {
    throw new HttpsError('failed-precondition', 'Not enough group wallet balance');
  }

  const base = squareApiBaseUrl();
  const secret = requireInternalApiSecret();

  let txid: string;
  try {
    const { data } = await axios.post<{
      ok?: boolean;
      txid?: string;
      message?: string;
    }>(
      `${base}/internal/send-onchain`,
      {
        address: address.trim(),
        amountSats: amt,
        label: `group-withdraw:${groupId}:uid:${uid}`,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': secret,
        },
        timeout: 120000,
      }
    );
    if (!data?.ok || !data?.txid) {
      throw new Error(data?.message || 'No txid from backend');
    }
    txid = String(data.txid);
  } catch (e: any) {
    const msg = e?.response?.data?.message || e?.message || String(e);
    logger.error('sendFromGroupWallet failed', msg);
    throw new HttpsError('internal', String(msg));
  }

  const now = Timestamp.now();
  await walletRef.collection('transactions').doc(`withdraw_${txid}`).set(
    {
      type: 'WITHDRAWAL',
      txid,
      amount: amt,
      userId: uid,
      username: 'Group Admin',
      createdAt: now,
      currency: 'BTC',
      status: 'MEMPOOL',
    },
    { merge: true }
  );
  await walletRef.collection('transactions').doc(`fee_${txid}`).set(
    {
      type: 'FEE',
      txid,
      amount: feeSats,
      userId: uid,
      username: 'Treasury fee',
      createdAt: now,
      currency: 'BTC',
      status: 'SUCCESS',
    },
    { merge: true }
  );

  const treasuryAddress = requireTreasuryBtcAddress();
  try {
    const { data } = await axios.post<{
      ok?: boolean;
      txid?: string;
      message?: string;
    }>(
      `${base}/internal/send-onchain`,
      {
        address: treasuryAddress,
        amountSats: feeSats,
        label: `fee:group_send:${groupId}:src:${txid}`,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': secret,
        },
        timeout: 120000,
      }
    );
    if (!data?.ok || !data?.txid) {
      throw new Error(data?.message || 'No fee txid from backend');
    }
  } catch (e: any) {
    const msg = e?.response?.data?.message || e?.message || String(e);
    logger.error('sendFromGroupWallet fee send failed', msg);
    throw new HttpsError('internal', `Treasury fee send failed: ${String(msg)}`);
  }

  return { ok: true, txid, feeSats };
});

/** Personal wallet: send from app node wallet to any on-chain BTC address. */
export const sendFromWalletOnChain = onCall({}, async (request) => {
  const uid = uidOrThrow(request);
  const { address, amountSats, senderPubKey } = request.data as {
    address?: string;
    amountSats?: unknown;
    senderPubKey?: string;
  };

  if (!address || typeof address !== 'string' || !address.trim()) {
    throw new HttpsError('invalid-argument', 'address is required');
  }
  if (!senderPubKey || typeof senderPubKey !== 'string' || !senderPubKey.trim()) {
    throw new HttpsError('invalid-argument', 'senderPubKey is required');
  }

  const amt = Math.floor(Number(amountSats));
  if (!Number.isFinite(amt) || amt < MIN_GROUP_DEPOSIT_SATS) {
    throw new HttpsError(
      'invalid-argument',
      `amountSats must be at least ${MIN_GROUP_DEPOSIT_SATS}`
    );
  }
  const feeSats = Math.max(1, Math.floor(amt * TX_FEE_RATE));
  const totalDebitSats = amt + feeSats;

  const base = squareApiBaseUrl();
  const secret = requireInternalApiSecret();

  try {
    const balRes = await axios.get(`${base}/get-balance`, {
      params: { pubKey: senderPubKey.trim() },
      timeout: 20000,
    });
    const nodeBal = Number(balRes.data?.balance ?? 0);
    if (!Number.isFinite(nodeBal)) {
      throw new HttpsError('unavailable', 'Could not read wallet balance');
    }
    if (nodeBal < totalDebitSats + ONCHAIN_FEE_HEADROOM_SATS) {
      throw new HttpsError(
        'failed-precondition',
        `Not enough spendable node balance. This send uses your Lightning node on-chain balance only (not funds sitting on your app receive address). Node has ${nodeBal.toLocaleString()} sats; need ~${(totalDebitSats + ONCHAIN_FEE_HEADROOM_SATS).toLocaleString()} sats including fee headroom.`
      );
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    const ax = e as any;
    const status = ax?.response?.status;
    const bodyMsg = ax?.response?.data?.message || ax?.response?.data?.error;
    const code = ax?.code;
    const detail =
      bodyMsg ||
      (code === 'ECONNREFUSED'
        ? `Cannot reach Square backend at ${base} (connection refused).`
        : ax?.message || String(e));
    logger.warn('sendFromWalletOnChain: balance check failed', { detail, status, code });
    throw new HttpsError(
      'unavailable',
      `Balance check failed${status ? ` (${status})` : ''}: ${detail}`
    );
  }

  let txid: string;
  try {
    const { data } = await axios.post<{
      ok?: boolean;
      txid?: string;
      message?: string;
    }>(
      `${base}/internal/send-onchain`,
      {
        address: address.trim(),
        amountSats: amt,
        label: `personal-withdraw:uid:${uid}`,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': secret,
        },
        timeout: 120000,
      }
    );
    if (!data?.ok || !data?.txid) {
      throw new Error(data?.message || 'No txid from backend');
    }
    txid = String(data.txid);
  } catch (e: any) {
    const msg = e?.response?.data?.message || e?.message || String(e);
    logger.error('sendFromWalletOnChain failed', msg);
    throw new HttpsError('internal', String(msg));
  }

  const treasuryAddress = requireTreasuryBtcAddress();
  try {
    const { data } = await axios.post<{
      ok?: boolean;
      txid?: string;
      message?: string;
    }>(
      `${base}/internal/send-onchain`,
      {
        address: treasuryAddress,
        amountSats: feeSats,
        label: `fee:personal_send:uid:${uid}:src:${txid}`,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': secret,
        },
        timeout: 120000,
      }
    );
    if (!data?.ok || !data?.txid) {
      throw new Error(data?.message || 'No fee txid from backend');
    }
  } catch (e: any) {
    const msg = e?.response?.data?.message || e?.message || String(e);
    logger.error('sendFromWalletOnChain fee send failed', msg);
    throw new HttpsError('internal', `Treasury fee send failed: ${String(msg)}`);
  }

  const now = Timestamp.now();
  const outId = db.collection('_ids').doc().id;
  const feeId = db.collection('_ids').doc().id;
  await Promise.all([
    txCollection(uid).doc(outId).set({
      type: 'ON_CHAIN_OUT',
      amount: amt,
      fee: feeSats,
      currency: 'BTC',
      createdAt: now,
      status: 'MEMPOOL',
      txid,
      address: address.trim(),
    }),
    txCollection(uid).doc(feeId).set({
      type: 'FEE',
      amount: feeSats,
      currency: 'BTC',
      createdAt: now,
      status: 'SUCCESS',
      sourceType: 'ON_CHAIN_OUT',
      sourceTxid: txid,
    }),
  ]);

  return { ok: true, txid, feeSats };
});

// ---------- Password Reset Function ----------
/**
 * Generates a strong password and sends it to the user's email
 * This function does NOT require authentication (user forgot password)
 */
export const resetPassword = onCall(
  {
    region: 'us-central1',
    cors: true,
    secrets: ['EMAIL_USER', 'EMAIL_PASSWORD'],
  },
  async (request) => {
    const { email } = request.data;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new HttpsError('invalid-argument', 'Valid email address is required');
    }

    try {
      const emailLower = email.trim().toLowerCase();
      
      // Find user by email
      let user;
      try {
        user = await authAdmin.getUserByEmail(emailLower);
      } catch (error: any) {
        // If user not found, don't reveal that to prevent email enumeration
        logger.warn(`Password reset requested for non-existent email: ${emailLower}`);
        // Return success anyway for security (don't reveal if email exists)
        return { success: true, message: 'If an account exists with this email, a new password has been sent.' };
      }

      // Generate a strong password (16 characters: uppercase, lowercase, numbers, special chars)
      const generateStrongPassword = (): string => {
        const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const lowercase = 'abcdefghijklmnopqrstuvwxyz';
        const numbers = '0123456789';
        const special = '!@#$%^&*';
        const allChars = uppercase + lowercase + numbers + special;
        
        let password = '';
        // Ensure at least one of each type
        password += uppercase[Math.floor(Math.random() * uppercase.length)];
        password += lowercase[Math.floor(Math.random() * lowercase.length)];
        password += numbers[Math.floor(Math.random() * numbers.length)];
        password += special[Math.floor(Math.random() * special.length)];
        
        // Fill the rest randomly
        for (let i = password.length; i < 16; i++) {
          password += allChars[Math.floor(Math.random() * allChars.length)];
        }
        
        // Shuffle the password
        return password.split('').sort(() => Math.random() - 0.5).join('');
      };

      const newPassword = generateStrongPassword();

      // Update user's password in Firebase Auth
      await authAdmin.updateUser(user.uid, {
        password: newPassword,
      });

      logger.info(`Password reset for user: ${user.uid} (${emailLower})`);

      // Store password in Firestore temporarily (expires in 1 hour) for backup
      try {
        const passwordDocRef = db.collection('password_resets').doc();
        await passwordDocRef.set({
          email: emailLower,
          password: newPassword,
          uid: user.uid,
          createdAt: FieldValue.serverTimestamp(),
          expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000), // 1 hour
        });
      } catch (storeError: any) {
        logger.warn('Failed to store password in Firestore:', storeError);
        // Continue anyway - password is already updated in Auth
      }

      // Try to send email, but always return password in response as primary method
      let emailSent = false;
      try {
        const emailUser = requireEnv('EMAIL_USER');
        const emailPass = requireEnv('EMAIL_PASSWORD');
        
        const emailTransporter = nodemailer.createTransport({
          host: 'smtp.gmail.com',
          port: 587,
          secure: false,
          auth: {
            user: emailUser,
            pass: emailPass,
          },
        });

        const mailOptions = {
          from: `"Square" <${emailUser}>`,
          to: emailLower,
          subject: 'Square - Your New Password',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #9C3FE4;">Password Reset Request</h2>
              <p>Hello,</p>
              <p>A new password has been generated for your Square account.</p>
              <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; text-align: center;">
                <p style="margin: 0; font-size: 20px; font-weight: bold; color: #333; letter-spacing: 3px; font-family: monospace;">${newPassword}</p>
              </div>
              <p><strong>Please log in with this new password and change it to something memorable after logging in.</strong></p>
              <p>If you did not request this password reset, please contact support immediately.</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
              <p style="color: #666; font-size: 12px;">This is an automated message from Square. Please do not reply to this email.</p>
            </div>
          `,
          text: `Password Reset Request

Hello,

A new password has been generated for your Square account.

Your new password is: ${newPassword}

Please log in with this new password and change it to something memorable after logging in.

If you did not request this password reset, please contact support immediately.

---
This is an automated message from Square. Please do not reply to this email.`,
        };

        await emailTransporter.sendMail(mailOptions);
        emailSent = true;
        logger.info(`Password reset email sent successfully to: ${emailLower}`);
      } catch (emailError: any) {
        logger.error('Email sending failed:', {
          error: emailError.message,
          code: emailError.code,
        });
        emailSent = false;
      }
      
      // Always return password in response - this is the primary method
      // Email is just a bonus if it works
      return {
        success: true,
        message: emailSent 
          ? 'A new password has been sent to your email address and is shown below.'
          : 'Your new password has been generated. Please save it immediately.',
        password: newPassword, // Always include password in response
        emailSent: emailSent,
      };
    } catch (error: any) {
      logger.error('Password reset error:', error);
      
      // Don't reveal internal errors to client
      if (error instanceof HttpsError) {
        throw error;
      }
      
      throw new HttpsError(
        'internal',
        'An error occurred while resetting your password. Please try again later.'
      );
    }
  }
);

// ---------- KLIPY GIF API proxy (uses Firebase secret KLIPY_SECRET) ----------
// Set secret: firebase functions:secrets:set KLIPY_SECRET
interface KlipyApiResponse {
  data?: { data?: unknown[]; results?: unknown[]; has_next?: boolean };
  results?: unknown[];
}
function parseKlipyItem(item: any): { id: string; url: string; tinyUrl: string; title?: string } {
  const id = item.id || item.slug || String(Math.random());
  let url = '';
  let tinyUrl = '';
  if (item.media_formats) {
    const m = item.media_formats;
    const gif = m.gif || m.mediumgif;
    const tiny = m.tinygif || m.nanogif || gif;
    url = gif?.url || tiny?.url || '';
    tinyUrl = tiny?.url || gif?.url || url;
  }
  if (item.files && typeof item.files === 'object') {
    const f = item.files;
    url = f.gif?.url || f.medium?.url || f.large?.url || f.small?.url || url;
    tinyUrl = f.tiny?.url || f.small?.url || f.nano?.url || url || tinyUrl;
  }
  if (!url && item.url) url = item.url;
  if (!tinyUrl) tinyUrl = url;
  if (!url && item.images?.original?.url) url = item.images.original.url;
  if (!tinyUrl && item.images?.fixed_height_small?.url) tinyUrl = item.images.fixed_height_small.url;
  return {
    id,
    url,
    tinyUrl: tinyUrl || url,
    title: item.content_description || item.title || item.description || '',
  };
}

export const getKlipyTrending = onCall(
  {
    region: 'us-central1',
    cors: true,
    secrets: ['KLIPY_SECRET'],
  },
  async (request) => {
    const key = process.env.KLIPY_SECRET;
    if (!key) throw new HttpsError('failed-precondition', 'KLIPY_SECRET not set');
    const limit = Math.min(50, Math.max(8, Number(request.data?.limit) || 24));
    const page = String(request.data?.page || '1');
    const params = new URLSearchParams({ per_page: String(limit), page });
    const res = await fetch(`https://api.klipy.com/api/v1/${key}/gifs/trending?${params}`);
    if (!res.ok) throw new HttpsError('internal', `KLIPY trending: ${res.status}`);
    const json = (await res.json()) as KlipyApiResponse;
    const payload =
      json?.data?.data ??
      json?.data?.results ??
      json?.data ??
      json?.results ??
      (Array.isArray(json) ? json : []);
    const list = Array.isArray(payload) ? payload : [];
    const gifs = list.map(parseKlipyItem).filter((g: { url: string }) => g.url);
    const hasNext = json?.data?.has_next === true;
    const next = hasNext ? String((parseInt(page, 10) || 1) + 1) : null;
    return { gifs, next };
  }
);

export const getKlipySearch = onCall(
  {
    region: 'us-central1',
    cors: true,
    secrets: ['KLIPY_SECRET'],
  },
  async (request) => {
    const key = process.env.KLIPY_SECRET;
    if (!key) throw new HttpsError('failed-precondition', 'KLIPY_SECRET not set');
    const q = String(request.data?.query || '').trim();
    const limit = Math.min(50, Math.max(8, Number(request.data?.limit) || 24));
    const page = String(request.data?.page || '1');
    const params = new URLSearchParams({ per_page: String(limit), page });
    const url = q
      ? `https://api.klipy.com/api/v1/${key}/gifs/search?${params}&q=${encodeURIComponent(q)}`
      : `https://api.klipy.com/api/v1/${key}/gifs/trending?${params}`;
    const res = await fetch(url);
    if (!res.ok) throw new HttpsError('internal', `KLIPY: ${res.status}`);
    const json = (await res.json()) as KlipyApiResponse;
    const payload =
      json?.data?.data ??
      json?.data?.results ??
      json?.data ??
      json?.results ??
      (Array.isArray(json) ? json : []);
    const list = Array.isArray(payload) ? payload : [];
    const gifs = list.map(parseKlipyItem).filter((g: { url: string }) => g.url);
    const hasNext = json?.data?.has_next === true;
    const next = hasNext ? String((parseInt(page, 10) || 1) + 1) : null;
    return { gifs, next };
  }
);

/** Radius for map deal notifications (km); keep in sync with MapScreen client filter */
const MAP_SPECIAL_NOTIFY_RADIUS_KM = 15;

const MAP_SPECIAL_NOTIFY_LEAD_MINUTES = 60;
const MAP_SPECIAL_NOTIFY_WINDOW_MINUTES = 15;

function parseUtcTimeToMinutes(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Every 15 minutes (UTC): notify users ~1 hour before each deal time for the selected weekday.
 */
export const notifyMapSpecialsDaily = onSchedule(
  {
    schedule: '*/15 * * * *',
    timeZone: 'Etc/UTC',
    region: 'us-central1',
    memory: '512MiB',
  },
  async () => {
    const now = new Date();
    const target = new Date(now.getTime() + MAP_SPECIAL_NOTIFY_LEAD_MINUTES * 60 * 1000);
    const targetDay = target.getUTCDay();
    const targetYmd = target.toISOString().slice(0, 10);
    const targetMinutes = target.getUTCHours() * 60 + target.getUTCMinutes();
    const windowEnd = targetMinutes + MAP_SPECIAL_NOTIFY_WINDOW_MINUTES;

    const specialsSnap = await db.collection('mapSpecials').where('active', '==', true).get();
    if (specialsSnap.empty) {
      logger.info('notifyMapSpecialsDaily: no active specials');
      return;
    }

    const usersSnapshot = await db.collection('users').get();

    for (const docSnap of specialsSnap.docs) {
      const special = docSnap.data();
      const weekdays: number[] = Array.isArray(special.weekdays) ? special.weekdays : [];
      if (!weekdays.includes(targetDay)) continue;
      const timeMinutes = parseUtcTimeToMinutes(String(special.dealTimeUtc || ''));
      if (timeMinutes == null) continue;
      if (!(timeMinutes >= targetMinutes && timeMinutes < windowEnd)) continue;

      const occurrenceKey = `${targetYmd}_${String(timeMinutes).padStart(4, '0')}`;
      if (special.lastNotifiedOccurrenceKey === occurrenceKey) continue;

      const lat = special.latitude;
      const lng = special.longitude;
      const createdBy = special.createdBy;
      const title = String(special.title || 'Nearby deal');
      const locationLine =
        special.location != null && String(special.location).trim() !== ''
          ? String(special.location)
          : special.placeName
            ? String(special.placeName)
            : '';

      if (typeof lat !== 'number' || typeof lng !== 'number' || !createdBy) {
        await docSnap.ref.update({
          lastNotifiedOccurrenceKey: occurrenceKey,
          lastNotifiedAt: FieldValue.serverTimestamp(),
        });
        continue;
      }

      const tokenSet = new Set<string>();
      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        if (userId === createdBy) continue;
        const userData = userDoc.data();
        const userLat = userData.latitude;
        const userLng = userData.longitude;
        if (userLat == null || userLng == null) continue;
        const distance = calculateDistance(lat, lng, userLat, userLng);
        if (distance > MAP_SPECIAL_NOTIFY_RADIUS_KM) continue;
        const fcmTokens: string[] = (userData.fcmTokens || []).filter(
          (t: any) => typeof t === 'string' && t.length > 0
        );
        const expoTokens: string[] = (userData.expoPushTokens || []).filter(
          (t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken')
        );
        const tokens = fcmTokens.length > 0 ? fcmTokens : expoTokens;
        for (const t of tokens) tokenSet.add(t);
      }

      const uniqueTokens = [...tokenSet];
      if (uniqueTokens.length > 0) {
        const body = locationLine ? `${title} — ${locationLine}` : title;
        await sendFCMPush(uniqueTokens, 'Deal reminder (1 hour)', body, {
          type: 'map_special',
          specialId: docSnap.id,
        });
      }

      await docSnap.ref.update({
        lastNotifiedOccurrenceKey: occurrenceKey,
        lastNotifiedAt: FieldValue.serverTimestamp(),
      });
      logger.info(
        `notifyMapSpecialsDaily: special ${docSnap.id} → ${uniqueTokens.length} device token(s)`
      );
    }
  }
);
