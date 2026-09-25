#![allow(unused_imports)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, BytesN, Env, String,
};

fn setup_env() -> (Env, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let governance = Address::generate(&env);
    let registry = env.register(TranscriptRegistry, (governance.clone(),));
    (env, registry, governance)
}

#[test]
fn test_register_transcript_success() {
    let (env, registry, _governance) = setup_env();
    let client = TranscriptRegistryClient::new(&env, &registry);

    let circuit_id = String::from_str(&env, "vote_v1");
    let transcript_hash = BytesN::from_array(&env, &[1u8; 32]);
    let vk_hash = BytesN::from_array(&env, &[2u8; 32]);
    let beacon_hash = BytesN::from_array(&env, &[3u8; 32]);
    let contributors = 5u32;

    client.register_transcript(
        &circuit_id,
        &transcript_hash,
        &vk_hash,
        &contributors,
        &beacon_hash,
    );

    let transcript = client.get_transcript(&transcript_hash);
    assert_eq!(transcript.circuit_id, circuit_id);
    assert_eq!(transcript.transcript_hash, transcript_hash);
    assert_eq!(transcript.vk_hash, vk_hash);
    assert_eq!(transcript.contributors_count, 5);
    assert!(transcript.verified);

    assert!(client.is_vk_attested(&vk_hash));
    assert!(client.verify_attestation(&transcript_hash, &vk_hash));

    // Non-existent VK is not attested
    let fake_vk = BytesN::from_array(&env, &[9u8; 32]);
    assert!(!client.is_vk_attested(&fake_vk));
    assert!(!client.verify_attestation(&transcript_hash, &fake_vk));
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_rejects_insufficient_contributors() {
    let (env, registry, _governance) = setup_env();
    let client = TranscriptRegistryClient::new(&env, &registry);

    let circuit_id = String::from_str(&env, "vote_v1");
    let transcript_hash = BytesN::from_array(&env, &[1u8; 32]);
    let vk_hash = BytesN::from_array(&env, &[2u8; 32]);
    let beacon_hash = BytesN::from_array(&env, &[3u8; 32]);

    // Less than 3 contributors must fail
    client.register_transcript(&circuit_id, &transcript_hash, &vk_hash, &2u32, &beacon_hash);
}

#[test]
fn test_record_contribution_chain() {
    let (env, registry, _governance) = setup_env();
    let client = TranscriptRegistryClient::new(&env, &registry);

    let circuit_id = String::from_str(&env, "vote_v1");
    let step0 = BytesN::from_array(&env, &[0u8; 32]);
    let step1 = BytesN::from_array(&env, &[1u8; 32]);
    let step2 = BytesN::from_array(&env, &[2u8; 32]);
    let tag1 = BytesN::from_array(&env, &[10u8; 32]);
    let tag2 = BytesN::from_array(&env, &[20u8; 32]);

    client.record_contribution(&circuit_id, &step0, &step1, &tag1, &1);
    client.record_contribution(&circuit_id, &step1, &step2, &tag2, &2);
}
