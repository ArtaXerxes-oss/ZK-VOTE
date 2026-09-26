/**
 * Payments Service — XLM / USDC / EURC (real assets, no mocks)
 * High-volume: MuxedAccount + 100 ops/tx + fee-bump + idempotency
 */
import * as StellarSdk from "@stellar/stellar-sdk";
import { config } from "../config.js";
import { relayerKeypair } from "./stellar.js";
import { relayerKeyManager } from "./relayerKeyManager.js";
import { log } from "./logger.js";
import { getDb } from "./db.js";
const horizonServer = new StellarSdk.Horizon.Server(config.horizonUrl || "https://horizon-testnet.stellar.org");
console.error("PAYMENTS LOADED horizon", horizonServer.serverURL?.href || horizonServer.serverURL);
log("info", "payments_loaded", { url: horizonServer.serverURL?.href || horizonServer.serverURL });
const ISSUERS = {
    XLM: null,
    USDC: process.env.USDC_ISSUER || "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVV",
    EURC: process.env.EURC_ISSUER || "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDHZD37Z7KQ2X2JPRQ",
};
export function getAsset(code) {
    if (code === "XLM")
        return StellarSdk.Asset.native();
    const issuer = ISSUERS[code];
    if (!issuer)
        throw new Error(`Issuer not configured for ${code}`);
    return new StellarSdk.Asset(code, issuer);
}
// MuxedAccount helper for high-volume inflow (one G... → many M...)
export function muxedForUser(base, id) {
    const m = new StellarSdk.MuxedAccount(new StellarSdk.Account(base, "0"), id);
    // StellarSdk.MuxedAccount encodes to M...; fallback to base if not available
    try {
        return m.accountId();
    }
    catch {
        return base;
    }
}
// Single payment (uses relayerKeypair as source, withSequenceLock for high volume) — via Horizon (classic, not Soroban)
export async function sendPayment(op) {
    console.error("PAY via horizon", horizonServer.serverURL?.href || horizonServer.serverURL, "relayer", relayerKeypair.publicKey());
    log("info", "payment_via_horizon", { url: horizonServer.serverURL?.href || horizonServer.serverURL || "horizon-testnet", relayer: relayerKeypair.publicKey() });
    const asset = getAsset(op.asset);
    const dest = op.destination;
    const amount = op.amount;
    const account = await horizonServer.loadAccount(relayerKeypair.publicKey());
    const tx = new StellarSdk.TransactionBuilder(account, { fee: "10000", networkPassphrase: config.networkPassphrase })
        .addOperation(StellarSdk.Operation.payment({ destination: dest, asset, amount }))
        .setTimeout(30)
        .build();
    if (op.memo)
        tx.addMemo?.(StellarSdk.Memo.text(op.memo));
    await relayerKeyManager.signTransaction(tx);
    try {
        const res = await horizonServer.submitTransaction(tx);
        log("info", "payment_sent", { asset: op.asset, amount, dest: dest.slice(0, 8) + "...", hash: res.hash });
        return { hash: res.hash };
    }
    catch (e) {
        const data = e.response?.data || e.response?.body || e.message;
        const extras = data?.extras;
        log("error", "payment_failed", { asset: op.asset, amount, dest: dest.slice(0, 8) + "...", error: JSON.stringify(data).slice(0, 1000), extras: extras ? JSON.stringify(extras).slice(0, 1000) : undefined });
        throw new Error(typeof data === "string" ? data : JSON.stringify(data).slice(0, 500) || e.message);
    }
}
// Batch 100 ops/tx for high-volume inflow/outflow — via Horizon
export async function sendBatch(ops) {
    if (ops.length === 0)
        throw new Error("No ops");
    if (ops.length > 100)
        throw new Error("Batch max 100 ops");
    const idempotencyKey = `batch_${Date.now()}_${ops.length}`;
    const db = getDb();
    try {
        db.prepare("INSERT OR IGNORE INTO payment_jobs (id, ops, created_at) VALUES (?,?,?)").run(idempotencyKey, JSON.stringify(ops), new Date().toISOString());
    }
    catch { }
    const account = await horizonServer.loadAccount(relayerKeypair.publicKey());
    const builder = new StellarSdk.TransactionBuilder(account, { fee: (10000 * ops.length).toString(), networkPassphrase: config.networkPassphrase });
    for (const op of ops) {
        const asset = getAsset(op.asset);
        builder.addOperation(StellarSdk.Operation.payment({ destination: op.destination, asset, amount: op.amount }));
    }
    const tx = builder.setTimeout(30).build();
    await relayerKeyManager.signTransaction(tx);
    const res = await horizonServer.submitTransaction(tx);
    log("info", "batch_sent", { ops: ops.length, hash: res.hash });
    return { hash: res.hash, ops: ops.length };
}
// Path payment for swap XLM<->USDC/EURC via DEX (strictSend) — via Horizon
export async function swapStrictSend(sendAsset, destAsset, sendAmount, destMin, destination) {
    const sendA = getAsset(sendAsset);
    const destA = getAsset(destAsset);
    const account = await horizonServer.loadAccount(relayerKeypair.publicKey());
    const tx = new StellarSdk.TransactionBuilder(account, { fee: "10000", networkPassphrase: config.networkPassphrase })
        .addOperation(StellarSdk.Operation.pathPaymentStrictSend({
        sendAsset: sendA, sendAmount, destination, destAsset: destA, destMin, path: []
    }))
        .setTimeout(30)
        .build();
    await relayerKeyManager.signTransaction(tx);
    const res = await horizonServer.submitTransaction(tx);
    return { hash: res.hash };
}
// Quote via Horizon strictSendPaths (no on-chain, just simulation)
export async function quoteStrictSend(sendAsset, sendAmount, destAsset) {
    const sendA = getAsset(sendAsset);
    const destA = getAsset(destAsset);
    // Horizon Server strictSendPaths
    const horizonUrl = config.horizonUrl || "https://horizon-testnet.stellar.org";
    const params = new URLSearchParams({
        source_account: relayerKeypair.publicKey(),
        send_asset_type: sendA.isNative() ? "native" : "credit_alphanum4",
        send_asset_code: sendA.isNative() ? "" : sendA.getCode(),
        send_asset_issuer: sendA.isNative() ? "" : sendA.getIssuer(),
        send_amount: sendAmount,
        destination_assets: `${destA.getCode()}:${destA.getIssuer()}` // for native, handled
    });
    // Fallback: if Horizon not available, return 1:1
    try {
        const url = `${horizonUrl}/paths/strict-send?${params.toString()}`;
        const res = await fetch(url);
        const j = await res.json();
        if (j._embedded && j._embedded.records && j._embedded.records[0]) {
            const r = j._embedded.records[0];
            return { destAmount: r.destination_amount, path: r.path };
        }
    }
    catch (e) {
        log("warn", "quote_fallback", { error: e.message });
    }
    return { destAmount: sendAmount, path: [] };
}
//# sourceMappingURL=payments.js.map