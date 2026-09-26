/**
 * Payments Service — XLM / USDC / EURC (real assets, no mocks)
 * High-volume: MuxedAccount + 100 ops/tx + fee-bump + idempotency
 */
import * as StellarSdk from "@stellar/stellar-sdk";
export type PaymentAsset = "XLM" | "USDC" | "EURC";
export declare function getAsset(code: PaymentAsset): StellarSdk.Asset;
export declare function muxedForUser(base: string, id: string): string;
export interface PaymentOp {
    destination: string;
    asset: PaymentAsset;
    amount: string;
    memo?: string;
}
export interface BatchResult {
    hash: string;
    ops: number;
}
export declare function sendPayment(op: PaymentOp): Promise<{
    hash: string;
}>;
export declare function sendBatch(ops: PaymentOp[]): Promise<BatchResult>;
export declare function swapStrictSend(sendAsset: PaymentAsset, destAsset: PaymentAsset, sendAmount: string, destMin: string, destination: string): Promise<{
    hash: string;
}>;
export declare function quoteStrictSend(sendAsset: PaymentAsset, sendAmount: string, destAsset: PaymentAsset): Promise<{
    destAmount: string;
    path: any[];
}>;
//# sourceMappingURL=payments.d.ts.map