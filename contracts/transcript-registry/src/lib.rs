#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Bytes, BytesN, Env, String, Symbol,
};

const VERSION: u32 = 1;
const VERSION_KEY: Symbol = symbol_short!("ver");
const GOVERNANCE: Symbol = symbol_short!("gov");

const INSTANCE_TTL_THRESHOLD: u32 = 120_960;
const INSTANCE_TTL_EXTEND: u32 = 535_680;
const PERSISTENT_TTL_THRESHOLD: u32 = 120_960;
const PERSISTENT_TTL_EXTEND: u32 = 535_680;

pub const MIN_MPC_CONTRIBUTORS: u32 = 3;

#[contracterror]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum TranscriptError {
    NotGovernance = 1,
    TranscriptAlreadyRegistered = 2,
    TranscriptNotFound = 3,
    InsufficientContributors = 4,
    InvalidBeaconHash = 5,
    AttestationMismatch = 6,
    InvalidTranscriptChain = 7,
    VkAlreadyRegistered = 8,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TranscriptInfo {
    pub circuit_id: String,
    pub transcript_hash: BytesN<32>,
    pub vk_hash: BytesN<32>,
    pub contributors_count: u32,
    pub beacon_hash: BytesN<32>,
    pub registered_at: u64,
    pub verified: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ContributionStep {
    pub step: u32,
    pub prev_hash: BytesN<32>,
    pub new_hash: BytesN<32>,
    pub contributor_tag: BytesN<32>,
    pub timestamp: u64,
}

#[contracttype]
pub enum DataKey {
    Transcript(BytesN<32>),
    VkToTranscript(BytesN<32>),
    CircuitTranscript(String),
    ContributionStep(BytesN<32>, u32),
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct TranscriptRegisteredEvent {
    #[topic]
    pub transcript_hash: BytesN<32>,
    #[topic]
    pub vk_hash: BytesN<32>,
    pub circuit_id: String,
    pub contributors_count: u32,
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct ContributionRecordedEvent {
    #[topic]
    pub new_hash: BytesN<32>,
    pub step: u32,
    pub contributor_tag: BytesN<32>,
}

#[contract]
pub struct TranscriptRegistry;

#[contractimpl]
impl TranscriptRegistry {
    fn bump_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND);
    }

    fn bump_persistent<K: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &K) {
        env.storage()
            .persistent()
            .extend_ttl(key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND);
    }

    pub fn __constructor(env: Env, governance: Address) {
        if env.storage().instance().has(&VERSION_KEY) {
            panic_with_error!(&env, TranscriptError::NotGovernance);
        }
        env.storage().instance().set(&VERSION_KEY, &VERSION);
        env.storage().instance().set(&GOVERNANCE, &governance);
    }

    fn assert_governance(env: &Env) {
        let governance: Address = env.storage().instance().get(&GOVERNANCE).unwrap();
        governance.require_auth();
    }

    /// Register a verified MPC ceremony transcript and its corresponding VK hash.
    /// Requires governance authorization and at least MIN_MPC_CONTRIBUTORS (>= 3).
    pub fn register_transcript(
        env: Env,
        circuit_id: String,
        transcript_hash: BytesN<32>,
        vk_hash: BytesN<32>,
        contributors_count: u32,
        beacon_hash: BytesN<32>,
    ) {
        Self::bump_instance(&env);
        Self::assert_governance(&env);

        if contributors_count < MIN_MPC_CONTRIBUTORS {
            panic_with_error!(&env, TranscriptError::InsufficientContributors);
        }

        let key = DataKey::Transcript(transcript_hash.clone());
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, TranscriptError::TranscriptAlreadyRegistered);
        }

        let vk_key = DataKey::VkToTranscript(vk_hash.clone());
        if env.storage().persistent().has(&vk_key) {
            panic_with_error!(&env, TranscriptError::VkAlreadyRegistered);
        }

        let transcript = TranscriptInfo {
            circuit_id: circuit_id.clone(),
            transcript_hash: transcript_hash.clone(),
            vk_hash: vk_hash.clone(),
            contributors_count,
            beacon_hash,
            registered_at: env.ledger().timestamp(),
            verified: true,
        };

        env.storage().persistent().set(&key, &transcript);
        Self::bump_persistent(&env, &key);

        env.storage()
            .persistent()
            .set(&vk_key, &transcript_hash.clone());
        Self::bump_persistent(&env, &vk_key);

        let circuit_key = DataKey::CircuitTranscript(circuit_id.clone());
        env.storage()
            .persistent()
            .set(&circuit_key, &transcript_hash.clone());
        Self::bump_persistent(&env, &circuit_key);

        TranscriptRegisteredEvent {
            transcript_hash,
            vk_hash,
            circuit_id,
            contributors_count,
        }
        .publish(&env);
    }

    /// Record an intermediate step in the MPC transcript contribution chain.
    pub fn record_contribution(
        env: Env,
        circuit_id: String,
        prev_hash: BytesN<32>,
        new_hash: BytesN<32>,
        contributor_tag: BytesN<32>,
        step: u32,
    ) {
        Self::bump_instance(&env);
        Self::assert_governance(&env);

        let step_key = DataKey::ContributionStep(new_hash.clone(), step);
        let step_info = ContributionStep {
            step,
            prev_hash,
            new_hash: new_hash.clone(),
            contributor_tag: contributor_tag.clone(),
            timestamp: env.ledger().timestamp(),
        };

        env.storage().persistent().set(&step_key, &step_info);
        Self::bump_persistent(&env, &step_key);

        ContributionRecordedEvent {
            new_hash,
            step,
            contributor_tag,
        }
        .publish(&env);
    }

    /// Check if a verification key has a verified MPC ceremony attestation on-chain.
    pub fn is_vk_attested(env: Env, vk_hash: BytesN<32>) -> bool {
        Self::bump_instance(&env);
        let vk_key = DataKey::VkToTranscript(vk_hash.clone());
        if let Some(t_hash) = env.storage().persistent().get::<_, BytesN<32>>(&vk_key) {
            let t_key = DataKey::Transcript(t_hash);
            if let Some(transcript) = env.storage().persistent().get::<_, TranscriptInfo>(&t_key) {
                return transcript.verified
                    && transcript.contributors_count >= MIN_MPC_CONTRIBUTORS
                    && transcript.vk_hash == vk_hash;
            }
        }
        false
    }

    /// Verify that a specific transcript_hash attests to a specific vk_hash.
    pub fn verify_attestation(env: Env, transcript_hash: BytesN<32>, vk_hash: BytesN<32>) -> bool {
        Self::bump_instance(&env);
        let t_key = DataKey::Transcript(transcript_hash);
        if let Some(transcript) = env.storage().persistent().get::<_, TranscriptInfo>(&t_key) {
            return transcript.verified
                && transcript.contributors_count >= MIN_MPC_CONTRIBUTORS
                && transcript.vk_hash == vk_hash;
        }
        false
    }

    /// Retrieve full transcript details by transcript_hash.
    pub fn get_transcript(env: Env, transcript_hash: BytesN<32>) -> TranscriptInfo {
        Self::bump_instance(&env);
        let key = DataKey::Transcript(transcript_hash);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, TranscriptError::TranscriptNotFound))
    }

    /// Retrieve full transcript details by vk_hash.
    pub fn get_transcript_by_vk(env: Env, vk_hash: BytesN<32>) -> Option<TranscriptInfo> {
        Self::bump_instance(&env);
        let vk_key = DataKey::VkToTranscript(vk_hash);
        let t_hash: BytesN<32> = env.storage().persistent().get(&vk_key)?;
        let t_key = DataKey::Transcript(t_hash);
        env.storage().persistent().get(&t_key)
    }

    pub fn version(env: Env) -> u32 {
        Self::bump_instance(&env);
        env.storage()
            .instance()
            .get(&VERSION_KEY)
            .unwrap_or(VERSION)
    }
}

#[cfg(test)]
mod test;
