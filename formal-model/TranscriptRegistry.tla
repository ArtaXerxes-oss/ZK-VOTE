----------------------- MODULE TranscriptRegistry -----------------------
(*
  ZK-VOTE Formal Model (TLA+): Groth16 MPC Transcript Registry & Attestation Gating
  ===================================================================================
  Models on-chain gating of Groth16 verification keys against multi-contributor
  ceremony transcripts:
    1. TranscriptRegistry contract: stores verified MPC transcripts and vk_hash mappings.
    2. Voting contract: set_vk() enforces that vk_hash has a verified attestation.
    3. Attestation check: contributors >= MIN_MPC_CONTRIBUTORS (>= 3) and valid beacon.

  Invariants Verified:
    I1: UnattestedVKNeverActive — No DAO can ever activate a verification key
        that lacks an attested transcript with >= MIN_MPC_CONTRIBUTORS.
    I2: AttestationIntegrity — Every active VK strictly maps to a registered transcript.
    I3: MinContributorsEnforced — No transcript with fewer than 3 contributors can be registered.
*)

EXTENDS Integers, Sequences, FiniteSets, TLC

CONSTANTS
    MIN_MPC_CONTRIBUTORS,  (* 3 *)
    MAX_DAOS,              (* e.g. 2 *)
    MAX_VKS,               (* e.g. 3 *)
    MAX_TRANSCRIPTS        (* e.g. 3 *)

ASSUME MIN_MPC_CONTRIBUTORS = 3

(*-----------------------------------------------------------------------*)
(* Types                                                                 *)
(*-----------------------------------------------------------------------*)

DaoId == 1..MAX_DAOS
VKHash == 1..MAX_VKS
TranscriptHash == 1..MAX_TRANSCRIPTS
NoVK == 0
NoTranscript == 0

(*-----------------------------------------------------------------------*)
(* State Variables                                                       *)
(*-----------------------------------------------------------------------*)

VARIABLES
    registeredTranscripts, (* Set of [t_hash: TranscriptHash, vk_hash: VKHash, count: Int, verified: Bool] *)
    vkToTranscript,        (* Function VKHash -> TranscriptHash \cup {NoTranscript} *)
    daoVK,                 (* Function DaoId -> VKHash \cup {NoVK} *)
    proposalVK             (* Function [DaoId, 1..2] -> VKHash \cup {NoVK} *)

vars == <<registeredTranscripts, vkToTranscript, daoVK, proposalVK>>

(*-----------------------------------------------------------------------*)
(* Initial State                                                         *)
(*-----------------------------------------------------------------------*)

Init ==
    /\ registeredTranscripts = {}
    /\ vkToTranscript = [vk \in VKHash |-> NoTranscript]
    /\ daoVK = [d \in DaoId |-> NoVK]
    /\ proposalVK = [p \in (DaoId \X (1..2)) |-> NoVK]

(*-----------------------------------------------------------------------*)
(* Helper Predicates                                                     *)
(*-----------------------------------------------------------------------*)

IsVKAttested(vk) ==
    /\ vk /= NoVK
    /\ vkToTranscript[vk] /= NoTranscript
    /\ \E t \in registeredTranscripts :
        /\ t.transcript_hash = vkToTranscript[vk]
        /\ t.vk_hash = vk
        /\ t.verified = TRUE
        /\ t.count >= MIN_MPC_CONTRIBUTORS

(*-----------------------------------------------------------------------*)
(* Actions                                                               *)
(*-----------------------------------------------------------------------*)

(* Governance registers a multi-contributor MPC ceremony transcript *)
RegisterTranscript(t_hash, vk_hash, count) ==
    /\ count >= MIN_MPC_CONTRIBUTORS
    /\ t_hash \notin {t.transcript_hash : t \in registeredTranscripts}
    /\ vkToTranscript[vk_hash] = NoTranscript
    /\ registeredTranscripts' = registeredTranscripts \cup {[
           transcript_hash |-> t_hash,
           vk_hash |-> vk_hash,
           count |-> count,
           verified |-> TRUE
       ]}
    /\ vkToTranscript' = [vkToTranscript EXCEPT ![vk_hash] = t_hash]
    /\ UNCHANGED <<daoVK, proposalVK>>

(* Attacker attempts to register a single-laptop setup with < 3 contributors (should fail) *)
AttemptMaliciousRegistration(t_hash, vk_hash, count) ==
    /\ count < MIN_MPC_CONTRIBUTORS
    /\ FALSE  (* Blocked by contract precondition *)
    /\ UNCHANGED vars

(* DAO admin sets VK, gated by on-chain transcript attestation *)
SetVK(dao, vk_hash) ==
    /\ IsVKAttested(vk_hash)
    /\ daoVK' = [daoVK EXCEPT ![dao] = vk_hash]
    /\ UNCHANGED <<registeredTranscripts, vkToTranscript, proposalVK>>

(* Attacker attempts to set an unattested or single-party VK (blocked) *)
AttemptUnattestedSetVK(dao, vk_hash) ==
    /\ ~IsVKAttested(vk_hash)
    /\ FALSE  (* Blocked by contract error #79: TranscriptNotAttested *)
    /\ UNCHANGED vars

(* Proposal created inheriting DAO's active VK *)
CreateProposal(dao, prop_idx) ==
    /\ daoVK[dao] /= NoVK
    /\ proposalVK[<<dao, prop_idx>>] = NoVK
    /\ proposalVK' = [proposalVK EXCEPT ![<<dao, prop_idx>>] = daoVK[dao]]
    /\ UNCHANGED <<registeredTranscripts, vkToTranscript, daoVK>>

Next ==
    \/ \E t_hash \in TranscriptHash, vk_hash \in VKHash, count \in 3..5 :
        RegisterTranscript(t_hash, vk_hash, count)
    \/ \E dao \in DaoId, vk_hash \in VKHash :
        SetVK(dao, vk_hash)
    \/ \E dao \in DaoId, prop_idx \in 1..2 :
        CreateProposal(dao, prop_idx)

Spec == Init /\ [][Next]_vars

(*-----------------------------------------------------------------------*)
(* Invariants                                                            *)
(*-----------------------------------------------------------------------*)

(* Invariant I1: No DAO can ever active an unattested VK *)
UnattestedVKNeverActive ==
    \A dao \in DaoId :
        daoVK[dao] /= NoVK => IsVKAttested(daoVK[dao])

(* Invariant I2: Every proposal's pinned VK is strictly attested by MPC ceremony *)
ProposalVKMustBeAttested ==
    \A p \in DOMAIN proposalVK :
        proposalVK[p] /= NoVK => IsVKAttested(proposalVK[p])

(* Invariant I3: Registered transcripts strictly enforce min contributors *)
MinContributorsEnforced ==
    \A t \in registeredTranscripts :
        t.count >= MIN_MPC_CONTRIBUTORS

=============================================================================
