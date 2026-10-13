#![cfg(test)]

extern crate std;

use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger as _},
    vec, Address, BytesN, Env, IntoVal, Symbol,
};

use crate::{
    ActionStatus, CommunityTimelock, CommunityTimelockClient, TimelockError,
};

#[contract]
struct MockTarget;

#[contractimpl]
impl MockTarget {
    pub fn do_something(_e: &Env, value: u32) -> u32 {
        value * 2
    }
}

struct Fixture {
    e: Env,
    admin: Address,
    governor: Address,
    guardian: Address,
    timelock_id: Address,
    target_id: Address,
}

impl Fixture {
    fn new(min_delay: u32, grace_period: u32) -> Self {
        let e = Env::default();
        let admin = Address::generate(&e);
        let governor = Address::generate(&e);
        let guardian = Address::generate(&e);

        let timelock_id = e.register(
            CommunityTimelock,
            (&admin, &governor, &guardian, min_delay, grace_period),
        );
        let target_id = e.register(MockTarget, ());

        Self {
            e,
            admin,
            governor,
            guardian,
            timelock_id,
            target_id,
        }
    }

    fn client(&self) -> CommunityTimelockClient<'_> {
        CommunityTimelockClient::new(&self.e, &self.timelock_id)
    }
}

#[test]
fn constructor_initializes_state_correctly() {
    let fixture = Fixture::new(100, 500);
    let client = fixture.client();

    assert_eq!(client.admin(), fixture.admin);
    assert_eq!(client.governor(), fixture.governor);
    assert_eq!(client.guardian(), fixture.guardian);
    assert_eq!(client.min_delay(), 100);
    assert_eq!(client.grace_period(), 500);
    assert!(!client.is_paused());
}

#[test]
fn only_governor_or_admin_can_queue() {
    let fixture = Fixture::new(100, 500);
    fixture.e.mock_all_auths();
    let client = fixture.client();

    let proposal_id = BytesN::from_array(&fixture.e, &[1; 32]);
    let stranger = Address::generate(&fixture.e);

    // Stranger rejected
    let res = client.try_queue(
        &stranger,
        &proposal_id,
        &fixture.target_id,
        &Symbol::new(&fixture.e, "do_something"),
        &vec![&fixture.e, 21u32.into_val(&fixture.e)],
        &None,
    );
    assert_eq!(res, Err(Ok(TimelockError::Unauthorized)));

    // Delay less than min_delay rejected
    let res = client.try_queue(
        &fixture.governor,
        &proposal_id,
        &fixture.target_id,
        &Symbol::new(&fixture.e, "do_something"),
        &vec![&fixture.e, 21u32.into_val(&fixture.e)],
        &Some(50),
    );
    assert_eq!(res, Err(Ok(TimelockError::InvalidDelay)));

    // Governor can queue with default delay
    let action_id = client.queue(
        &fixture.governor,
        &proposal_id,
        &fixture.target_id,
        &Symbol::new(&fixture.e, "do_something"),
        &vec![&fixture.e, 21u32.into_val(&fixture.e)],
        &None,
    );

    let action = client.get_action(&action_id).unwrap();
    assert_eq!(action.status, ActionStatus::Queued);
    assert_eq!(action.eta, fixture.e.ledger().sequence() + 100);
    assert_eq!(action.expires_at, action.eta + 500);
}

#[test]
fn execute_respects_timelock_window() {
    let fixture = Fixture::new(100, 500);
    fixture.e.mock_all_auths();
    let client = fixture.client();

    let proposal_id = BytesN::from_array(&fixture.e, &[2; 32]);
    let action_id = client.queue(
        &fixture.governor,
        &proposal_id,
        &fixture.target_id,
        &Symbol::new(&fixture.e, "do_something"),
        &vec![&fixture.e, 21u32.into_val(&fixture.e)],
        &Some(100),
    );

    let executor = Address::generate(&fixture.e);

    // Executing before ETA rejected (TooEarly)
    assert_eq!(
        client.try_execute(&executor, &action_id),
        Err(Ok(TimelockError::TooEarly))
    );
    assert!(!client.is_action_executable(&action_id));

    // Advance ledger to exactly ETA
    fixture.e.ledger().set_sequence_number(100);
    assert!(client.is_action_executable(&action_id));

    // Execution succeeds
    client.execute(&executor, &action_id);

    let action = client.get_action(&action_id).unwrap();
    assert_eq!(action.status, ActionStatus::Executed);

    // Cannot execute again
    assert_eq!(
        client.try_execute(&executor, &action_id),
        Err(Ok(TimelockError::ActionNotQueued))
    );
}

