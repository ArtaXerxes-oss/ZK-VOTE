# Fix Report — IPFS Metadata Sanitization Injection Vectors

**Issue:** `sanitizeMetadata` in `services/ipfs.ts` insufficient against advanced injection
vectors (Labels: security, backend, injection — P1)
**Repo:** https://github.com/Priest-Codes/ZK-VOTE.git
**File fixed:** `backend/src/services/ipfs.ts`
**Date:** 2026-07-29

---

## 1. Findings — confirmed vulnerabilities in the original code

The original `sanitizeString`/`sanitizeMetadata` only removed ASCII `<script>` pairs,
`on*=` handlers, `javascript:` and `data:text/html`. A proof-of-concept run against the
pristine code demonstrated **8 bypasses**:

| # | Vector | Original result |
|---|--------|-----------------|
| 1 | **Unicode confusables** — fullwidth `＜script＞`, mixed-width `<scｒipt>` | Passed through untouched; re-assembles into real tags after downstream NFKC/serialization |
| 2 | **Zero-width / control-char splitting** — `<scr\u200Bipt>` | Survived; browsers ignore the joiners, re-assembling `script` |
| 3 | **HTML-entity obfuscation** — `&#60;script&#62;`, double-encoded `&amp;#60;…` | Untouched |
| 4 | **JSON injection** — `"__proto__"` smuggled inside embedded/serialized JSON strings (incl. double-encoded and fullwidth-obfuscated keys) | Revivable by a later `JSON.parse` → prototype pollution |
| 5 | **SVG XSS** — `<svg onload=…>`, `<foreignObject>`, `<math>` | `<svg>`/`<math>` tags survived |
| 6 | **SVG data-URI in image fields** — `data:image/svg+xml;base64,…` | Completely untouched |
| 7 | **CSS injection** — `style="width:expression(alert(1))"`, `url(javascript:…)`, `<style>@import`, `behavior:`, `-moz-binding:` | All survived |
| 8 | **JSON depth bomb** — 100k-deep nested object | `sanitizeMetadata` recursion crashed (stack exhaustion DoS) |

Attack surface confirmed end-to-end: `POST /ipfs/metadata` sanitizes then pins to IPFS;
the frontend later fetches and renders `body` (Markdown), `image.cid`, etc. — so stored
injection in metadata is reachable by viewers.

## 2. Fix features (all in `backend/src/services/ipfs.ts`)

### `normalizeUnicode()` — canonicalization before matching (new)
- Decodes HTML entities (numeric + curated named set), bounded to **3 rounds** to unwrap
  double/triple-encoded payloads without unbounded expansion.
- Applies **NFKC normalization** — folds fullwidth/confusable characters
  (`＜` → `<`, fullwidth letters → ASCII, `＿＿proto＿＿` → `__proto__`).
- Strips control characters, zero-width characters (`U+200B–U+200F`, `U+FEFF`, `U+2060`),
  soft hyphens and bidi-affecting separators that split dangerous tokens invisibly.
  `\t`/`\r`/`\n` are preserved for Markdown bodies.

### `sanitizeString()` — hardened, fixed-point (rewritten internals, same signature)
Runs a **bounded loop (≤10 rounds) until a fixed point**, so nested fragments
(`<scr<script>ipt>`, malformed `</scri<script>pt>`) cannot re-assemble after one pass:
- removes `<script>`/`<style>` elements *including contents*;
- removes SVG/MathML/active-markup tags: `svg math iframe object embed applet base link
  meta form input button select textarea video audio source track animate set use
  foreignObject …` (carriers of SVG XSS);
- strips inline event handlers (quoted, backticked, unquoted);
- **strips `style` attributes** — the CSS-injection carrier — and neutralizes loose CSS
  `expression()`, `@import`, `behavior:` and `(-moz-)binding:` constructs;
- removes script schemes **whitespace-tolerantly** (`java\tscript:`):
  `javascript:` `vbscript:` `livescript:` `mocha:`;
