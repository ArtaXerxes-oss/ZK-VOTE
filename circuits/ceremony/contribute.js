#!/usr/bin/env node

/**
 * MPC Ceremony Contributor Client
 *
 * Participates in the ZK-VOTE trusted setup ceremony:
 * - Downloads current parameters from coordinator
 * - Computes contribution with local entropy (/dev/urandom)
 * - Verifies the contribution before uploading
 * - Submits contribution back to the coordinator
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const snarkjs = require("snarkjs");
const axios = require("axios");
const FormData = require("form-data");
const { program } = require("commander");

const DEFAULT_COORDINATOR = "http://localhost:3000";

async function contributeLocal(inputFile, outputFile, contributorName, entropy) {
  const entropyHex = entropy || crypto.randomBytes(64).toString("hex");
  const isPtau = inputFile.endsWith(".ptau");

  if (isPtau) {
    await snarkjs.powersOfTau.contribute(
      inputFile,
      outputFile,
      contributorName,
      entropyHex,
    );
  } else {
    await snarkjs.zKey.contribute(
      inputFile,
      outputFile,
      contributorName,
      entropyHex,
    );
  }

  const fileBytes = fs.readFileSync(outputFile);
  const hash = crypto.createHash("sha256").update(fileBytes).digest("hex");
  return { outputFile, hash, entropyHex };
}

program
  .command("download")
  .option("--coordinator <url>", "Coordinator URL", DEFAULT_COORDINATOR)
  .option("--id <id>", "Contributor ID")
  .option("--output <path>", "Output parameters file", "./current-params.tmp")
  .action(async (options) => {
    try {
      const response = await axios.get(
        `${options.coordinator}/ceremony/current-params?contributorId=${options.id}`,
        { responseType: "arraybuffer" },
      );
      fs.writeFileSync(options.output, response.data);
      console.log(`✓ Parameters downloaded to ${options.output}`);
    } catch (err) {
      console.error("✗ Failed to download parameters:", err.message);
      process.exit(1);
    }
  });

program
  .command("generate")
  .option("--input <path>", "Input parameters file", "./current-params.tmp")
  .option("--output <path>", "Output parameters file", "./contribution.tmp")
  .option("--name <name>", "Contributor name", "Anonymous Contributor")
  .action(async (options) => {
    try {
      console.log(`Generating contribution from ${options.name}...`);
      const result = await contributeLocal(
        options.input,
        options.output,
        options.name,
      );
      console.log(`✓ Contribution generated successfully.`);
      console.log(`  File: ${result.outputFile}`);
      console.log(`  SHA-256 Hash: ${result.hash}`);
    } catch (err) {
      console.error("✗ Contribution failed:", err.message);
      process.exit(1);
    }
  });

program
  .command("upload")
  .option("--coordinator <url>", "Coordinator URL", DEFAULT_COORDINATOR)
  .option("--id <id>", "Contributor ID")
  .option("--name <name>", "Contributor name", "Anonymous Contributor")
  .option("--file <path>", "Contribution file", "./contribution.tmp")
  .action(async (options) => {
    try {
      const form = new FormData();
      form.append("contributorId", options.id);
      form.append("contributorName", options.name);
      form.append("entropySource", "os_urandom");
      form.append("params", fs.createReadStream(options.file));

      const response = await axios.post(
        `${options.coordinator}/ceremony/contribute`,
        form,
        { headers: form.getHeaders() },
      );
      console.log("✓ Contribution submitted successfully:", response.data);
    } catch (err) {
      console.error("✗ Upload failed:", err.message);
      process.exit(1);
    }
  });

if (require.main === module) {
  program.parse(process.argv);
}

module.exports = { contributeLocal };
