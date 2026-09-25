/**
 * Swap Service — XLM <-> USDC/EURC via Horizon + Soroswap (real, no mock)
 */
import { quoteStrictSend, swapStrictSend } from "./payments.js";
import { log } from "./logger.js";
export async function getQuote(sendAsset, destAsset, amount) {
    const q = await quoteStrictSend(sendAsset, amount, destAsset);
    log("info", "swap_quote", { sendAsset, destAsset, amount, destAmount: q.destAmount });
    return q;
}
export async function executeSwap(sendAsset, destAsset, sendAmount, destMin, destination) {
    return swapStrictSend(sendAsset, destAsset, sendAmount, destMin, destination);
}
// Soroswap fallback (if Horizon path empty, try Soroswap API when configured)
export async function getSoroswapQuote(sendAsset, destAsset, amount) {
    const url = process.env.SOROSWAP_API || "https://api.soroswap.finance/quote";
    try {
        const res = await fetch(`${url}?from=${sendAsset}&to=${destAsset}&amount=${amount}`);
        if (!res.ok)
            return null;
        const j = await res.json();
        return { destAmount: j.amountOut || j.destAmount };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=swap.js.map