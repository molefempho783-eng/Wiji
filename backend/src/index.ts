import "dotenv/config";
import express from "express";
import cors from "cors";
import { createLightningRouter } from "./lightningRouter";
import { isVoltageConfigured, listWallets } from "./voltage";

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
/** Bind all interfaces so Android emulator (10.0.2.2) and LAN devices can reach the API. */
const HOST = process.env.HOST ?? "0.0.0.0";

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? "*",
  })
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Verify Voltage API key – same as your curl: list org wallets
app.get("/voltage/wallets", async (_req, res) => {
  if (!isVoltageConfigured()) {
    return res.status(503).json({
      error: "Voltage not configured",
      hint: "Set VOLTAGE_API_KEY and VOLTAGE_ORG_ID in .env",
    });
  }
  try {
    const data = await listWallets();
    return res.json(data);
  } catch (err: unknown) {
    const anyErr = err as any;
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = anyErr?.response?.status;
    const responseData = anyErr?.response?.data;
    return res.status(502).json({
      error: "Voltage API request failed",
      status: typeof status === "number" ? status : undefined,
      message,
      voltageResponse: responseData,
    });
  }
});

app.use("/", createLightningRouter());

app.listen(PORT, HOST, () => {
  console.log(`Square Lightning backend http://${HOST}:${PORT}`);
  console.log(`Health (on this machine): http://127.0.0.1:${PORT}/health`);
});
