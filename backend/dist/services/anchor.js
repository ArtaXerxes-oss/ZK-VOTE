/**
 * Anchor Service — SEP-6/24/31 for USDC/EURC inflow/outflow (real, no mock)
 * Proxies to Circle/Tempo anchors; stores claimableBalance for pending
 */
import { log } from "./logger.js";
const ANCHOR_USDC = process.env.ANCHOR_USDC_URL || "https://anchor.circle.com";
const ANCHOR_EURC = process.env.ANCHOR_EURC_URL || "https://anchor.eurc.circle.com";
function anchorFor(asset) {
    return asset === "USDC" ? ANCHOR_USDC : ANCHOR_EURC;
}
export async function sep6Deposit(asset, account, amount) {
    const base = anchorFor(asset);
    const url = `${base}/sep6/deposit?asset=${asset}&account=${account}&amount=${amount}`;
    const res = await fetch(url);
    const j = await res.json();
    log("info", "anchor_deposit", { asset, account: account.slice(0, 8) + "...", amount });
    return j; // { id, how, eta, ... }
}
export async function sep6Withdraw(asset, account, amount, dest) {
    const base = anchorFor(asset);
    const url = `${base}/sep6/withdraw?asset=${asset}&account=${account}&amount=${amount}&dest=${dest}`;
    const res = await fetch(url);
    const j = await res.json();
    log("info", "anchor_withdraw", { asset, account: account.slice(0, 8) + "...", amount });
    return j;
}
export async function sep31Send(asset, payload) {
    const base = anchorFor(asset);
    const res = await fetch(`${base}/sep31/transactions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    return res.json();
}
//# sourceMappingURL=anchor.js.map