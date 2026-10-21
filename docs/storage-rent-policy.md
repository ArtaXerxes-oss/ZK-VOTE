# Storage Rent Policy

> SPIKE-052 / issue #732 — Soroban storage rent economics: DAO-state exhaustion DoS

## Background

Every DAO spreads state across multiple contracts (registry entries, SBT
balances, Merkle tree nodes to depth 18, proposals, votes/nullifiers, comments,
transcripts, rewards cursors). Soroban bills rent per persistent/temporary
storage entry at ledger close. Without per-DAO footprint accounting, an
attacker can:

- Create many DAOs permissionlessly (cheap).
- Mint SBTs to sybil addresses (growing tree toward 262k leaves).
- Open max-length proposals and post comments (each cheap individually).

This externalizes rent costs to the network while the victim (DAO admin, protocol
treasury, or future voters paying TTL extensions) is undefined.

## Cost Attribution (v1)

| Action | Payer | Notes |
|--------|-------|-------|
| DAO creation | Creator | `require_auth` gates creation to the caller |
| SBT mint | DAO admin or joiner | Per-member, bounded by `MAX_MEMBERS_PER_DAO` |
| Proposal creation | Proposer | Bounded by `MAX_PROPOSALS_PER_DAO` |
| Comment creation | Commenter | Bounded by `MAX_COMMENTS_PER_PROPOSAL` |
| Tree node insertion | Membership-tree contract caller | Growth bounded by depth and member cap |
| TTL extension | Backend relayer | Funded by protocol treasury; budgeted per DAO |

## Per-DAO Footprint Caps (implemented in `dao-registry`)

Constants defined in `contracts/dao-registry/src/lib.rs`:

| Constant | Default | Description |
|----------|---------|-------------|
| `MAX_PROPOSALS_PER_DAO` | 1,000 | Concurrent open proposals |
| `MAX_MEMBERS_PER_DAO` | 100,000 | SBT holders / tree leaves (tree hard cap: 262,144) |
| `MAX_COMMENTS_PER_PROPOSAL` | 500 | Comments per proposal |

These are protocol-level defaults. A future `set_dao_quota` governance action
can raise them for a specific DAO (only the DAO admin may call it).

## Reverse-Griefing Mitigation

A footprint cap can be weaponized: an attacker spams a victim DAO to its quota
and freezes legitimate growth. Mitigations:

1. Default caps are set high enough to not affect real DAOs (100k members,
   1k proposals).
2. Only the DAO admin may raise per-DAO caps — an attacker cannot lower them.
3. Per-actor rate limits (future work) can cap the rate of growth rather than
   the absolute size.

## TTL Funding for Long Elections

The backend relayer pays submission fees but not storage rent. For multi-month
elections, the voting contract bumps TTL on each touch
(`bump_persistent` at `voting/src/lib.rs:1188`). This mitigates expiry for
active elections but not for idle state.

**Recommended**: a protocol treasury top-up mechanism for high-value DAOs with
elections longer than 30 days. Deferred to a follow-up spike.

## Storage Rent Cost Table (measured on futurenet, Protocol 25)

> NOTE: This table is a placeholder. Accurate measurements require running
> `soroban contract invoke --cost` on futurenet against each entry type.
> The spike tasked with this work (SPIKE-052) must fill this table with
> measured values before the per-DAO caps are finalized.

| Entry type | Contract | Estimated size | Estimated rent/ledger |
|------------|----------|----------------|-----------------------|
| `DaoInfo` | dao-registry | ~200 bytes | TBD |
| `NameReservation` | dao-registry | ~80 bytes | TBD |
| Tree node (depth 18) | membership-tree | ~64 bytes | TBD |
| `ProposalState` | voting | ~512 bytes | TBD |
| Nullifier | voting | ~32 bytes | TBD |
| Comment | comments | ~256 bytes | TBD |
| Transcript entry | transcript-registry | ~128 bytes | TBD |

## References

- `contracts/dao-registry/src/lib.rs` — `MAX_PROPOSALS_PER_DAO`, `MAX_MEMBERS_PER_DAO`
- `docs/token-storage-ttl-strategy.md` — token TTL strategy (model for other contracts)
- `contracts/voting/src/lib.rs` — `bump_persistent` TTL extension on touch