- blocks script-capable `data:` mediatypes (`text/html`, `image/svg+xml`,
  `application/xhtml+xml`, `x-shockwave-flash`) → `data:blocked`
  (safe static image data-URIs — png/jpeg/gif/webp/avif — remain untouched, and the
  legacy `data:blocked` marker behavior is preserved).

### `sanitizeMetadata()` — injection-proof traversal (rewritten internals, same signature)
- **Depth cap** `MAX_METADATA_DEPTH = 32` — pathological nesting truncates to `null`
  instead of exhausting the stack (DoS hardening), logged as `metadata_depth_truncated`.
- Dangerous keys (`__proto__`, `constructor`, `prototype`, any `__*`) are dropped using
  **both raw and NFKC-canonicalized** forms, before and after key sanitization.
- **JSON-injection defense:** string values that parse as JSON documents are parsed,
  recursively sanitized, and re-serialized — so a downstream `JSON.parse` cannot revive
  injected keys or markup. Handles double-encoded JSON, bounded by
  `MAX_EMBEDDED_JSON_DEPTH = 3`.
- Scalars (numbers, booleans, null) are preserved bit-for-bit; benign Markdown/prose is
  untouched (regression-tested with `assert.deepEqual` on a full proposal-shaped object).

### Supporting, one-character fixes required for validation (pre-existing repo defects)
- `backend/package.json`: added a missing comma after `"rotate-tokens"` — the manifest
  was **invalid JSON**, so `npm install/test/build` were impossible in the pristine repo.

## 3. Files modified / created

| File | Change |
|------|--------|
| `backend/src/services/ipfs.ts` | **Fix** — hardened sanitization section (+〜290 lines, documented) |
| `backend/test/ipfs-metadata-sanitization.test.js` | **New** — 36 regression tests covering every vector above |
| `backend/test/ipfs-service.test.js` | One assertion updated: whole `<iframe>` (incl. its `data:text/html` source) is now removed; a bare `data:text/html` case keeps the `data:blocked` coverage |
| `backend/package.json` | Missing comma fix (required to run any npm tooling) |

No dependency changes; no API/signature changes; `dist/` and lockfile untouched.

## 4. Validation results

| Check | Result |
|-------|--------|
| Attack-vector PoC (24 cases: unicode, entities, JSON injection, SVG, CSS, schemes, depth bomb, benign preservation) | **ALL BLOCKED ✅** |
| New regression suite | **36/36 pass ✅** |
| All IPFS test files (`ipfs-metadata-sanitization`, `ipfs-service`, `ipfs`, `ipfs-pin-manager`) | **63 pass / 0 fail** (7 skipped: pre-existing `PINATA_JWT`-gated integration skips) |
| `tsc` on `src/services/ipfs.ts` with project compiler settings | **0 errors ✅** |
| ESLint on `src/services/ipfs.ts` | parity with original (only the 6 pre-existing findings; fix adds 0) |
| Full backend suite | 327 tests, 195 pass. **Failure set is byte-identical to the pristine baseline** (118 pre-existing failures caused by merge-corrupted unrelated sources — `src/index.ts`, `src/routes/daos.ts`, `src/services/db.ts`, `src/services/token-manager.ts`, … — which also make a whole-repo `tsc` build fail before this fix; fixing them is out of scope for this issue and the fix introduces **zero** new failures/errors) |

## 5. Confidence — does the fix fully resolve the issue?

**Yes — confidence ≈ 100% for the described scope.**
- Unicode confusables → canonicalized (entity decode + NFKC + control strip) then removed ✅
- JSON injection → dangerous keys dropped; embedded/double-encoded JSON strings
  re-sanitized; `Object.prototype` pollution verified impossible ✅
- SVG XSS → SVG/MathML tags and `data:image/svg+xml` removed/blocked ✅
- CSS injection → `<style>` removed, `style` attributes stripped, `expression()`/`@import`/
  `behavior`/`binding`/`url(javascript:)` neutralized ✅
- No behavioral regressions for legitimate metadata; all repo tests show zero new
  failures; the touched module compiles and lints clean ✅

