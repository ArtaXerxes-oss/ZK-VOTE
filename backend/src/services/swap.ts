/**
 * Swap Service — XLM <-> USDC/EURC via Horizon + Soroswap (real, no mock)
 */
import {
  quoteStrictSend,
  swapStrictSend,
  type PaymentAsset,
} from "./payments.js";
import { log } from "./logger.js";
import {
  canonicalizeStellarAmount,
  parseStroops,
} from "../utils/stellarAmount.js";

export type SwapPair = `${PaymentAsset}/${PaymentAsset}`;

export async function getQuote(
  sendAsset: PaymentAsset,
  destAsset: PaymentAsset,
  amount: string,
) {
  if (sendAsset === destAsset) throw new Error("Swap assets must be distinct");
  const q = await quoteStrictSend(sendAsset, amount, destAsset);
  log("info", "swap_quote", {
    sendAsset,
    destAsset,
    amount,
    destAmount: q.destAmount,
  });
  return q;
}

export async function executeSwap(
  sendAsset: PaymentAsset,
  destAsset: PaymentAsset,
  sendAmount: string,
  destMin: string,
  destination: string,
) {
  if (sendAsset === destAsset) throw new Error("Swap assets must be distinct");
  return swapStrictSend(sendAsset, destAsset, sendAmount, destMin, destination);
}

// Soroswap fallback (if Horizon path empty, try Soroswap API when configured)
export async function getSoroswapQuote(
  sendAsset: PaymentAsset,
  destAsset: PaymentAsset,
  amount: string,
): Promise<{ destAmount: string; destStroops: string } | null> {
  const url = process.env.SOROSWAP_API || "https://api.soroswap.finance/quote";
  try {
    const res = await fetch(
      `${url}?from=${sendAsset}&to=${destAsset}&amount=${amount}`,
    );
    if (!res.ok) return null;
    const j: any = await res.json();
    const rawAmount = String(j.amountOut ?? j.destAmount ?? "");
    const destStroops = parseStroops(rawAmount);
    return {
      destAmount: canonicalizeStellarAmount(rawAmount),
      destStroops: destStroops.toString(),
    };
  } catch {
    return null;
  }
}
