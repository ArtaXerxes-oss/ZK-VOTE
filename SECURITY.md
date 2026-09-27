# Security Policy and Cryptographic Architecture

## 1. Vulnerability Reporting
If you discover a security vulnerability within ZKVote, please report it privately to security@zkvote.io or through GitHub Private Vulnerability Reporting. Do NOT open public issues for zero-day vulnerabilities.

---

## 2. Groth16 MPC Phase 2 Ceremony & Toxic Waste Elimination

### The Single-Party Setup Risk
Groth16 zk-SNARKs rely on structured reference strings (SRS) generated during a multi-stage trusted setup. The setup decomposes into:
1. **Phase 1 (Powers of Tau)**: Universal reference string generation independent of specific circuits.
2. **Phase 2 (Circuit-Specific Setup)**: Generation of circuit-specific evaluation keys ($A, B, C$) evaluated at secret points $\tau, \alpha, \beta, \gamma, \delta$.

If a single party evaluates the Phase 2 setup on a single machine ("single-laptop setup"), retention of the secret trapdoors $\tau$ ("toxic waste") allows that party to forge valid Groth16 proofs for arbitrary statements—such as proving membership in a 262,144-leaf Merkle tree without possessing a valid private key or commitment.

### Multi-Party Ceremony Requirement
To eliminate this risk, ZKVote mandates an authenticated multi-party computation (MPC) ceremony for all production circuits:
- **Minimum Contributors**: $\ge 3$ distinct independent contributors (`MIN_MPC_CONTRIBUTORS = 3`).
- **Cryptographic Hash Chain**: Each contributor receives contribution $i-1$, verifies its parameters, injects fresh cryptographically secure entropy, and outputs contribution $i$. The file hash of contribution $i$ is linked to contribution $i-1$.
- **Random Public Beacon**: The final parameters are randomized with an unpredictable public beacon (e.g. Bitcoin block hash or drand randomness beacon) with 10 iterations of repeated SHA-256 hashing.
- **Transcript Registry Verification**: The transcript containing contributor identity, contribution hashes, and beacon parameters is attested and verified on-chain.

---

## 3. On-Chain `TranscriptRegistry` Gating

The `Voting` and `CircuitRegistry` contracts enforce cryptographic ceremony attestation before any verification key (VK) can be activated:

```
[Off-Chain MPC Ceremony]
Alice (c1) -> Bob (c2) -> Charlie (c3) -> Random Beacon -> Final zkey & VK
                                                                │
                                                                ▼
                                                    [Transcript Registry]
                                                    - verify_attestation()
                                                    - contributors >= 3
                                                    - beacon hash validated
                                                                │
                                                                ▼
                                                        is_vk_attested = true
                                                                │
                                                                ▼
                                                        [Voting Contract]
                                                        - set_vk() requires attestation
                                                        - snapshotted per proposal
```

### Verification Invariants
1. **`UnattestedVKNeverActive`**: No VK can be used to initialize or vote on a proposal unless it has been attested in `TranscriptRegistry`.
2. **`MinContributorsEnforced`**: Transcripts with fewer than 3 independent contributors cannot be attested.
3. **`ProposalVKSnapshot`**: When a proposal is created, the VK hash is immutable for that proposal's lifecycle, preventing mid-election substitution.

---

## 4. Web Worker & Client-Side Proof Hardening

- **WASM Magic Header Check**: Prior to instantiation, the proving Web Worker (`proof.worker.ts`) inspects the initial 4 bytes of all compiled WASM artifacts to ensure `0x00, 0x61, 0x73, 0x6d` (`\0asm`). Corrupted or modified payloads fail immediately.
- **BN254 Scalar Field Bounds**: All public signals ($nullifier, root, dao\_id, proposal\_id, vote\_choice$) are verified to reside strictly within the BN254 scalar field $r < 21888242871839275222246405745257275088548364400416034343698204186575808495617$.

---

## 5. Multi-Tenant Relayer Security

- **Strict Tenant Isolation**: All database operations partition data with explicit `tenant_id` scopes (`AuditLog`, `Events`, `TransactionLog`, `PaymentJobs`).
- **Cross-Tenant Guardrails**: Middleware rejects cross-tenant requests and increments `zkvote_cross_tenant_denial_total`.
- **Reconciliation Engine**: Periodic reconciliation compares SQLite relayer cache against on-chain Soroban ledger events. Any divergence increments `zkvote_reconciliation_mismatch_total` and triggers automated alerts.
- **Rate-Limiting & Memory Protection**: In-memory stores are monitored via Prometheus gauges (`zkvote_rate_limit_store_size`, `zkvote_session_store_size`), and stale sessions are pruned by `JobScheduler`.

---

## 6. Config Drift & Service URL Security (Issue #556 / #553)

**Problem:** Three service URLs (`RELAYER_URL`, `SOROBAN_RPC_URL`, `HORIZON_URL`) were
defined in at least two places (hardcoded in `frontend/src/config/contracts.ts` and
inline in `frontend/src/lib/api.ts`), creating a drift vector where a build can silently
point at the wrong network.

**Fix applied:**

- `frontend/src/config/env.ts` is now the **single source of truth** for all three URLs.
  All other files import from there; no other file calls `import.meta.env.VITE_*` for
  these three variables.
- `scripts/drift-guard.mjs` was extended to **fail CI** if a hardcoded URL pattern is
  found outside `config/env.ts`.
- The `/health` endpoint now returns **HTTP 503** (not 200) when any monitored service is
  in `degraded` or `unavailable` state so that load-balancer health probes stop routing
  traffic to a degraded backend instance.

**Drift gate:** The `frontend` CI job runs `npm run drift:check` which invokes
`drift-guard.mjs`; any regression re-introducing a hardcoded URL will fail the PR.

---

## 7. Pinned Dependency Versions (Issue #556 / #553)

All security-critical dependencies are pinned to exact versions in the respective
`package.json` files to prevent supply-chain drift:

| Package | Pinned version | Location |
|---------|---------------|----------|
| `@stellar/stellar-sdk` | `15.1.0` | `backend/package.json` |
| `snarkjs` | `0.7.5` | `circuits/package.json` |
| `prom-client` | `15.1.3` | `backend/package.json` |

The `wasm32v1-none` toolchain target is fixed via `rust-toolchain.toml` at the repo root.

---

## 8. Liveness & Starvation — Formal Model (Issue #552)

`VoteMode::Trailing` proposals accept any root whose index is `≥ earliest_root_idx` and
`≥ minValidRootIdx`. A member removed after the proposal was created can therefore be
evicted from the root history before they cast their vote, starving them of a valid root.

**Model:** `formal-model/ZKVote.tla` now includes a weak-fairness liveness property
`TrailingVoteEventuallyAccepted` which asserts that any member with a valid root
eventually casts a vote (or the proposal closes). TLC is run in CI as a **required** gate
(no `|| true` suppression) against this property.

See `formal-model/ZKVote.tla` and `.github/workflows/formal-model.yml` for details.

---

*Last updated: 2026-09-27 — reflects 391-test suite (cargo test --workspace), config-drift
fix (#556), docs-staleness fix (#553), and TLA+ liveness gate (#552).*
