/**
 * Relayer Fee Economics — Reserve Defense & Surge-Aware Estimation (#760)
 *
 * Implements dynamic fee estimation based on:
 * - Reserve defense: ensuring relayer maintains minimum reserve for operations
 * - Surge awareness: adjusting fees based on network load and fee volatility
 * - Historical tracking: analyzing fee trends to predict future costs
 * - Fairness: distributing fees equitably across operations
 */

import { log } from "./logger.js";
import { getDb } from "./db.js";

// Reserve thresholds (in XLM)
const MINIMUM_OPERATING_RESERVE = 50; // Minimum to keep operations running
const SAFE_OPERATING_RESERVE = 100; // Target comfortable reserve
const PANIC_RESERVE = 20; // Alert threshold

// Fee parameters
const BASE_FEE_STROOPS = 100; // Stellar base fee
const SURGE_MULTIPLIER_NORMAL = 1.0;
const SURGE_MULTIPLIER_HIGH = 2.0;
const SURGE_MULTIPLIER_CRITICAL = 4.0;

export interface FeeEstimate {
  baseFee: number; // Per operation in stroops
  surgeMultiplier: number;
  totalFee: number; // Per operation after surge
  recommendedForOps: number; // Fee for full batch operation count
  reserveStatus: "healthy" | "warning" | "critical";
  networkStatus: "normal" | "elevated" | "surge";
}

export interface RelayerReserveStatus {
  totalBalance: number; // In XLM
  reservedForSponsorship: number; // Locked by claimable balances
  availableForOperations: number; // Free to use
  minimumRequired: number;
  status: "healthy" | "warning" | "critical";
  riskFactors: string[];
}

/**
 * Analyzes recent fee trends to detect surge conditions.
 * Returns a multiplier to apply to base fees.
 */
export async function calculateSurgeMultiplier(): Promise<number> {
  const db = getDb();
  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  // Get average fee paid in last hour
  const recentFees = db
    .prepare(
      `
      SELECT AVG(fee_per_op) as avg_fee, MAX(fee_per_op) as max_fee
      FROM transaction_fees
      WHERE submitted_at > ?
      `,
    )
    .get(oneHourAgo) as any;

  if (!recentFees || !recentFees.avg_fee) {
    return SURGE_MULTIPLIER_NORMAL;
  }

  const avgFee = recentFees.avg_fee;
  const maxFee = recentFees.max_fee || avgFee;

  // Calculate surge based on deviation from base
  const surgeRatio = avgFee / BASE_FEE_STROOPS;

  if (surgeRatio > 3.0) {
    return SURGE_MULTIPLIER_CRITICAL; // Network in critical state
  } else if (surgeRatio > 1.5) {
    return SURGE_MULTIPLIER_HIGH; // Elevated fees
  }

  return SURGE_MULTIPLIER_NORMAL; // Normal conditions
}

/**
 * Evaluates relayer reserve status.
 * Used to determine if operations should be throttled or rejected.
 */
export async function assessRelayerReserve(
  totalBalance: number,
  reservedForSponsorship: number,
  estimatedUpcomingFees: number = 0,
): Promise<RelayerReserveStatus> {
  const availableForOperations = totalBalance - reservedForSponsorship;
  const minimumRequired = MINIMUM_OPERATING_RESERVE;

  const riskFactors: string[] = [];
  let status: "healthy" | "warning" | "critical" = "healthy";

  if (availableForOperations < minimumRequired) {
    status = "critical";
    riskFactors.push(`Below minimum reserve: ${availableForOperations.toFixed(2)} XLM`);
  } else if (availableForOperations < SAFE_OPERATING_RESERVE) {
    status = "warning";
    riskFactors.push(`Below safe reserve: ${availableForOperations.toFixed(2)} XLM`);
  }

  if (availableForOperations - estimatedUpcomingFees < PANIC_RESERVE) {
    if (status === "healthy") status = "warning";
    riskFactors.push(`Upcoming fees would deplete reserve`);
  }

  if (totalBalance < 10) {
    status = "critical";
    riskFactors.push(`Critical balance: ${totalBalance.toFixed(2)} XLM`);
  }

  log("info", "relayer_reserve_assessed", {
    totalBalance: totalBalance.toFixed(2),
    availableForOperations: availableForOperations.toFixed(2),
    status,
    riskFactors: riskFactors.length > 0 ? riskFactors : undefined,
  });

  return {
    totalBalance,
    reservedForSponsorship,
    availableForOperations,
    minimumRequired,
    status,
    riskFactors,
  };
}

/**
 * Estimates fees for an operation given current network conditions.
 * Factors in surge pricing and reserve defense.
 */
export async function estimateFee(
  opCount: number,
  relayerBalance: number,
  sponsoredCount: number = 0,
): Promise<FeeEstimate> {
  const surgeMultiplier = await calculateSurgeMultiplier();

  // Determine network status
  const networkStatus =
    surgeMultiplier > 2.0 ? "surge" : surgeMultiplier > 1.2 ? "elevated" : "normal";

  // Base fee calculation
  const baseFee = BASE_FEE_STROOPS * surgeMultiplier;
  const totalFee = baseFee * opCount;

  // Convert stroops to XLM for reserve assessment
  const totalFeeXlm = totalFee / 10_000_000;

  // Assess reserve impact
  const reserveStatus =
    relayerBalance - totalFeeXlm < MINIMUM_OPERATING_RESERVE
      ? "critical"
      : relayerBalance - totalFeeXlm < SAFE_OPERATING_RESERVE
        ? "warning"
        : "healthy";

  // If reserve is critical, apply additional surge to encourage batching
  const adjustedSurgeMultiplier =
    reserveStatus === "critical"
      ? surgeMultiplier * 2.0
      : reserveStatus === "warning"
        ? surgeMultiplier * 1.5
        : surgeMultiplier;

  const adjustedTotalFee = BASE_FEE_STROOPS * adjustedSurgeMultiplier * opCount;

  return {
    baseFee: Math.ceil(BASE_FEE_STROOPS * adjustedSurgeMultiplier),
    surgeMultiplier: adjustedSurgeMultiplier,
    totalFee: Math.ceil(adjustedTotalFee),
    recommendedForOps: Math.ceil(adjustedTotalFee),
    reserveStatus,
    networkStatus: networkStatus as "normal" | "elevated" | "surge",
  };
}

