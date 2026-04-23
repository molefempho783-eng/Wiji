// utils/functionsApi.ts
import { app, auth } from '../firebaseConfig';
import { onAuthStateChanged } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';

let functions = getFunctions(app, 'us-central1');

// ---------- wait until we know the auth state at least once ----------
let authReady: Promise<void> | null = null;
function ensureAuthReady() {
  if (!authReady) {
    authReady = new Promise<void>((resolve) => {
      const unsub = onAuthStateChanged(auth, () => {
        unsub();
        resolve();
      });
    });
  }
  return authReady;
}

// ---------- generic callable helper with a single retry on 401 ----------
async function callCallable<TPayload, TResponse = any>(
  name: string,
  payload: TPayload
): Promise<TResponse> {
  await ensureAuthReady();
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');

  // always refresh token so request.auth is present serverside
  await user.getIdToken(true);

  const invoke = async () => {
    const fn = httpsCallable<TPayload, TResponse>(functions, name);
    return (await fn(payload)).data;
  };

  try {
    return await invoke();
  } catch (e: any) {
    const msg = e?.message ?? '';
    const code = e?.code ?? '';
    const isExpectedWalletLockError =
      name === 'verifyGroupWalletAccessPin' &&
      (code === 'not-found' || code === 'permission-denied');

    // One graceful retry if token/auth caused it
    const looksUnauthed =
      code === 'unauthenticated' ||
      msg.includes('Unauthorized') ||
      msg.includes('401');
    if (looksUnauthed) {
      await user.getIdToken(true);
      try {
        return await invoke();
      } catch (e2: any) {
        console.log(`Callable ${name} failed after retry:`, e2?.message || e2);
        if (e2?.code) console.log('Functions code:', e2.code);
        if (e2?.details) console.log('Functions details:', e2.details);
        throw e2;
      }
    }

    // Keep console noise low for expected wallet lock states handled by UI.
    if (!isExpectedWalletLockError) {
      console.log(`Callable ${name} failed:`, msg || e);
      if (e?.code) console.log('Functions code:', e.code);
      if (e?.details) console.log('Functions details:', e.details);
    }
    throw e;
  }
}

/* -------- Public API your UI uses -------- */

/**
 * Client cannot create /wallets docs (rules block writes).
 * Treat this as a no-op and let the backend create/update the wallet on first top-up/transfer.
 */
export async function createWallet(_userId: string) {
  await ensureAuthReady();
  return { success: true };
}

// utils/functionsApi.ts
export async function initializeTopUp(_userId: string, amount: number, opts?: { returnUrl?: string; cancelUrl?: string }) {
  const payload: any = {
    amount: Number(amount).toFixed(2),
    currency: 'ZAR',
  };
  if (opts?.returnUrl) payload.returnUrl = opts.returnUrl;
  if (opts?.cancelUrl) payload.cancelUrl = opts.cancelUrl;

  const data: any = await callCallable('createPayPalOrder', payload);

  const approveUrl =
    data?.approveLinks?.[0]?.href ||
    data?.links?.find((l: any) => l.rel === 'approve')?.href ||
    null;

  if (!approveUrl) throw new Error('No PayPal approval URL returned');
  return { orderId: data.orderId ?? data.id, status: data.status, approveUrl };
}


export async function verifyTopUp(_userId: string, orderId: string) {
  const data: any = await callCallable('capturePayPalOrder', { orderId });
  return { success: true, ...data }; // { status, credited, currency, paypal:{...} }
}

export async function transferFunds(_senderId: string, recipientId: string, amount: number) {
  const data: any = await callCallable('transferFunds', {
    toUid: recipientId,
    amount,
  });
  return data; // { status: 'SUCCESS' }
}

export async function getTransactions(limit = 20, cursor?: string) {
  return callCallable<
    { limit?: number; cursor?: string },
    { items?: any[]; nextCursor?: string | null }
  >('getTransactions', { limit, ...(cursor ? { cursor } : {}) });
}