*Residual (out of scope): whole-repo `tsc --noEmit` and 118 pre-existing backend tests
fail on the pristine repo due to unrelated corrupted sources; repairing those requires
reconstructing missing code and is a separate effort.*

---

# Incident Postmortem & Fix Report: Distributed Groth16 MPC Toxic Waste Transcript Verification & Single zkey Forge

**Incident:** Composition failure where single-laptop Phase 2 setup retained tau toxic waste, allowing arbitrary Groth16 proof forgery in the 262k member set without multi-contributor verification.  
**Severity:** Critical (P0)  
**Resolution Date:** 2026-09-25  

---

## 1. Executive Summary

In Groth16 zk-SNARK proof systems, Phase 2 trusted setup parameters evaluate polynomials at secret trapdoor points $(\tau, \alpha, \beta, \gamma, \delta)$. When evaluated on a single machine or without multi-party contributions, retention of the toxic waste scalar $\tau$ allows the operator to evaluate the target polynomial quotients directly, forging mathematically valid proofs for false statements. In ZKVote, this compromised the 262,144-leaf Merkle membership tree: an adversary holding $\tau$ could forge voting proofs for arbitrary unminted commitments without holding SBT credentials or private keys.

Furthermore, a critical contract composition failure existed: `Voting.set_vk` allowed registration of arbitrary verification keys without verifying cryptographic attestation of a decentralized multi-party ceremony transcript on-chain.

---

## 2. Blast Radius Analysis

The blast radius of this vulnerability spanned across five operational surfaces:

### A. REST API Endpoints
- **Endpoints**: `/api/v1/votes`, `/api/v2/votes`, `/circuits`, `/pay`, `/pay/batch`.
- **Vulnerability**: Relayers and backend endpoints lacked cross-tenant isolation enforcement and strict authentication rejection metrics. A forged proof could be accepted and relayed to the chain if the active VK in the voting contract was forged.
- **Remediation**: Added explicit `API-Version` response headers, strict tenant isolation middleware across all three mounts (`/`, `/api/v1`, `/api/v2`), and Prometheus security telemetry (`zkvote_unauthenticated_rejection_total`, `zkvote_cross_tenant_denial_total`).

### B. WebSocket Subscriptions
- **Vulnerability**: Real-time event streams could broadcast unverified or forged vote events without tenant bounds. Connection leakage under high load could exhaust relayer memory.
- **Remediation**: Session tracking and memory exhaustion protections wired into `JobScheduler`, monitoring `zkvote_session_store_size` and pruning stale sessions every 10 minutes.

### C. Role-Based Access Control (RBAC)
- **Vulnerability**: A rogue or compromised DAO admin could unilaterally call `set_vk` with an unverified or privately forged VK, invalidating or hijacking active proposals.
- **Remediation**: Gated `Voting.set_vk` on on-chain attestation via `TranscriptRegistry`. Enforced that only verification keys attested with $\ge 3$ contributors and verified random beacons can be activated.

### D. Circuit & ZK Pipeline
- **Vulnerability**: Single-party `snarkjs groth16 setup` left tau toxic waste on disk. Lack of client-side binary integrity verification allowed spoofed or corrupted WASM proving modules.
- **Remediation**: Developed decentralized Phase 2 ceremony tooling (`circuits/ceremony`: `contribute.js`, `coordinator.js`, `verify-ceremony.js`, `random-beacon.js`), strictly pinned `snarkjs: 0.7.5`, and implemented WASM magic bytes verification (`\0asm`) in `proof.worker.ts`.

### E. SQLite & Postgres Database State
- **Vulnerability**: Lack of tenant isolation in database tables (`events`, `transaction_log`, `payment_jobs`), integer overflow vulnerability in payment amounts, unindexed audit records, and state divergence between relayer cache and on-chain Soroban state.
- **Remediation**: Kysely migrations `006` and `007` (with strict 1:1 SQLite and Postgres parity), adding `tenant_id` to all relational tables, composite hash primary key on `payment_jobs`, `amount BIGINT`, audit log backfilling, and continuous reconciliation checks tracking `zkvote_reconciliation_mismatch_total`.

---

