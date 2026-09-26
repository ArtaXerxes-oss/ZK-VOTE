#!/usr/bin/env node

/**
 * End-to-End Test for MPC Ceremony & Toxic Waste Transcript Attestation
 *
 * Verifies:
 * 1. Multi-party contribution with 3 independent contributors
 * 2. Sequential hash chaining: H(c_i) recorded in transcript
 * 3. Random beacon application to destroy residual tau
 * 4. Transcript verification passes for honest 3-party ceremony
 * 5. Single-party fake/retained tau forgery is rejected or yields mismatched hash
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const assert = require("assert");

const {
  verifyCeremony,
  extractParameters,
  computeFileHash,
  computeTranscriptHash,
} = require("./verify-ceremony");

async function runCeremonyTest() {
  console.log("=== Testing Distributed MPC Ceremony Workflow ===");

  const testDir = path.join(__dirname, "test-transcript");
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  try {
    // 1. Simulate 3 independent contributor artifacts with distinct entropy
    const contributors = [
      { num: 1, name: "Alice (Contributor 1)", entropy: crypto.randomBytes(32).toString("hex") },
      { num: 2, name: "Bob (Contributor 2)", entropy: crypto.randomBytes(32).toString("hex") },
      { num: 3, name: "Charlie (Contributor 3)", entropy: crypto.randomBytes(32).toString("hex") },
    ];

    const state = {
      phase: "PHASE2",
      contributionCount: 3,
      contributions: [],
      startTime: Date.now() - 3600000,
    };

    let prevContent = "initial_r1cs_phase1_seed";
    for (const c of contributors) {
      const dummyZkey = Buffer.from(
        `GROTH16_ZKEY_HEADER_CONTRIB_${c.num}_ENTROPY_${c.entropy}_PREV_${crypto.createHash("sha256").update(prevContent).digest("hex")}`
      );
      const filePath = path.join(testDir, `phase2_${c.num}.zkey`);
      fs.writeFileSync(filePath, dummyZkey);

      const fileHash = crypto.createHash("sha256").update(dummyZkey).digest("hex");
      state.contributions.push({
        num: c.num,
        contributor: { id: `id-${c.num}`, name: c.name },
        entropySource: "os_urandom",
        timestamp: Date.now(),
        fileHash,
      });
      prevContent = dummyZkey.toString();
    }

    // 2. Simulate Random Beacon
    const beaconHash = crypto.createHash("sha256").update("BITCOIN_BLOCK_850000_HASH").digest("hex");
    const finalZkey = Buffer.from(`GROTH16_FINAL_ZKEY_BEACON_${beaconHash}_` + prevContent);
    fs.writeFileSync(path.join(testDir, "phase2_final.zkey"), finalZkey);
    state.phase = "COMPLETED";
    state.beaconHash = beaconHash;
    state.finalZkeyHash = crypto.createHash("sha256").update(finalZkey).digest("hex");

    fs.writeFileSync(path.join(testDir, "coordinator-state.json"), JSON.stringify(state, null, 2));

    // 3. Verify the honest 3-contributor ceremony transcript
    console.log("Checking 3-party honest ceremony transcript...");
    const honestResult = await verifyCeremony(testDir);
    assert.strictEqual(honestResult.verified, true);
    assert.strictEqual(honestResult.contributorCount, 3);
    assert(honestResult.transcriptHash.length === 64);
    console.log("✓ Honest 3-contributor transcript verified successfully.");

    // 4. Test Single-Party / Retained-Tau Malicious Attack:
    // Malicious attacker attempts to replace contribution #2 with their own single-laptop zkey
    console.log("\nTesting single-party retained-tau tampering detection...");
    const maliciousTestDir = path.join(__dirname, "malicious-transcript");
    if (fs.existsSync(maliciousTestDir)) {
      fs.rmSync(maliciousTestDir, { recursive: true, force: true });
    }
    fs.mkdirSync(maliciousTestDir, { recursive: true });

    // Copy honest files then tamper with #2
    for (let i = 1; i <= 3; i++) {
      fs.copyFileSync(
        path.join(testDir, `phase2_${i}.zkey`),
        path.join(maliciousTestDir, `phase2_${i}.zkey`)
      );
    }
    fs.writeFileSync(
      path.join(maliciousTestDir, "phase2_2.zkey"),
      Buffer.from("MALICIOUS_RETAINED_TAU_FORGED_PARAMETERS")
    );
    fs.copyFileSync(
      path.join(testDir, "coordinator-state.json"),
      path.join(maliciousTestDir, "coordinator-state.json")
    );

    let caughtTamper = false;
    try {
      await verifyCeremony(maliciousTestDir);
    } catch (err) {
      caughtTamper = true;
      console.log(`✓ Retained-tau / tampered zkey correctly rejected: ${err.message}`);
    }
    assert.strictEqual(caughtTamper, true, "Tampered zkey should have been rejected!");

    // Clean up
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.rmSync(maliciousTestDir, { recursive: true, force: true });

    console.log("\n==============================================");
    console.log("✓ MPC CEREMONY SUITE PASSED ALL VERIFICATIONS");
    console.log("==============================================\n");
  } catch (err) {
    console.error("✗ MPC Ceremony test failed:", err);
    process.exit(1);
  }
}

if (require.main === module) {
  runCeremonyTest();
}

module.exports = { runCeremonyTest };
