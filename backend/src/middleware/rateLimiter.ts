/**
 * Rate Limiter - Separate budgets for queries vs votes (#710 / SPIKE-025)
 *
 * Prevents polling from consuming vote budget and provides NAT-fair limiting.
 *
 * PLACEHOLDER: Requires full implementation with:
 * - Multi-replica shared state
 * - NAT-fair keying (not just IP)
 * - Blinded tokens or PoW
 * - Adversarial spam testing
 */

export interface RateLimitConfig {
  /** Votes per window */
  votesPerWindow: number;
  /** Queries per window */
  queriesPerWindow: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Enable separate budgets */
  separateBudgets: boolean;
}

export interface RateLimitBudget {
  /** Remaining votes in current window */
  votesRemaining: number;
  /** Remaining queries in current window */
  queriesRemaining: number;
  /** Window reset timestamp */
  windowResetAt: number;
}

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  votesPerWindow: 10,
  queriesPerWindow: 60,
  windowMs: 60 * 1000, // 1 minute
  separateBudgets: true,
};

/**
 * Get rate limit key for request.
 * PLACEHOLDER: IP-based is NAT-unfair. Needs blinded tokens or PoW.
 */
export function getRateLimitKey(
  ip: string,
  _userAgent?: string,
): string {
  // TODO: Implement NAT-fair keying
  return `ratelimit:${ip}`;
}

/**
 * Check if request is within rate limit.
 * PLACEHOLDER: In-memory, single-instance only. Needs shared store.
 */
const budgets = new Map<string, RateLimitBudget>();

export function checkRateLimit(
  key: string,
  type: "vote" | "query",
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let budget = budgets.get(key);

  // Initialize or reset window
  if (!budget || now >= budget.windowResetAt) {
    budget = {
      votesRemaining: config.votesPerWindow,
      queriesRemaining: config.queriesPerWindow,
      windowResetAt: now + config.windowMs,
    };
    budgets.set(key, budget);
  }

  // Check budget
  const remaining = type === "vote"
    ? budget.votesRemaining
    : budget.queriesRemaining;

  if (remaining <= 0) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: budget.windowResetAt,
    };
  }

  // Consume budget
  if (type === "vote") {
    budget.votesRemaining--;
  } else {
    budget.queriesRemaining--;
  }

  return {
    allowed: true,
    remaining: remaining - 1,
    resetAt: budget.windowResetAt,
  };
}

/**
 * Get current budget status without consuming.
 */
export function getRateLimitStatus(
  key: string,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG,
): RateLimitBudget {
  const now = Date.now();
  const budget = budgets.get(key);

  if (!budget || now >= budget.windowResetAt) {
    return {
      votesRemaining: config.votesPerWindow,
      queriesRemaining: config.queriesPerWindow,
      windowResetAt: now + config.windowMs,
    };
  }

  return { ...budget };
}

/**
 * Reset rate limit for a key (admin/testing only).
 */
export function resetRateLimit(key: string): void {
  budgets.delete(key);
}

/**
 * Clear all rate limits (testing only).
 */
export function clearAllRateLimits(): void {
  budgets.clear();
}