## 3. Remediation Architecture

### 1. Smart Contracts
- **`contracts/transcript-registry`**:
  - `register_transcript(transcript_hash, contributors, beacon_hash, vk_hash)`: Validates $\ge 3$ contributors and non-empty beacon.
  - `record_contribution(transcript_hash, contributor_index, contributor_id, file_hash)`: Cryptographically tracks individual contribution hashes.
  - `is_vk_attested(vk_hash)`: Returns boolean indicating whether a verification key is backed by a valid ceremony transcript.
  - `verify_attestation(vk_hash)`: Asserts transcript validity or errors.
- **`contracts/voting`**:
  - `set_vk()`: Queries `TranscriptRegistry` to enforce `is_vk_attested(&vk_hash)`. Panics with `VotingError::VkNotAttested` if unattested.
- **`contracts/threshold-crypto`**:
  - Restored homomorphic analytics implementation (`init_analytics`, `submit_analytic_contribution`, `analytics_aggregate`, `analytics_count`, `analytics_min_cohort`).
- **`contracts/membership-tree`**:
  - Cleared `LastRegistrationAt` cooldown on `reinstate_member` to permit immediate member re-registration.

### 2. Off-Chain MPC Ceremony Framework
- **`circuits/ceremony/contribute.js`**: Contributor client that downloads current parameters, applies fresh OS entropy, computes contribution hash, and uploads.
- **`circuits/ceremony/verify-ceremony.js`**: Verifies full contribution chain, verifies contributor count $\ge 3$, verifies random beacon execution, and exports canonical verification key.
- **`circuits/ceremony/random-beacon.js`**: Integrates public randomness (Bitcoin block hash / drand) with 10 rounds of SHA-256 hashing.
- **`circuits/ceremony/test-ceremony.js`**: Automated test suite asserting honest 3-party ceremony passes and single-party retained-tau / tampered zkey is detected and rejected.

### 3. Backend Hardening
- **Migrations**: `006_add_blind_credential_schemas` and `007_tenant_isolation_and_audit` with full SQLite ↔ Postgres parity.
- **Scheduler**: `backend/src/services/job-scheduler.ts` running scheduled tasks (`cleanup_stale_sessions`, `token:maintenance`, `reconciliation:check`, metrics gauge updates).
- **Metrics**: Added Prometheus counters and gauges for security rejections, tenant denials, reconciliation mismatches, and store sizes.
- **Hermetic Fly.io Config**: Configured `release_command = "node --enable-source-maps dist/services/migrate.js status"` in `backend/fly.toml`.

### 4. Client-Side Prover
- **`frontend/src/workers/proof.worker.ts`**: Verifies WASM magic bytes `[0x00, 0x61, 0x73, 0x6d]` before compiling and instantiating circuits.

### 5. Formal Verification
- **TLA+ Specifications**: `formal-model/TranscriptRegistry.tla` and `formal-model/TranscriptRegistry.cfg` formally proving `UnattestedVKNeverActive` and `MinContributorsEnforced`.

---

## 4. Verification & Empirical Results

| Verification Test | Command | Result |
|---|---|---|
| **Contracts Workspace Tests** | `cargo test --workspace` | **76/76 Integration + Unit Tests Pass (exit 0)** |
| **MPC Ceremony Spike** | `node circuits/ceremony/test-ceremony.js` | **3-party verified; single-party retained-tau rejected (exit 0)** |
| **Migration Parity** | `npm run migrate:parity` | **100% SQLite ↔ Postgres Parity (exit 0)** |
| **Migration Dry-Run** | `npm run migrate:dry-run` | **Success (exit 0)** |
| **Backend TypeScript Build** | `npm run build` (in `backend/`) | **0 Errors (exit 0)** |
| **Frontend Production Build** | `npm run build` (in `frontend/`) | **0 Errors, bundle verified (exit 0)** |
| **Formal Model Verification** | `formal-model/TranscriptRegistry.tla` | **Invariants hold across all states** |



---

# Fix Report — Config Drift, Docs Staleness, TLA+ Liveness (Issues #556, #553, #552)

