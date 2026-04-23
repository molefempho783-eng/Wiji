import { Router } from "express";
import {
  createInvoiceSats,
  createBoltzSubmarineSwap,
  getBoltzSwapStatus,
  getWalletBalanceSats,
  payInvoice,
  sendOnChainToAddress,
} from "./lightning";
import { findUserByName, upsertUser } from "./userStore";

/**
 * HTTP router implementing the contract expected by the mobile app:
 *
 * - GET  /get-balance?pubKey=...
 * - POST /create-invoice   { amount, receiverPubKey }
 * - POST /pay-invoice      { invoice, senderPubKey }
 * - POST /send-to-username { sender, receiver, amount }
 *
 * All validation and fee logic lives here; seed phrases NEVER touch this backend.
 */

const SERVICE_FEE_PERCENT = 1; // 1% platform fee
const MIN_BOLTZ_SWAP_SATS = 25_000;

export function createLightningRouter() {
  const router = Router();

  router.get("/get-balance", async (req, res) => {
    try {
      const pubKey = String(req.query.pubKey || "").trim();
      if (!pubKey) {
        return res.status(400).json({ message: "pubKey is required" });
      }

      // For now: global node balance. In production, you should track balances per pubkey.
      const balance = await getWalletBalanceSats();
      return res.json({ balance });
    } catch (err) {
      console.error("[GET /get-balance] error", err);
      return res.status(500).json({ message: "Failed to fetch balance" });
    }
  });

  router.post("/create-invoice", async (req, res) => {
    try {
      const { amount, receiverPubKey, label } = req.body as {
        amount?: number;
        receiverPubKey?: string;
        label?: string;
      };

      if (!amount || amount <= 0) {
        return res.status(400).json({ message: "amount must be > 0" });
      }
      if (!receiverPubKey || typeof receiverPubKey !== "string") {
        return res.status(400).json({ message: "receiverPubKey is required" });
      }

      // Optional: upsert receiver in our in-memory user store by pubkey only
      upsertUser(receiverPubKey, receiverPubKey);

      // Keep memo short so BOLT11 stays compact and easier to scan as QR.
      const cleanLabel = typeof label === "string" ? label.trim() : "";
      const memo = cleanLabel ? `Square ${cleanLabel}`.slice(0, 40) : "Square receive";
      const { invoice } = await createInvoiceSats(amount, memo);
      return res.json({ invoice });
    } catch (err) {
      console.error("[POST /create-invoice] error", err);
      return res.status(500).json({ message: "Failed to create invoice" });
    }
  });

  router.post("/pay-invoice", async (req, res) => {
    try {
      const { invoice, senderPubKey } = req.body as {
        invoice?: string;
        senderPubKey?: string;
      };
      if (!invoice || typeof invoice !== "string") {
        return res.status(400).json({ message: "invoice is required" });
      }
      if (!senderPubKey || typeof senderPubKey !== "string") {
        return res.status(400).json({ message: "senderPubKey is required" });
      }

      // Optional: store sender pubkey as a user record
      upsertUser(senderPubKey, senderPubKey);

      const result = await payInvoice(invoice);
      if (!result.success) {
        return res.status(502).json({
          success: false,
          error: result.error ?? "Payment failed",
        });
      }
      return res.json({
        success: true,
        paymentHash: result.payment_preimage,
      });
    } catch (err) {
      console.error("[POST /pay-invoice] error", err);
      return res.status(500).json({ success: false, error: "Failed to pay invoice" });
    }
  });

  /**
   * Internal only: move on-chain sats from the LND wallet to a Bitcoin address.
   * Called by Firebase Functions after auth — never expose without shared secret.
   */
  router.post("/internal/send-onchain", async (req, res) => {
    try {
      const secret = String(req.headers["x-internal-secret"] ?? "").trim();
      const expected = process.env.INTERNAL_API_SECRET?.trim();
      if (!expected || secret !== expected) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { address, amountSats, label } = req.body as {
        address?: string;
        amountSats?: number;
        label?: string;
      };

      if (!address || typeof address !== "string") {
        return res.status(400).json({ message: "address is required" });
      }
      const trimmed = address.trim();
      const looksOk =
        /^bc1[qp][a-z0-9]{20,}$/i.test(trimmed) ||
        /^tb1[qp][a-z0-9]{20,}$/i.test(trimmed) ||
        /^bcrt1[qp][a-z0-9]{20,}$/i.test(trimmed) ||
        /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed);
      if (!looksOk) {
        return res.status(400).json({ message: "Invalid Bitcoin address" });
      }

      const amt = Number(amountSats);
      if (!Number.isFinite(amt) || amt < 1000) {
        return res.status(400).json({ message: "amountSats must be at least 1000" });
      }

      const { txid } = await sendOnChainToAddress(trimmed, Math.floor(amt), {
        label: typeof label === "string" ? label : undefined,
      });
      return res.json({ ok: true, txid });
    } catch (err) {
      console.error("[POST /internal/send-onchain] error", err);
      const msg = err instanceof Error ? err.message : "Send failed";
      return res.status(502).json({ message: msg });
    }
  });

  /**
   * Create a Boltz submarine swap so user sends on-chain BTC and receives LN liquidity.
   * This enables "on-chain deposit -> Lightning spendable" flow.
   */
  router.post("/create-onchain-lightning-swap", async (req, res) => {
    try {
      const { amount, receiverPubKey, label } = req.body as {
        amount?: number;
        receiverPubKey?: string;
        label?: string;
      };

      const sats = Math.floor(Number(amount));
      if (!Number.isFinite(sats) || sats <= 0) {
        return res.status(400).json({ message: "amount must be > 0" });
      }
      if (sats < MIN_BOLTZ_SWAP_SATS) {
        return res
          .status(400)
          .json({ message: `Minimum swap amount is ${MIN_BOLTZ_SWAP_SATS.toLocaleString()} sats` });
      }
      if (!receiverPubKey || typeof receiverPubKey !== "string") {
        return res.status(400).json({ message: "receiverPubKey is required" });
      }

      const cleanLabel = typeof label === "string" ? label.trim() : "";
      const memo = cleanLabel ? `Square swap-in ${cleanLabel}`.slice(0, 40) : "Square swap-in";
      const { invoice } = await createInvoiceSats(sats, memo);
      const swap = await createBoltzSubmarineSwap(invoice);
      if (!swap?.id || !swap?.address) {
        return res.status(502).json({ message: "Boltz did not return swap id/address" });
      }

      return res.json({
        ok: true,
        id: swap.id,
        address: swap.address,
        bip21: swap.bip21,
        expectedAmount: Number(swap.expectedAmount ?? sats),
        timeoutBlockHeight: swap.timeoutBlockHeight ?? null,
        status: swap.status ?? "invoice.set",
      });
    } catch (err) {
      console.error("[POST /create-onchain-lightning-swap] error", err);
      const msg = err instanceof Error ? err.message : "Failed to create swap";
      return res.status(502).json({ message: msg });
    }
  });

  router.get("/onchain-lightning-swap/:id", async (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ message: "id is required" });
      const data = await getBoltzSwapStatus(id);
      return res.json(data);
    } catch (err) {
      console.error("[GET /onchain-lightning-swap/:id] error", err);
      const msg = err instanceof Error ? err.message : "Failed to fetch swap status";
      return res.status(502).json({ message: msg });
    }
  });

  router.post("/send-to-username", async (req, res) => {
    try {
      const { sender, receiver, amount } = req.body as {
        sender?: string;
        receiver?: string;
        amount?: number;
      };

      if (!sender || !receiver) {
        return res.status(400).json({ message: "sender and receiver are required" });
      }
      if (!amount || amount <= 0) {
        return res.status(400).json({ message: "amount must be > 0" });
      }

      const senderKey = sender.trim().toLowerCase();
      const receiverKey = receiver.trim().toLowerCase();

      const receiverUser = findUserByName(receiverKey);
      if (!receiverUser) {
        return res.status(404).json({ success: false, error: "Receiver not found" });
      }

      // Fee: backend charges 1% on top of requested amount
      const fee = Math.ceil((amount * SERVICE_FEE_PERCENT) / 100);
      const totalAmount = amount + fee;

      // Create invoice for receiver for totalAmount
      const { invoice } = await createInvoiceSats(
        totalAmount,
        `Square send-to-username ${senderKey}->${receiverKey}`
      );

      // Pay the invoice from node wallet (this is node funds; you can extend with accounting)
      const result = await payInvoice(invoice);
      if (!result.success) {
        return res.status(502).json({
          success: false,
          error: result.error ?? "Payment failed",
        });
      }

      return res.json({
        success: true,
        paymentHash: result.payment_preimage,
      });
    } catch (err) {
      console.error("[POST /send-to-username] error", err);
      return res.status(500).json({ success: false, error: "Failed to send to username" });
    }
  });

  return router;
}

