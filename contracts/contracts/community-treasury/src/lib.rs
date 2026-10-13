#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    Address, Env, Symbol,
};

pub const DEFAULT_STORAGE_TTL_THRESHOLD: u32 = 17_280;
pub const DEFAULT_STORAGE_EXTEND_AMOUNT: u32 = 34_560;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TreasuryError {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    AssetNotAllowed = 3,
    InvalidAmount = 4,
    AmountExceedsLimit = 5,
    RecipientNotAllowed = 6,
    InsufficientBalance = 7,
    SelfPaymentNotAllowed = 8,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetPolicy {
    pub max_per_action: i128,
    pub allowed_recipients_only: bool,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Timelock,
    Admin,
    AssetPolicy(Address),
    RecipientAllowed(Address, Address),
    Balance(Address),
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TreasuryPayment {
    #[topic]
    pub asset: Address,
    #[topic]
    pub recipient: Address,
    pub amount: i128,
    pub reference: Symbol,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TreasuryDeposit {
    #[topic]
    pub asset: Address,
    #[topic]
    pub sender: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetPolicySet {
    #[topic]
    pub asset: Address,
    pub max_per_action: i128,
    pub allowed_recipients_only: bool,
}

#[contract]
pub struct CommunityTreasury;

#[contractimpl]
impl CommunityTreasury {
    pub fn __constructor(e: &Env, timelock: Address, admin: Address) {
        if e.storage().instance().has(&DataKey::Timelock) {
            panic_with_error!(e, TreasuryError::AlreadyInitialized);
        }

        e.storage().instance().set(&DataKey::Timelock, &timelock);
        e.storage().instance().set(&DataKey::Admin, &admin);
        Self::extend_instance_ttl(e);
    }

    pub fn set_asset_policy(
        e: &Env,
        caller: Address,
        asset: Address,
        max_per_action: i128,
        allowed_recipients_only: bool,
    ) -> Result<(), TreasuryError> {
        caller.require_auth();
        Self::ensure_admin_or_timelock(e, &caller)?;
        Self::extend_instance_ttl(e);

        if max_per_action <= 0 {
            return Err(TreasuryError::InvalidAmount);
        }

        let policy = AssetPolicy {
            max_per_action,
            allowed_recipients_only,
        };

        let key = DataKey::AssetPolicy(asset.clone());
        e.storage().persistent().set(&key, &policy);
        e.storage().persistent().extend_ttl(
            &key,
            DEFAULT_STORAGE_TTL_THRESHOLD,
            DEFAULT_STORAGE_EXTEND_AMOUNT,
        );

        AssetPolicySet {
            asset,
            max_per_action,
            allowed_recipients_only,
        }
        .publish(e);

        Ok(())
    }

    pub fn set_recipient_allowlist(
        e: &Env,
        caller: Address,
        asset: Address,
        recipient: Address,
        allowed: bool,
    ) -> Result<(), TreasuryError> {
        caller.require_auth();
        Self::ensure_admin_or_timelock(e, &caller)?;
        Self::extend_instance_ttl(e);

        let key = DataKey::RecipientAllowed(asset, recipient);
        e.storage().persistent().set(&key, &allowed);
        e.storage().persistent().extend_ttl(
            &key,
            DEFAULT_STORAGE_TTL_THRESHOLD,
            DEFAULT_STORAGE_EXTEND_AMOUNT,
        );

        Ok(())
    }

    pub fn deposit(
        e: &Env,
        from: Address,
        asset: Address,
        amount: i128,
    ) -> Result<(), TreasuryError> {
        from.require_auth();
        Self::extend_instance_ttl(e);

        if amount <= 0 {
            return Err(TreasuryError::InvalidAmount);
        }

        let balance_key = DataKey::Balance(asset.clone());
        let current_balance: i128 = e
            .storage()
            .persistent()
            .get(&balance_key)
            .unwrap_or(0);

        let new_balance = current_balance
            .checked_add(amount)
            .ok_or(TreasuryError::InvalidAmount)?;

        e.storage().persistent().set(&balance_key, &new_balance);
        e.storage().persistent().extend_ttl(
            &balance_key,
            DEFAULT_STORAGE_TTL_THRESHOLD,
            DEFAULT_STORAGE_EXTEND_AMOUNT,
        );

        TreasuryDeposit {
            asset,
            sender: from,
            amount,
        }
        .publish(e);

        Ok(())
    }

    pub fn spend(
        e: &Env,
        caller: Address,
        asset: Address,
        recipient: Address,
        amount: i128,
        reference: Symbol,
    ) -> Result<(), TreasuryError> {
        caller.require_auth();
        Self::extend_instance_ttl(e);

        let timelock = Self::timelock(e);
        if caller != timelock {
            return Err(TreasuryError::Unauthorized);
        }

        if amount <= 0 {
            return Err(TreasuryError::InvalidAmount);
        }

        if recipient == e.current_contract_address() {
            return Err(TreasuryError::SelfPaymentNotAllowed);
        }

        // Validate policy
        let policy_key = DataKey::AssetPolicy(asset.clone());
        let policy: AssetPolicy = e
            .storage()
            .persistent()
            .get(&policy_key)
            .ok_or(TreasuryError::AssetNotAllowed)?;

        if amount > policy.max_per_action {
            return Err(TreasuryError::AmountExceedsLimit);
        }

        if policy.allowed_recipients_only {
            let recipient_key = DataKey::RecipientAllowed(asset.clone(), recipient.clone());
            let is_allowed = e
                .storage()
                .persistent()
                .get(&recipient_key)
                .unwrap_or(false);
            if !is_allowed {
                return Err(TreasuryError::RecipientNotAllowed);
            }
        }

        // Validate balance
        let balance_key = DataKey::Balance(asset.clone());
        let current_balance: i128 = e
            .storage()
            .persistent()
            .get(&balance_key)
            .unwrap_or(0);

        if current_balance < amount {
            return Err(TreasuryError::InsufficientBalance);
        }

        let new_balance = current_balance - amount;
        e.storage().persistent().set(&balance_key, &new_balance);
        e.storage().persistent().extend_ttl(
            &balance_key,
            DEFAULT_STORAGE_TTL_THRESHOLD,
            DEFAULT_STORAGE_EXTEND_AMOUNT,
        );

        TreasuryPayment {
            asset,
            recipient,
            amount,
            reference,
        }
        .publish(e);

        Ok(())
    }

    pub fn get_balance(e: &Env, asset: Address) -> i128 {
        Self::extend_instance_ttl(e);
        let key = DataKey::Balance(asset);
        e.storage().persistent().get(&key).unwrap_or(0)
    }

    pub fn get_asset_policy(e: &Env, asset: Address) -> Option<AssetPolicy> {
        Self::extend_instance_ttl(e);
        let key = DataKey::AssetPolicy(asset);
        e.storage().persistent().get(&key)
    }

    pub fn is_recipient_allowed(e: &Env, asset: Address, recipient: Address) -> bool {
        Self::extend_instance_ttl(e);
        let key = DataKey::RecipientAllowed(asset, recipient);
        e.storage().persistent().get(&key).unwrap_or(false)
    }

    pub fn timelock(e: &Env) -> Address {
        e.storage().instance().get(&DataKey::Timelock).unwrap()
    }

    pub fn admin(e: &Env) -> Address {
        e.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn extend_instance_ttl(e: &Env) {
        e.storage().instance().extend_ttl(
            DEFAULT_STORAGE_TTL_THRESHOLD,
            DEFAULT_STORAGE_EXTEND_AMOUNT,
        );
    }

    fn ensure_admin_or_timelock(e: &Env, caller: &Address) -> Result<(), TreasuryError> {
        let admin = Self::admin(e);
        let timelock = Self::timelock(e);
        if caller != &admin && caller != &timelock {
            Err(TreasuryError::Unauthorized)
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod test;
