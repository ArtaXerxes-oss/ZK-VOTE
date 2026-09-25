/**
 * Swap Service — XLM <-> USDC/EURC via Horizon + Soroswap (real, no mock)
 */
import { type PaymentAsset } from "./payments.js";
export type SwapPair = `${PaymentAsset}/${PaymentAsset}`;
export declare function getQuote(sendAsset: PaymentAsset, destAsset: PaymentAsset, amount: string): Promise<{
    destAmount: string;
    path: any[];
}>;
export declare function executeSwap(sendAsset: PaymentAsset, destAsset: PaymentAsset, sendAmount: string, destMin: string, destination: string): Promise<{
    hash: string;
}>;
export declare function getSoroswapQuote(sendAsset: PaymentAsset, destAsset: PaymentAsset, amount: string): Promise<{
    destAmount: string;
} | null>;
//# sourceMappingURL=swap.d.ts.map