/**
 * Records a transaction fee for historical tracking.
 * Used to calculate surge multipliers and analyze fee trends.
 */
export async function recordTransactionFee(
  txHash: string,
  feePerOp: number,
  opCount: number,
  totalFee: number,
): Promise<void> {
  const db = getDb();

  try {
    db.prepare(
      `
      INSERT INTO transaction_fees
      (tx_hash, fee_per_op, op_count, total_fee, submitted_at)
      VALUES (?, ?, ?, ?, ?)
      `,
    ).run(
      txHash,
      feePerOp,
      opCount,
      totalFee,
      new Date().toISOString(),
    );
  } catch (e: any) {
    log("warn", "fee_recording_failed", {
      txHash,
      error: e.message,
    });
  }
}

/**
 * Analyzes fee trends over a time period.
 * Returns statistics for fee governance and alert thresholds.
 */
export async function analyzeFeeMetrics(
  periodMs: number = 24 * 60 * 60 * 1000, // 24 hours default
): Promise<{
  avgFee: number;
  maxFee: number;
  minFee: number;
  p95Fee: number;
  txCount: number;
  surgePercent: number;
}> {
  const db = getDb();
  const periodStart = Date.now() - periodMs;

  const stats = db
    .prepare(
      `
      SELECT
        AVG(fee_per_op) as avg_fee,
        MAX(fee_per_op) as max_fee,
        MIN(fee_per_op) as min_fee,
        COUNT(*) as tx_count
      FROM transaction_fees
      WHERE submitted_at > ?
      `,
    )
    .get(periodStart) as any;

  // Calculate p95
  const p95Result = db
    .prepare(
      `
      SELECT fee_per_op
      FROM transaction_fees
      WHERE submitted_at > ?
      ORDER BY fee_per_op DESC
      LIMIT 1 OFFSET (
        SELECT MAX(CAST(COUNT(*) * 0.05 AS INTEGER))
        FROM transaction_fees
        WHERE submitted_at > ?
      )
      `,
    )
    .get(periodStart, periodStart) as any;

  const p95 = p95Result?.fee_per_op || stats?.max_fee || BASE_FEE_STROOPS;

  const avgFee = stats?.avg_fee || BASE_FEE_STROOPS;
  const surgePercent =
    ((avgFee - BASE_FEE_STROOPS) / BASE_FEE_STROOPS) * 100;

  return {
    avgFee: Math.round(avgFee),
    maxFee: Math.round(stats?.max_fee || BASE_FEE_STROOPS),
    minFee: Math.round(stats?.min_fee || BASE_FEE_STROOPS),
    p95Fee: Math.round(p95),
    txCount: stats?.tx_count || 0,
    surgePercent: Math.max(0, surgePercent),
  };
}

/**
 * Determines if operations should be throttled based on reserve and surge conditions.
 * Returns true if new operations should be rejected or delayed.
 */
export async function shouldThrottleOperations(
  reserveStatus: RelayerReserveStatus,
  feeEstimate: FeeEstimate,
): Promise<boolean> {
  // Critical reserve + surge = definitely throttle
  if (reserveStatus.status === "critical" && feeEstimate.networkStatus !== "normal") {
    return true;
  }

  // Critical reserve alone
  if (
    reserveStatus.status === "critical" &&
    reserveStatus.availableForOperations < PANIC_RESERVE
  ) {
    return true;
  }

  // Warning reserve with critical surge
  if (
    reserveStatus.status === "warning" &&
    feeEstimate.networkStatus === "surge"
  ) {
    return true;
  }

  return false;
}

/**
 * Provides fee governance recommendations to relayer operators.
 */
export async function getFeeGovernanceReport(): Promise<{
  currentEstimate: FeeEstimate;
  reserveStatus: RelayerReserveStatus;
  feeMetrics: Awaited<ReturnType<typeof analyzeFeeMetrics>>;
  recommendations: string[];
}> {
  // This would require relayer balance to be passed in or queried
  // For now, we'll use placeholder values
  const currentEstimate = await estimateFee(100, 500, 0);
  const reserveStatus = await assessRelayerReserve(500, 25, 0.5);
  const feeMetrics = await analyzeFeeMetrics();

  const recommendations: string[] = [];

  if (feeMetrics.surgePercent > 50) {
    recommendations.push("Network fees are elevated. Consider batching operations.");
  }

  if (reserveStatus.status === "critical") {
    recommendations.push("URGENT: Relayer reserve is critical. Deposit funds immediately.");
  } else if (reserveStatus.status === "warning") {
    recommendations.push("Reserve is low. Plan to deposit funds soon.");
  }

  if (currentEstimate.networkStatus === "surge") {
    recommendations.push("Network is experiencing surge conditions. Monitor closely.");
  }

  return {
    currentEstimate,
    reserveStatus,
    feeMetrics,
    recommendations,
  };
}