export async function syncPersonalOnChainWallet(onchainAddress: string) {
  return callCallable<
    { onchainAddress: string },
    { ok?: boolean; address?: string; balanceSats?: number; txCount?: number; inserted?: number }
  >('syncPersonalOnChainWallet', { onchainAddress });
}

// ---------- Crypto Wallet Functions ----------

export async function getWalletAddress(userId: string, token?: 'USDC' | 'USDT') {
  const data: any = await callCallable('getWalletAddress', { token });
  return {
    walletAddress: data.walletAddress,
    token: data.token,
    tokenAddress: data.tokenAddress,
    paymentId: data.paymentId,
  };
}

export async function createCryptoTopUpRequest(
  userId: string,
  amount: string,
  token: 'USDC' | 'USDT'
) {
  const data: any = await callCallable('createCryptoTopUpRequest', {
    amount,
    token,
  });

  return {
    paymentId: data.paymentId,
    amount: data.amount,
    token: data.token,
    tokenAddress: data.tokenAddress,
    walletAddress: data.walletAddress,
  };
}

export async function verifyCryptoPayment(
  userId: string,
  transactionHash: string,
  paymentId?: string
) {
  const data: any = await callCallable('verifyCryptoPayment', {
    transactionHash,
    paymentId,
  });

  return {
    success: data.status === 'SUCCESS',
    status: data.status,
    credited: data.credited,
    token: data.token,
    transactionHash: data.transactionHash,
  };
}

/** Creator-only: assigns a unique P2WPKH address for the group (server HD wallet). */
export async function provisionGroupOnChainWallet(
  groupId: string,
  communityId: string,
  walletAccessPin?: string
) {
  return callCallable<
    { groupId: string; communityId: string; walletAccessPin?: string },
    {
      ok?: boolean;
      onchainAddress?: string;
      derivationIndex?: number;
      alreadyProvisioned?: boolean;
    }
  >('provisionGroupOnChainWallet', {
    groupId,
    communityId,
    ...(walletAccessPin != null ? { walletAccessPin } : {}),
  });
}

/** Unlock group wallet UI (passcode set when the group was created with a wallet). */
export async function verifyGroupWalletAccessPin(groupId: string, pin: string) {
  return callCallable<{ groupId: string; pin: string }, { ok?: boolean; legacyNoPin?: boolean }>(
    'verifyGroupWalletAccessPin',
    { groupId, pin }
  );
}

/** Any group member: refresh balance + transaction list from mempool.space. */
export async function syncGroupOnChainWallet(groupId: string) {
  return callCallable<{ groupId: string }, { ok?: boolean; balanceSats?: number; txCount?: number }>(
    'syncGroupOnChainWallet',
    { groupId }
  );
}

/** Spend node/LN wallet balance on-chain to the group's receive address (see backend /internal/send-onchain). */
export async function depositToGroupFromWallet(params: {
  groupId: string;
  amountSats: number;
  senderPubKey: string;
}) {
  return callCallable<
    { groupId: string; amountSats: number; senderPubKey: string },
    { ok?: boolean; txid?: string }
  >('depositToGroupFromWallet', params);
}

/** Group creator: send sats from group wallet to any on-chain address. */
export async function sendFromGroupWallet(params: {
  groupId: string;
  address: string;
  amountSats: number;
}) {
  return callCallable<
    { groupId: string; address: string; amountSats: number },
    { ok?: boolean; txid?: string }
  >("sendFromGroupWallet", params);
}

/** Personal wallet: send sats on-chain to any BTC address. */
export async function sendFromWalletOnChain(params: {
  address: string;
  amountSats: number;
  senderPubKey: string;
}) {
  return callCallable<
    { address: string; amountSats: number; senderPubKey: string },
    { ok?: boolean; txid?: string; feeSats?: number }
  >('sendFromWalletOnChain', params);
}