#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    xdr::ToXdr, Address, Bytes, BytesN, Env, Symbol, Val, Vec,
};

pub const DEFAULT_STORAGE_TTL_THRESHOLD: u32 = 17_280;
pub const DEFAULT_STORAGE_EXTEND_AMOUNT: u32 = 34_560;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TimelockError {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    InvalidDelay = 3,
    ActionAlreadyQueued = 4,
    ActionNotFound = 5,
    ActionNotQueued = 6,
    TooEarly = 7,
    Expired = 8,
    ContractPaused = 9,
    Overflow = 10,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ActionStatus {
    Queued = 0,
    Executed = 1,
    Cancelled = 2,
    Expired = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActionRecord {
    pub action_id: BytesN<32>,
    pub proposal_id: BytesN<32>,
    pub target: Address,
    pub function: Symbol,
    pub args: Vec<Val>,
    pub queued_at: u32,
    pub eta: u32,
    pub expires_at: u32,
    pub status: ActionStatus,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Governor,
    Guardian,
    MinDelay,
    GracePeriod,
    Paused,
    Action(BytesN<32>),
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActionQueued {
    #[topic]
    pub action_id: BytesN<32>,
    #[topic]
    pub proposal_id: BytesN<32>,
    pub target: Address,
    pub eta: u32,
    pub expires_at: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActionExecuted {
    #[topic]
    pub action_id: BytesN<32>,
    pub executor: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActionCancelled {
    #[topic]
    pub action_id: BytesN<32>,
    pub caller: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActionExpired {
    #[topic]
    pub action_id: BytesN<32>,
}

#[contract]
pub struct CommunityTimelock;

#[contractimpl]
impl CommunityTimelock {
    pub fn __constructor(
        e: &Env,
        admin: Address,
        governor: Address,
        guardian: Address,
        min_delay: u32,
        grace_period: u32,
    ) {
        if e.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(e, TimelockError::AlreadyInitialized);
        }

        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::Governor, &governor);
        e.storage().instance().set(&DataKey::Guardian, &guardian);
        e.storage().instance().set(&DataKey::MinDelay, &min_delay);
        e.storage().instance().set(&DataKey::GracePeriod, &grace_period);
        e.storage().instance().set(&DataKey::Paused, &false);

        Self::extend_instance_ttl(e);
    }

    pub fn queue(
        e: &Env,
        caller: Address,
        proposal_id: BytesN<32>,
        target: Address,
        function: Symbol,
        args: Vec<Val>,
        delay: Option<u32>,
    ) -> Result<BytesN<32>, TimelockError> {
        caller.require_auth();
        Self::ensure_not_paused(e)?;
        Self::extend_instance_ttl(e);

        let governor: Address = e.storage().instance().get(&DataKey::Governor).unwrap();
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();

        if caller != governor && caller != admin {
            return Err(TimelockError::Unauthorized);
        }

        let min_delay: u32 = e.storage().instance().get(&DataKey::MinDelay).unwrap();
        let requested_delay = delay.unwrap_or(min_delay);

        if requested_delay < min_delay {
            return Err(TimelockError::InvalidDelay);
        }

        let current_ledger = e.ledger().sequence();
        let eta = current_ledger
            .checked_add(requested_delay)
            .ok_or(TimelockError::Overflow)?;

        let grace_period: u32 = e.storage().instance().get(&DataKey::GracePeriod).unwrap();
        let expires_at = eta
            .checked_add(grace_period)
            .ok_or(TimelockError::Overflow)?;

        // Compute unique deterministic action_id
        let mut preimage = Bytes::new(e);
        preimage.append(&proposal_id.clone().into());
        preimage.append(&target.clone().to_xdr(e));
        preimage.append(&function.clone().to_xdr(e));

        let action_id: BytesN<32> = e.crypto().sha256(&preimage).into();

        let action_key = DataKey::Action(action_id.clone());
        if e.storage().persistent().has(&action_key) {
            return Err(TimelockError::ActionAlreadyQueued);
        }

        let record = ActionRecord {
            action_id: action_id.clone(),
            proposal_id: proposal_id.clone(),
            target: target.clone(),
            function,
            args,
            queued_at: current_ledger,
            eta,
            expires_at,
            status: ActionStatus::Queued,
        };

        e.storage().persistent().set(&action_key, &record);
        e.storage().persistent().extend_ttl(
            &action_key,
            DEFAULT_STORAGE_TTL_THRESHOLD,
            DEFAULT_STORAGE_EXTEND_AMOUNT,
        );

        ActionQueued {
            action_id: action_id.clone(),
            proposal_id,
            target,
            eta,
            expires_at,
        }
        .publish(e);

        Ok(action_id)
    }

    pub fn execute(
        e: &Env,
        caller: Address,
        action_id: BytesN<32>,
    ) -> Result<(), TimelockError> {
        caller.require_auth();
        Self::ensure_not_paused(e)?;
        Self::extend_instance_ttl(e);

        let action_key = DataKey::Action(action_id.clone());
        let mut record: ActionRecord = e
            .storage()
            .persistent()
            .get(&action_key)
            .ok_or(TimelockError::ActionNotFound)?;

        if record.status != ActionStatus::Queued {
            return Err(TimelockError::ActionNotQueued);
        }

        let current_ledger = e.ledger().sequence();
        if current_ledger < record.eta {
            return Err(TimelockError::TooEarly);
        }

        if current_ledger > record.expires_at {
            return Err(TimelockError::Expired);
        }

        record.status = ActionStatus::Executed;
        e.storage().persistent().set(&action_key, &record);
        e.storage().persistent().extend_ttl(
            &action_key,
            DEFAULT_STORAGE_TTL_THRESHOLD,
            DEFAULT_STORAGE_EXTEND_AMOUNT,
        );

        ActionExecuted {
            action_id,
            executor: caller,
        }
        .publish(e);

        let _: Val = e.invoke_contract(&record.target, &record.function, record.args);
        Ok(())
    }

    pub fn cancel(
        e: &Env,
        caller: Address,
        action_id: BytesN<32>,
    ) -> Result<(), TimelockError> {
        caller.require_auth();
        Self::extend_instance_ttl(e);

        let guardian: Address = e.storage().instance().get(&DataKey::Guardian).unwrap();
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        let governor: Address = e.storage().instance().get(&DataKey::Governor).unwrap();

        if caller != guardian && caller != admin && caller != governor {
            return Err(TimelockError::Unauthorized);
        }

        let action_key = DataKey::Action(action_id.clone());
        let mut record: ActionRecord = e
            .storage()
            .persistent()
            .get(&action_key)
            .ok_or(TimelockError::ActionNotFound)?;

        if record.status != ActionStatus::Queued {
            return Err(TimelockError::ActionNotQueued);
        }

        record.status = ActionStatus::Cancelled;
        e.storage().persistent().set(&action_key, &record);

        ActionCancelled {
            action_id,
            caller,
        }
        .publish(e);

        Ok(())
    }

    pub fn mark_expired(
        e: &Env,
        action_id: BytesN<32>,
    ) -> Result<(), TimelockError> {
        Self::extend_instance_ttl(e);

        let action_key = DataKey::Action(action_id.clone());
        let mut record: ActionRecord = e
            .storage()
            .persistent()
            .get(&action_key)
            .ok_or(TimelockError::ActionNotFound)?;

        if record.status != ActionStatus::Queued {
            return Err(TimelockError::ActionNotQueued);
        }

        let current_ledger = e.ledger().sequence();
        if current_ledger <= record.expires_at {
            return Err(TimelockError::TooEarly);
        }

        record.status = ActionStatus::Expired;
        e.storage().persistent().set(&action_key, &record);

        ActionExpired { action_id }.publish(e);

        Ok(())
    }

    pub fn get_action(e: &Env, action_id: BytesN<32>) -> Option<ActionRecord> {
        Self::extend_instance_ttl(e);
        let action_key = DataKey::Action(action_id);
        e.storage().persistent().get(&action_key)
    }

    pub fn is_action_executable(e: &Env, action_id: BytesN<32>) -> bool {
        Self::extend_instance_ttl(e);
        let action_key = DataKey::Action(action_id);
        if let Some(record) = e.storage().persistent().get::<DataKey, ActionRecord>(&action_key) {
            if record.status != ActionStatus::Queued {
                return false;
            }
            let current = e.ledger().sequence();
            current >= record.eta && current <= record.expires_at
        } else {
            false
        }
    }

    pub fn set_paused(
        e: &Env,
        caller: Address,
        paused: bool,
    ) -> Result<(), TimelockError> {
        caller.require_auth();
        let guardian: Address = e.storage().instance().get(&DataKey::Guardian).unwrap();
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();

        if caller != guardian && caller != admin {
            return Err(TimelockError::Unauthorized);
        }

        e.storage().instance().set(&DataKey::Paused, &paused);
        Self::extend_instance_ttl(e);
        Ok(())
    }

    pub fn admin(e: &Env) -> Address {
        e.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn governor(e: &Env) -> Address {
        e.storage().instance().get(&DataKey::Governor).unwrap()
    }

    pub fn guardian(e: &Env) -> Address {
        e.storage().instance().get(&DataKey::Guardian).unwrap()
    }

    pub fn min_delay(e: &Env) -> u32 {
        e.storage().instance().get(&DataKey::MinDelay).unwrap()
    }

    pub fn grace_period(e: &Env) -> u32 {
        e.storage().instance().get(&DataKey::GracePeriod).unwrap()
    }

    pub fn is_paused(e: &Env) -> bool {
        e.storage().instance().get(&DataKey::Paused).unwrap_or(false)
    }

    pub fn extend_instance_ttl(e: &Env) {
        e.storage().instance().extend_ttl(
            DEFAULT_STORAGE_TTL_THRESHOLD,
            DEFAULT_STORAGE_EXTEND_AMOUNT,
        );
    }

    fn ensure_not_paused(e: &Env) -> Result<(), TimelockError> {
        if Self::is_paused(e) {
            Err(TimelockError::ContractPaused)
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod test;
