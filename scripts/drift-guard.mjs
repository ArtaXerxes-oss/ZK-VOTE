#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendConfigPath = path.resolve(__dirname, "../frontend/src/config/contracts.ts");
const frontendRoot = path.resolve(__dirname, "../frontend");

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "dist", "build", ".cache"].includes(entry.name)) continue;
      walk(path.join(dir, entry.name), exts, out);
    } else if (exts.includes(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function findLegacyRefs() {
  const files = walk(frontendRoot, [".ts", ".tsx"]);
  const hits = [];
  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    if (content.includes("initializeContractClients")) {
      hits.push(file);
    }
  }
  return hits;
}

function parseContracts() {
  const content = fs.readFileSync(frontendConfigPath, "utf-8");
  const contracts = {};
  const regex = /(\w+_ID):\s*"(C[A-Z2-7]{55})"/g;
  let m;
  while ((m = regex.exec(content)) !== null) {
    contracts[m[1]] = m[2];
  }
  return contracts;
}
function validate(addr) {
  return /^C[A-Z2-7]{55}$/.test(addr);
}

const contracts = parseContracts();
console.log(`🔍 Drift guard: checking ${Object.keys(contracts).length} contract IDs...`);
let mismatches = [];

for (const [k, v] of Object.entries(contracts)) {
  if (!validate(v)) {
    console.error(`❌ Invalid address for ${k}: ${v}`);
    mismatches.push(k);
  }
}

try {
  const legacyRefs = findLegacyRefs();
  if (legacyRefs.length) {
    console.error("❌ Legacy initializer still present:\n" + legacyRefs.join("\n"));
    mismatches.push("legacy_initializer");
  } else {
    console.log("✓ No legacy initializer found");
  }
} catch {}

const legacyPath = path.resolve(__dirname, "../frontend/src/lib/contracts.ts");
if (fs.existsSync(legacyPath)) {
  console.error("❌ Legacy file still exists: frontend/src/lib/contracts.ts");
  mismatches.push("legacy_file");
} else {
  console.log("✓ Legacy file correctly deleted");
}

const clientPath = path.resolve(__dirname, "../frontend/src/lib/client.ts");
if (!fs.existsSync(clientPath)) {
  console.error("❌ Unified client missing");
  mismatches.push("client");
} else {
  console.log("✓ Unified client present");
}

const queuePath = path.resolve(__dirname, "../frontend/src/lib/offlineQueue.ts");
if (!fs.existsSync(queuePath)) {
  console.error("❌ Offline queue missing");
  mismatches.push("queue");
} else {
  console.log("✓ Offline queue present");
}

// ── Issue #556: URL config drift gate ──────────────────────────────────────
// Verify that the single-source env.ts exists and that no other .ts/.tsx file
// under frontend/src hard-codes one of the three service URLs directly.
console.log("🔍 Drift guard: checking URL config drift (issue #556)...");

const envConfigPath = path.resolve(__dirname, "../frontend/src/config/env.ts");
if (!fs.existsSync(envConfigPath)) {
  console.error("❌ frontend/src/config/env.ts (single URL config source) is missing");
  mismatches.push("url_config_source");
} else {
  console.log("✓ frontend/src/config/env.ts present");
}

// Patterns that indicate a hardcoded URL that should come from env.ts instead.
const hardcodedUrlPatterns = [
  /VITE_RELAYER_URL\s*\|\|\s*["']http:\/\/localhost:3001["']/,
  /const RELAYER_URL\s*=\s*import\.meta\.env\.VITE_RELAYER_URL/,
  /rpcUrl\s*:\s*["']https:\/\/soroban-testnet\.stellar\.org["']/,
  /["']https:\/\/horizon-testnet\.stellar\.org["']/,
];

const urlDriftFiles = [];
const frontendSrcFiles = walk(path.resolve(__dirname, "../frontend/src"), [".ts", ".tsx"]);
for (const file of frontendSrcFiles) {
  // Skip the canonical source itself
  if (file === envConfigPath) continue;
  const content = fs.readFileSync(file, "utf-8");
  for (const pat of hardcodedUrlPatterns) {
    if (pat.test(content)) {
      urlDriftFiles.push(path.relative(path.resolve(__dirname, ".."), file));
      break;
    }
  }
}

if (urlDriftFiles.length) {
  console.error("❌ Hardcoded service URLs found outside config/env.ts:");
  urlDriftFiles.forEach(f => console.error(`   ${f}`));
  mismatches.push("hardcoded_urls");
} else {
  console.log("✓ No hardcoded service URLs outside config/env.ts");
}
// ──────────────────────────────────────────────────────────────────────────

if (mismatches.length) {
  console.error(`\n❌ Drift guard FAILED: ${mismatches.join(", ")}`);
  process.exit(1);
} else {
  console.log("\n✅ Drift guard PASSED — no drift");
  process.exit(0);
}

// Check NUM_PUBLIC_SIGNALS mismatch (IDL source-of-truth drift)
try {
  const votingLib = fs.readFileSync(path.resolve(__dirname, "../contracts/voting/src/lib.rs"), "utf-8");
  const frontendTypes = fs.readFileSync(path.resolve(__dirname, "../frontend/src/types/index.ts"), "utf-8");
  
  const rustMatch = votingLib.match(/NUM_PUBLIC_SIGNALS:\s*u32\s*=\s*(\d+)/);
  const tsMatch = frontendTypes.match(/NUM_PUBLIC_SIGNALS\s*=\s*(\d+)/);
  
  if (rustMatch && tsMatch) {
    if (rustMatch[1] !== tsMatch[1]) {
      console.error(`❌ Drift guard FAILED: NUM_PUBLIC_SIGNALS mismatch! Rust: ${rustMatch[1]}, TS: ${tsMatch[1]}`);
      process.exit(1);
    }
  }
} catch (e) {
  console.error("Failed to check NUM_PUBLIC_SIGNALS drift", e);
}