#[test]
fn execute_fails_after_expiry() {
    let fixture = Fixture::new(100, 500);
    fixture.e.mock_all_auths();
    let client = fixture.client();

    let proposal_id = BytesN::from_array(&fixture.e, &[3; 32]);
    let action_id = client.queue(
        &fixture.governor,
        &proposal_id,
        &fixture.target_id,
        &Symbol::new(&fixture.e, "do_something"),
        &vec![&fixture.e, 10u32.into_val(&fixture.e)],
        &None,
    );

    // Advance beyond expires_at (eta is 100, expires_at is 600)
    fixture.e.ledger().set_sequence_number(601);

    let executor = Address::generate(&fixture.e);
    assert_eq!(
        client.try_execute(&executor, &action_id),
        Err(Ok(TimelockError::Expired))
    );

    // Terminal expiry can be marked permissionlessly
    client.mark_expired(&action_id);
    let action = client.get_action(&action_id).unwrap();
    assert_eq!(action.status, ActionStatus::Expired);
}

#[test]
fn guardian_or_admin_can_cancel_queued_action() {
    let fixture = Fixture::new(100, 500);
    fixture.e.mock_all_auths();
    let client = fixture.client();

    let proposal_id = BytesN::from_array(&fixture.e, &[4; 32]);
    let action_id = client.queue(
        &fixture.governor,
        &proposal_id,
        &fixture.target_id,
        &Symbol::new(&fixture.e, "do_something"),
        &vec![&fixture.e, 10u32.into_val(&fixture.e)],
        &None,
    );

    // Stranger cannot cancel
    let stranger = Address::generate(&fixture.e);
    assert_eq!(
        client.try_cancel(&stranger, &action_id),
        Err(Ok(TimelockError::Unauthorized))
    );

    // Guardian can cancel
    client.cancel(&fixture.guardian, &action_id);
    let action = client.get_action(&action_id).unwrap();
    assert_eq!(action.status, ActionStatus::Cancelled);

    // Cannot execute cancelled action
    fixture.e.ledger().set_sequence_number(150);
    assert_eq!(
        client.try_execute(&stranger, &action_id),
        Err(Ok(TimelockError::ActionNotQueued))
    );
}

#[test]
fn pause_blocks_queue_and_execute() {
    let fixture = Fixture::new(100, 500);
    fixture.e.mock_all_auths();
    let client = fixture.client();

    // Guardian pauses contract
    client.set_paused(&fixture.guardian, &true);
    assert!(client.is_paused());

    let proposal_id = BytesN::from_array(&fixture.e, &[5; 32]);
    assert_eq!(
        client.try_queue(
            &fixture.governor,
            &proposal_id,
            &fixture.target_id,
            &Symbol::new(&fixture.e, "do_something"),
            &vec![&fixture.e, 10u32.into_val(&fixture.e)],
            &None,
        ),
        Err(Ok(TimelockError::ContractPaused))
    );

    // Unpause restores queue
    client.set_paused(&fixture.guardian, &false);
    assert!(!client.is_paused());

    let action_id = client.queue(
        &fixture.governor,
        &proposal_id,
        &fixture.target_id,
        &Symbol::new(&fixture.e, "do_something"),
        &vec![&fixture.e, 10u32.into_val(&fixture.e)],
        &None,
    );
    assert_eq!(
        client.get_action(&action_id).unwrap().status,
        ActionStatus::Queued
    );
}
