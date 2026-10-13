#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::Address as _,
    Address, Env, Symbol,
};

use crate::{
    CommunityTreasury, CommunityTreasuryClient, TreasuryError,
};

struct Fixture {
    e: Env,
    timelock: Address,
    admin: Address,
    treasury_id: Address,
}

impl Fixture {
    fn new() -> Self {
        let e = Env::default();
        let timelock = Address::generate(&e);
        let admin = Address::generate(&e);
        let treasury_id = e.register(CommunityTreasury, (&timelock, &admin));

        Self {
            e,
            timelock,
            admin,
            treasury_id,
        }
    }

    fn client(&self) -> CommunityTreasuryClient<'_> {
        CommunityTreasuryClient::new(&self.e, &self.treasury_id)
    }
}

#[test]
fn constructor_initializes_state() {
    let fixture = Fixture::new();
    let client = fixture.client();

    assert_eq!(client.timelock(), fixture.timelock);
    assert_eq!(client.admin(), fixture.admin);
}

#[test]
fn deposit_tracks_balance() {
    let fixture = Fixture::new();
    fixture.e.mock_all_auths();
    let client = fixture.client();

    let asset = Address::generate(&fixture.e);
    let sender = Address::generate(&fixture.e);

    assert_eq!(client.get_balance(&asset), 0);

    client.deposit(&sender, &asset, &1_000_000);
    assert_eq!(client.get_balance(&asset), 1_000_000);

    client.deposit(&sender, &asset, &500_000);
    assert_eq!(client.get_balance(&asset), 1_500_000);
}

#[test]
fn only_timelock_can_spend() {
    let fixture = Fixture::new();
    fixture.e.mock_all_auths();
    let client = fixture.client();

    let asset = Address::generate(&fixture.e);
    let recipient = Address::generate(&fixture.e);
    let stranger = Address::generate(&fixture.e);

    // Set policy and deposit balance
    client.set_asset_policy(&fixture.admin, &asset, &100_000, &false);
    client.deposit(&stranger, &asset, &500_000);

    // Stranger calling spend is rejected
    assert_eq!(
        client.try_spend(&stranger, &asset, &recipient, &50_000, &Symbol::new(&fixture.e, "test")),
        Err(Ok(TreasuryError::Unauthorized))
    );

    // Admin calling spend is rejected (only Timelock can spend)
    assert_eq!(
        client.try_spend(&fixture.admin, &asset, &recipient, &50_000, &Symbol::new(&fixture.e, "test")),
        Err(Ok(TreasuryError::Unauthorized))
    );

    // Timelock calling spend succeeds
    client.spend(&fixture.timelock, &asset, &recipient, &50_000, &Symbol::new(&fixture.e, "test"));
    assert_eq!(client.get_balance(&asset), 450_000);
}

#[test]
fn spend_policy_limits_enforced() {
    let fixture = Fixture::new();
    fixture.e.mock_all_auths();
    let client = fixture.client();

    let asset = Address::generate(&fixture.e);
    let allowed_recipient = Address::generate(&fixture.e);
    let forbidden_recipient = Address::generate(&fixture.e);

    // Configure policy: max 50,000 per action, restricted recipients only
    client.set_asset_policy(&fixture.admin, &asset, &50_000, &true);
    client.set_recipient_allowlist(&fixture.admin, &asset, &allowed_recipient, &true);

    client.deposit(&fixture.admin, &asset, &200_000);

    // 1. Amount exceeds cap -> AmountExceedsLimit
    assert_eq!(
        client.try_spend(&fixture.timelock, &asset, &allowed_recipient, &50_001, &Symbol::new(&fixture.e, "cap")),
        Err(Ok(TreasuryError::AmountExceedsLimit))
    );

    // 2. Forbidden recipient -> RecipientNotAllowed
    assert_eq!(
        client.try_spend(&fixture.timelock, &asset, &forbidden_recipient, &10_000, &Symbol::new(&fixture.e, "recip")),
        Err(Ok(TreasuryError::RecipientNotAllowed))
    );

    // 3. Unconfigured asset -> AssetNotAllowed
    let unconfigured_asset = Address::generate(&fixture.e);
    assert_eq!(
        client.try_spend(&fixture.timelock, &unconfigured_asset, &allowed_recipient, &10_000, &Symbol::new(&fixture.e, "asset")),
        Err(Ok(TreasuryError::AssetNotAllowed))
    );

    // 4. Insufficient balance -> InsufficientBalance
    let empty_asset = Address::generate(&fixture.e);
    client.set_asset_policy(&fixture.admin, &empty_asset, &50_000, &false);
    assert_eq!(
        client.try_spend(&fixture.timelock, &empty_asset, &allowed_recipient, &10_000, &Symbol::new(&fixture.e, "bal")),
        Err(Ok(TreasuryError::InsufficientBalance))
    );

    // 5. Valid spend succeeds
    client.spend(&fixture.timelock, &asset, &allowed_recipient, &40_000, &Symbol::new(&fixture.e, "ok"));
    assert_eq!(client.get_balance(&asset), 160_000);
}

#[test]
fn policy_administration_authorization() {
    let fixture = Fixture::new();
    fixture.e.mock_all_auths();
    let client = fixture.client();

    let asset = Address::generate(&fixture.e);
    let stranger = Address::generate(&fixture.e);

    // Stranger cannot set policy
    assert_eq!(
        client.try_set_asset_policy(&stranger, &asset, &100_000, &false),
        Err(Ok(TreasuryError::Unauthorized))
    );

    // Admin can set policy
    client.set_asset_policy(&fixture.admin, &asset, &100_000, &false);
    let policy = client.get_asset_policy(&asset).unwrap();
    assert_eq!(policy.max_per_action, 100_000);
    assert!(!policy.allowed_recipients_only);

    // Timelock can also update policy
    client.set_asset_policy(&fixture.timelock, &asset, &200_000, &true);
    let policy2 = client.get_asset_policy(&asset).unwrap();
    assert_eq!(policy2.max_per_action, 200_000);
    assert!(policy2.allowed_recipients_only);
}
