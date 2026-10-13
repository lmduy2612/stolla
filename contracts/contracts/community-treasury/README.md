# CommunityTreasury

`CommunityTreasury` implements on-chain custody and spend-policy enforcement defined in [ADR-006](../../docs/adr/006-timelock-treasury-execution.md).

## Overview

The treasury holds community assets and guarantees that assets can only be moved through approved, timelocked governance actions.

Key invariants:
1. **Exclusive Spend Authority**: Only the configured `CommunityTimelock` contract can call `spend`. Direct EOA or administrator spends are rejected.
2. **Per-Action Spend Caps**: Each allowlisted asset enforces a `max_per_action` limit. Spends exceeding this ceiling revert immediately.
3. **Optional Recipient Allowlist**: Communities can optionally require recipients to be pre-authorized in the registry allowlist.
4. **Deny-by-Default**: Assets without a configured policy cannot be withdrawn.

## Interface

| Method | Caller | Description |
| --- | --- | --- |
| `deposit(from, asset, amount)` | Any (authenticated) | Deposits token assets into community custody. |
| `spend(caller, asset, recipient, amount, reference)` | Timelock | Disburses assets according to approved timelocked governance actions. |
| `set_asset_policy(caller, asset, max_per_action, allowed_recipients_only)` | Admin / Timelock | Configures spend limits and recipient restrictions for an asset. |
| `set_recipient_allowlist(caller, asset, recipient, allowed)` | Admin / Timelock | Authorizes or revokes a recipient address for restricted assets. |
| `get_balance(asset)` | None | Returns the current custody balance for an asset. |
| `get_asset_policy(asset)` | None | Returns the configured `AssetPolicy` for an asset. |
| `is_recipient_allowed(asset, recipient)` | None | Checks if a recipient is allowed for a restricted asset. |
