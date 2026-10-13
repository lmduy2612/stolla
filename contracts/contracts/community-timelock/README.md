# CommunityTimelock

`CommunityTimelock` implements the governance delay boundary defined in [ADR-006](../../docs/adr/006-timelock-treasury-execution.md).

## Overview

When privileged proposals (such as treasury disbursements or parameter updates) succeed in `CommunityGovernor`, they are queued in `CommunityTimelock`. The timelock enforces:

1. **Mandatory Delay**: Operations must wait at least `min_delay` ledgers before becoming executable.
2. **Execution Window**: Once the delay has elapsed (`eta`), the operation must be executed within `grace_period` ledgers. If unexecuted within this window, the action expires.
3. **Emergency Cancellation**: A configured community `guardian` or administrative role can cancel malicious or compromised queued proposals before execution.
4. **Isolated Custody**: Timelocks are deployed per community, preventing cross-community privilege escalation.

## Constructor and Authorization

```rust
__constructor(
    admin: Address,
    governor: Address,
    guardian: Address,
    min_delay: u32,
    grace_period: u32,
)
```

- **Governor**: The sole contract authorized to call `queue` for approved proposals.
- **Guardian / Admin**: Emergency multisignature capable of pausing the contract and cancelling queued actions.
- **Executor**: Any authenticated account can relay and call `execute` during the active window (`eta..=expires_at`).

## Interface

| Method | Caller | Description |
| --- | --- | --- |
| `queue(caller, proposal_id, target, function, args, delay)` | Governor / Admin | Enqueues a passed proposal for delayed execution. |
| `execute(caller, action_id)` | Any (authenticated) | Invokes target contract when `current_ledger >= eta && current_ledger <= expires_at`. |
| `cancel(caller, action_id)` | Guardian / Admin / Governor | Cancels a queued action before execution. |
| `mark_expired(action_id)` | Any | Records terminal expiration after the grace window lapses. |
| `get_action(action_id)` | None | Returns the `ActionRecord` including status and timing. |
| `is_action_executable(action_id)` | None | Returns true if the action is queued and in its execution window. |
| `set_paused(caller, paused)` | Guardian / Admin | Toggles emergency pause. |