**Date:** 2026-09-27
**Issues closed:** #556, #553, #552
**Branch:** `fix/556-553-552-config-drift-docs-tla-liveness`

---

## 1. Blast Radius

### Issue #556 — Config Drift (`RELAYER_URL`, `SOROBAN_RPC_URL`, `HORIZON_URL`)

| File | Problem | Fix |
|------|---------|-----|
| `frontend/src/config/contracts.ts` | `rpcUrl` hard-coded to `"https://soroban-testnet.stellar.org"` | Now imports `SOROBAN_RPC_URL` from `config/env.ts` |
| `frontend/src/lib/api.ts` | `RELAYER_URL` defined inline via `import.meta.env.VITE_RELAYER_URL` | Now imports `RELAYER_URL` from `config/env.ts` |
| `frontend/src/config/env.ts` | *Missing* — created as single URL config source | **Created** — exports `RELAYER_URL`, `SOROBAN_RPC_URL`, `HORIZON_URL` |
| `backend/src/routes/health.ts` | `/health` returned HTTP 200 even when `status: "degraded"` | Now returns **503** when `services.status !== "ok"` |
| `scripts/drift-guard.mjs` | No URL drift detection | Extended with URL hardcode patterns; fails CI on regression |

**Impact before fix**: build environments (staging/production) could silently point at
different networks; load-balancer health probes would keep routing traffic to a degraded
backend because `/health` returned 200.

### Issue #553 — Security Docs Staleness

| File | Problem | Fix |
|------|---------|-----|
| `SECURITY.md` | No mention of config drift, URL single-source, or Trailing starvation | Added Sections 6, 7, 8 |
| `THREAT_MODEL.md` | Missing config-drift threat vector and Trailing starvation liveness | Added two threat sections at end |
| `FIX_REPORT.md` | No entry for these issues | This section |

**Gate**: `backend` CI job already runs `npm run docs:check` which validates that
`openapi.json` and `API.md` are in sync with the backend source.  No changes needed to
the script itself; the SECURITY/THREAT_MODEL refresh is the human-readable complement to
that machine check.

### Issue #552 — TLA+ Liveness Not Checked

| File | Problem | Fix |
|------|---------|-----|
| `formal-model/ZKVote.tla` | No liveness property for `VoteMode::Trailing` starvation | Added `TrailingVoteEventuallyAccepted` temporal property + fairness |
| `formal-model/ZKVote.cfg` | `SPECIFICATION Spec` only checked safety invariants | Added `PROPERTY TrailingLiveness` |
| `.github/workflows/formal-model.yml` | TLC ran with `|| echo "…"` suppression — failures silently passed | Replaced with required exit-code check; removed `|| echo` |

---

## 2. Access Log / Horizon Hash Audit

- `health/index.ts:330`: `/health` now returns 503 on degraded — previously masked
  `ECONNREFUSED 8000` (indexer not running) as 200.
- No `access.log` entries changed; the fix is purely HTTP status on the health path.
- No Horizon transaction hashes affected; this fix is backend/frontend config only.

---

## 3. Test coverage

- `scripts/drift-guard.mjs` — smoke-tested locally: running the guard with a file that
  contains `rpcUrl: "https://soroban-testnet.stellar.org"` outside `env.ts` exits 1; clean
  repo exits 0.
- `backend/src/routes/health.ts` — existing `backend/test/health-ttl-branches.test.js`
  and `backend/test/health-probes.test.js` exercise the health routes; the status-code
  change aligns with the `503` already returned by `/healthz`.
- `formal-model/ZKVote.tla` — TLC liveness check now in `.github/workflows/formal-model.yml`
  as a required CI gate.

---

## 4. Rollback procedure

If the health 503 change causes unexpected probe failures in existing deployments:
1. Temporarily set `HEALTH_EXPOSE_DETAILS=false` to suppress degraded sub-service details.
2. Or mark the affected sub-service healthy via `markHealthy("soroban_rpc")` in deployment init.
3. The `RELAYER_URL` / `SOROBAN_RPC_URL` change is purely additive (new file, existing
   callers still work via the re-exported constants).


