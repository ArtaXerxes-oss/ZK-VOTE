/**
 * parseVerifyOutput: parses the nova-aggregator CLI's --verify output (#566).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseVerifyOutput } from "../src/services/nova-aggregator.js";

test("parseVerifyOutput reads verified=true", () => {
  assert.equal(parseVerifyOutput('{"verified":true}'), true);
});

test("parseVerifyOutput reads verified=false after CLI log lines", () => {
  assert.equal(parseVerifyOutput('Compiling nova-aggregator\n{"verified":false}\n'), false);
});

test("parseVerifyOutput throws when no result is printed", () => {
  assert.throws(() => parseVerifyOutput("panic: something broke"), /no verification result/);
});
