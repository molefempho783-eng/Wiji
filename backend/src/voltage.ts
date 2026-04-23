/**
 * Voltage API client – uses the same format as your sample curl:
 *   backend.voltage.cloud, header X-Api-Key
 * Use this to list wallets/nodes in your org (e.g. to verify the API key).
 */

import axios, { AxiosInstance } from "axios";

const VOLTAGE_API_KEY = process.env.VOLTAGE_API_KEY;
const VOLTAGE_ORG_ID = process.env.VOLTAGE_ORG_ID;

// Safe debug: presence only (never log secrets)
console.log("[voltage] configured:", {
  apiKeyPresent: typeof VOLTAGE_API_KEY === "string" && VOLTAGE_API_KEY.length > 0,
  apiKeyLen: typeof VOLTAGE_API_KEY === "string" ? VOLTAGE_API_KEY.length : 0,
  orgIdPresent: typeof VOLTAGE_ORG_ID === "string" && VOLTAGE_ORG_ID.length > 0,
});

const VOLTAGE_BASE_URL = "https://backend.voltage.cloud/api/v1";

function createVoltageClient(authStyle: "header" | "bearer"): AxiosInstance {
  const authHeaders =
    authStyle === "bearer"
      ? { Authorization: `Bearer ${VOLTAGE_API_KEY}` }
      : {
          // Some Voltage endpoints use one of these key headers.
          "X-Api-Key": VOLTAGE_API_KEY,
          "X-VOLTAGE-AUTH": VOLTAGE_API_KEY,
        };
  return axios.create({
    baseURL: VOLTAGE_BASE_URL,
    timeout: 15000,
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
}

export function isVoltageConfigured(): boolean {
  return !!VOLTAGE_API_KEY && !!VOLTAGE_ORG_ID;
}

/** List wallets for your organization (same as your sample curl). */
export async function listWallets(): Promise<unknown> {
  if (!VOLTAGE_API_KEY || !VOLTAGE_ORG_ID) {
    throw new Error("Voltage API not configured: set VOLTAGE_API_KEY and VOLTAGE_ORG_ID");
  }
  console.log("[voltage] requesting wallets for org:", VOLTAGE_ORG_ID);
  const path = `/organizations/${VOLTAGE_ORG_ID}/wallets`;

  // Try key-header auth first, then bearer if Voltage responds with missing credentials.
  try {
    const { data } = await createVoltageClient("header").get(path);
    return data;
  } catch (err: any) {
    const type = err?.response?.data?.error?.type;
    if (type !== "missing_credentials") throw err;
    const { data } = await createVoltageClient("bearer").get(path);
    return data;
  }
}
