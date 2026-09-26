/**
 * Relayer health polling cadence (#569).
 *
 * The relayer status query used a fixed 60s refetch interval regardless of
 * outcome. When the relayer (or its indexer/RPC) is down or degraded, every
 * open client kept polling `/health` at the same fixed rate and in lockstep,
 * so a fleet of clients hammered an already-struggling relayer.
 *
 * While the relayer is not ready, the interval now backs off exponentially
 * (60s → 2m → 4m → 8m, capped at 10m) with ±20% jitter so clients spread out.
 * It snaps back to the base interval as soon as the relayer reports ready.
 */

export const RELAYER_POLL_BASE_MS = 60 * 1000;
export const RELAYER_POLL_MAX_MS = 10 * 60 * 1000;
export const RELAYER_POLL_JITTER = 0.2;

/** How long a single /health request may take before it counts as a failure. */
export const RELAYER_HEALTH_TIMEOUT_MS = 5 * 1000;

/**
 * Delay before the next relayer status poll.
 *
 * @param consecutiveFailures polls in a row that did not report "ready"
 *   (0 = last poll was healthy)
 * @param random injectable RNG in [0, 1) for deterministic tests
 */
export function nextRelayerPollDelay(
  consecutiveFailures: number,
  random: () => number = Math.random,
): number {
  const failures = Math.max(0, Math.floor(consecutiveFailures));
  if (failures === 0) return RELAYER_POLL_BASE_MS;

  // Cap the exponent so 2 ** failures can never overflow to Infinity.
  const exp = Math.min(failures, 16);
  const backoff = Math.min(RELAYER_POLL_BASE_MS * 2 ** exp, RELAYER_POLL_MAX_MS);
  const jitter = 1 + (random() * 2 - 1) * RELAYER_POLL_JITTER;
  return Math.round(Math.min(backoff * jitter, RELAYER_POLL_MAX_MS * (1 + RELAYER_POLL_JITTER)));
}
