import { describe, expect, it } from "vitest";
import {
  RELAYER_POLL_BASE_MS,
  RELAYER_POLL_JITTER,
  RELAYER_POLL_MAX_MS,
  nextRelayerPollDelay,
} from "./relayerBackoff";

const noJitter = () => 0.5; // (0.5 * 2 - 1) = 0 → jitter factor 1

describe("nextRelayerPollDelay (#569)", () => {
  it("polls at the base interval while the relayer is healthy", () => {
    expect(nextRelayerPollDelay(0)).toBe(RELAYER_POLL_BASE_MS);
    expect(nextRelayerPollDelay(0, () => 0)).toBe(RELAYER_POLL_BASE_MS);
  });

  it("backs off exponentially on consecutive failures", () => {
    expect(nextRelayerPollDelay(1, noJitter)).toBe(2 * RELAYER_POLL_BASE_MS);
    expect(nextRelayerPollDelay(2, noJitter)).toBe(4 * RELAYER_POLL_BASE_MS);
    expect(nextRelayerPollDelay(3, noJitter)).toBe(8 * RELAYER_POLL_BASE_MS);
  });

  it("caps the backoff", () => {
    expect(nextRelayerPollDelay(4, noJitter)).toBe(RELAYER_POLL_MAX_MS);
    expect(nextRelayerPollDelay(50, noJitter)).toBe(RELAYER_POLL_MAX_MS);
    expect(Number.isFinite(nextRelayerPollDelay(10_000, noJitter))).toBe(true);
  });

  it("applies bounded jitter so clients do not poll in lockstep", () => {
    const low = nextRelayerPollDelay(1, () => 0);
    const high = nextRelayerPollDelay(1, () => 0.999999);
    const base = 2 * RELAYER_POLL_BASE_MS;
    expect(low).toBe(Math.round(base * (1 - RELAYER_POLL_JITTER)));
    expect(high).toBeGreaterThan(base);
    expect(high).toBeLessThanOrEqual(Math.round(base * (1 + RELAYER_POLL_JITTER)));
  });

  it("treats negative or fractional counts defensively", () => {
    expect(nextRelayerPollDelay(-3)).toBe(RELAYER_POLL_BASE_MS);
    expect(nextRelayerPollDelay(1.9, noJitter)).toBe(2 * RELAYER_POLL_BASE_MS);
  });

  it("a fleet of failing clients spreads out instead of polling together", () => {
    let seed = 1;
    const lcg = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const delays = new Set(Array.from({ length: 100 }, () => nextRelayerPollDelay(2, lcg)));
    expect(delays.size).toBeGreaterThan(50);
  });
});