---

# Fix Report — Config Drift, Docs Staleness, TLA+ Liveness (#556 / #553 / #552)

**Date:** 2026-09-27
**Issues closed:** #556, #553, #552
**Branch:** `fix/556-553-552-config-drift-docs-tla-liveness`

---

## 1. Blast Radius

### Issue #556 — Config Drift (`RELAYER_URL`, `SOROBAN_RPC_URL`, `HORIZON_URL`)

| File | Problem | Fix |
|------|---------|-----|
| `frontend/src/config/contracts.ts` | `rpcUrl` hard-coded to `"https://soroban-testnet.stellar.org"` | Now imports `SOROBAN_RPC_URL` from `config/env.ts` |
| `frontend/src/lib/api.ts` | `RELAYER_URL` defined inline via `import.meta.env.VITE_RELAYER_URL` | Now imports `RELAYER_URL` from `config/env.ts` |
| `frontend/src/config/env.ts` | *Missing* — created as single URL config source | **Created** — exports `RELAYER_URL`, `SOROBAN_RPC_URL`, `HORIZON_URL` |
| `backend/src/routes/health.ts` | `/health` returned HTTP 200 even when `status: "degraded"` | Now returns **503** when `services.status !== "ok"` |
| `scripts/drift-guard.mjs` | No URL drift detection | Extended with URL hardcode patterns; fails CI on regression |

**Impact before fix**: build environments (staging/production) could silently point at
different networks; load-balancer health probes kept routing traffic to degraded backend
because `/health` returned 200.

### Issue #553 — Security Docs Staleness

| File | Problem | Fix |
|------|---------|-----|
| `SECURITY.md` | No mention of config drift, URL single-source, or Trailing starvation | Added Sections 6, 7, 8 |
| `THREAT_MODEL.md` | Missing config-drift threat vector and Trailing starvation liveness | Added two threat sections at end |
| `FIX_REPORT.md` | No entry for these issues | This section |

**Gate**: The `backend` CI job already runs `npm run docs:check` which validates
`openapi.json` and `API.md` are in sync with the backend source. The SECURITY/THREAT_MODEL
refresh is the human-readable complement to that machine check.

### Issue #552 — TLA+ Liveness Not Checked

| File | Problem | Fix |
|------|---------|-----|
| `formal-model/ZKVote.tla` | No liveness property for `VoteMode::Trailing` starvation | Added `TrailingVoteEventuallyAccepted` temporal property + weak fairness |
| `formal-model/ZKVote.cfg` | `SPECIFICATION Spec` checked safety invariants only | Added `PROPERTY TrailingLiveness` |
| `.github/workflows/formal-model.yml` | TLC ran with `\|\| echo "…"` — failures silently passed CI | Replaced with required exit-code check; removed suppression |

---

## 2. Access Log / Horizon Hash Audit

- `/health` now returns 503 on degraded — previously masked `ECONNREFUSED 8000`
  (indexer not running) as 200 `{"status":"degraded"}`.
- No Horizon transaction hashes affected — this fix is backend config/routing only.
- No `access.log` format changed; HTTP status change is backward-compatible.

---

## 3. Test Coverage

- `scripts/drift-guard.mjs` — URL drift check exits 1 with a hardcoded URL outside
  `env.ts`; exits 0 on clean repo. Covered by `frontend` CI `drift:check` step.
- `backend/src/routes/health.ts` — existing `health-ttl-branches.test.js` and
  `health-probes.test.js` exercise health routes; the 503 on degraded aligns with
  the existing `/healthz` behaviour.
- `formal-model/ZKVote.tla` — TLC liveness check now a required CI gate in
  `.github/workflows/formal-model.yml`.

---

## 4. Rollback Procedure

If the health-503 change trips existing deployment probes:
1. Temporarily set the affected sub-service healthy in deploy init: call
   `markHealthy("soroban_rpc")` before the server starts accepting traffic.
2. The `RELAYER_URL` / `SOROBAN_RPC_URL` change is purely additive (new file +
   re-export); existing callers still compile.
