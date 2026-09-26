/**
 * Regression coverage for #573's cardinality claim.
 *
 * #573 claims unbounded `daoId` label cardinality on the HTTP metrics.
 * Reading src/services/metrics.ts shows this is already handled:
 * normalizeRoute() collapses `/dao/<anything>` (and several other
 * high-cardinality path segments) down to a fixed `/dao/:param` label
 * before it ever reaches a Prometheus label. This pins that behavior down
 * so a future edit to the regex can't silently reopen the cardinality hole.
 *
 * Runs under the backend's node:test runner (tsx), matching
 * tests/logger.test.ts's style.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeRoute } from "../src/services/metrics.js";

describe("normalizeRoute (#573 cardinality)", () => {
  it("collapses a dao id to a bounded placeholder instead of the raw id", () => {
    assert.equal(normalizeRoute("/dao/9f3a7c21-aaaa-bbbb"), "/dao/:param");
    assert.equal(normalizeRoute("/dao/1"), "/dao/:param");
    assert.equal(normalizeRoute("/dao/999999999999"), "/dao/:param");
  });

  it("collapses long hex hashes to a bounded placeholder", () => {
    assert.equal(normalizeRoute("/tx/" + "a".repeat(40)), "/tx/:hash");
  });

  it("leaves small, already-bounded routes untouched", () => {
    assert.equal(normalizeRoute("/health"), "/health");
  });
});
