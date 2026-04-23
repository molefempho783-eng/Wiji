import axios, { AxiosInstance } from "axios";
import { createECDH } from "crypto";
import https from "https";

const rawLndRestUrl = process.env.LND_REST_URL; // e.g. your-node.m.voltageapp.io:8080 or https://...
const LND_MACAROON_HEX = process.env.LND_MACAROON_HEX; // admin/invoice macaroon hex

function normalizeLndRestUrl(url: string): string {
  const trimmed = url.trim().replace(/\/$/, "");
  // Accept host:port in env for convenience; default to HTTPS for Voltage LND REST.
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

const LND_REST_URL = rawLndRestUrl ? normalizeLndRestUrl(rawLndRestUrl) : undefined;

if (!LND_REST_URL) {
  console.warn("[lightning] LND_REST_URL is not set – Lightning API disabled");
}
if (!LND_MACAROON_HEX) {
  console.warn("[lightning] LND_MACAROON_HEX is not set – Lightning API disabled");
}

/** If true, invoices include route hints (useful when the node only has private / unannounced channels). */
const LND_PRIVATE_INVOICES = process.env.LND_PRIVATE_INVOICES === "true";

const lnd: AxiosInstance | null =
  LND_REST_URL && LND_MACAROON_HEX
    ? axios.create({
        baseURL: LND_REST_URL.replace(/\/$/, ""),
        timeout: 15000,
        headers: {
          "Grpc-Metadata-macaroon": LND_MACAROON_HEX,
        },
      })
    : null;

export function ensureLnd(): AxiosInstance {
  if (!lnd) {
    throw new Error("LND REST client is not configured");
  }
  return lnd;
}

// Create invoice (sats → BOLT11)
export async function createInvoiceSats(amountSats: number, memo?: string) {
  const client = ensureLnd();
  const body: Record<string, string | boolean> = {
    value: amountSats.toString(),
    memo: memo ?? "Square Lightning invoice",
  };
  if (LND_PRIVATE_INVOICES) {
    body.private = true;
  }
  const { data } = await client.post("/v1/invoices", body);
  if (!data.payment_request) {
    throw new Error("LND did not return payment_request");
  }
  return {
    invoice: data.payment_request as string,
    r_hash: data.r_hash as string | undefined,
  };
}

// Pay invoice
export async function payInvoice(bolt11: string) {
  const client = ensureLnd();
  const body = { payment_request: bolt11 };
  const { data } = await client.post("/v1/channels/transactions", body);
  const error = (data.payment_error as string | undefined) || undefined;
  const success = !error;
  return {
    success,
    error,
    payment_preimage: data.payment_preimage as string | undefined,
  };
}

// Node balance (on-chain + channel)
export async function getWalletBalanceSats(): Promise<number> {
  const client = ensureLnd();
  const [{ data: chan }, { data: wallet }] = await Promise.all([
    client.get("/v1/balance/channels"),
    client.get("/v1/balance/blockchain"),
  ]);
  const ln = Number(chan.local_balance?.sat || 0);
  const onchain = Number(wallet.confirmed_balance || 0);
  return ln + onchain;
}

/** Send on-chain from LND wallet to a Bitcoin address (mainnet/testnet per node). */
export async function sendOnChainToAddress(
  address: string,
  amountSats: number,
  opts?: { label?: string; targetConf?: number }
): Promise<{ txid: string }> {
  const client = ensureLnd();
  if (!Number.isFinite(amountSats) || amountSats < 1) {
    throw new Error("amountSats must be a positive integer");
  }
  const body: Record<string, string | number> = {
    addr: address.trim(),
    amount: Math.floor(amountSats),
    target_conf: opts?.targetConf ?? 6,
  };
  if (opts?.label) body.label = opts.label.slice(0, 200);

  const { data } = await client.post("/v1/transactions", body);
  const txid = data?.txid as string | undefined;
  if (!txid) throw new Error("LND did not return txid for send");
  return { txid };
}

type BoltzCreateSwapResponse = {
  id?: string;
  address?: string;
  bip21?: string;
  expectedAmount?: number | string;
  timeoutBlockHeight?: number;
  status?: string;
};

function boltzApiBase(): string {
  const raw = (process.env.BOLTZ_API_URL || "https://api.boltz.exchange").trim();
  return raw.replace(/\/$/, "");
}

const boltz = axios.create({
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
  // Windows/Node can sometimes choose an unreachable v6 path; prefer IPv4.
  httpsAgent: new https.Agent({ keepAlive: true, family: 4 }),
});

function mapBoltzError(err: unknown): never {
  const anyErr = err as any;
  const code = String(anyErr?.code || "");
  if (code === "ETIMEDOUT" || code === "ECONNABORTED" || code === "ENETUNREACH") {
    throw new Error(
      "Boltz API unreachable from backend (network timeout). Check firewall/VPN/proxy and BOLTZ_API_URL."
    );
  }
  throw err instanceof Error ? err : new Error("Boltz request failed");
}

function makeRefundPublicKeyHex(): string {
  const ecdh = createECDH("secp256k1");
  ecdh.generateKeys();
  return ecdh.getPublicKey("hex", "compressed");
}

export async function createBoltzSubmarineSwap(invoice: string): Promise<BoltzCreateSwapResponse> {
  const base = boltzApiBase();
  const payload = {
    invoice,
    to: "BTC",
    from: "BTC",
    refundPublicKey: makeRefundPublicKeyHex(),
  };
  try {
    const { data } = await boltz.post(`${base}/v2/swap/submarine`, payload);
    return (data || {}) as BoltzCreateSwapResponse;
  } catch (err) {
    mapBoltzError(err);
  }
}

export async function getBoltzSwapStatus(id: string): Promise<any> {
  const base = boltzApiBase();
  try {
    const { data } = await boltz.get(`${base}/v2/swap/submarine/${id}`);
    return data;
  } catch {
    try {
      const { data } = await boltz.get(`${base}/v2/swap/${id}`);
      return data;
    } catch (err) {
      mapBoltzError(err);
    }
  }
}