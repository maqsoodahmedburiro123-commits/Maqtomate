# Maqtomate D1 Migration Manifest

This file is the **single operational reference** for database changes. Do not infer migration order from filenames alone, and do not run historical compatibility SQL against a fresh database.

## Current Production Baseline

The production D1 inventory contains the original base tables plus tenant authentication, payment-gate, and WhatsApp Voice Employee tables. It does **not** yet contain the V1.1 modular provider, workflow, or usage tables.

> Before every production change, take a D1 export/backup checkpoint and run the local migration path first. Never run an `ALTER TABLE` migration twice.

| Environment state | Required SQL files | Notes |
|---|---|---|
| **Fresh development/staging database** | `d1-schema.sql` → `migration-002-tenant-dashboard-auth.sql` → `migration-003-manual-payment-gate.sql` → `migration-004-voice-calling.sql` → `migration-005-modular-foundation.sql` → `migration-006-automation-usage.sql` | The fresh schema intentionally creates no demo tenant and contains no credential-like placeholder. The fresh schema already includes the connection-state table. |
| **Current Maqtomate production database** | First verify migration/table inventory; then apply only any missing additive migrations, including `migration-007-whatsapp-connection-state.sql` after 002–006 are confirmed. | Never infer the live state from filenames or historical notes. The connection-state migration does not store credentials. |
| **Very old legacy database lacking auth/payment/voice tables** | Assess table inventory first; apply only the missing migrations in order. | Do not guess. Use a temporary copy or staging D1 instance if history is uncertain. |
| **Historical pre-schema database** | `archive/migration-001-audit-mode1.sql` only if the original schema lacks `audit_logs`, `gemini_api_key`, and `client_mode`. | This is a one-time compatibility migration and must never be run on a fresh database. |

## V1.1 Migration Content

| File | Purpose | Safety characteristics |
|---|---|---|
| `migration-005-modular-foundation.sql` | Provider metadata, tenant feature overrides, platform AI configuration metadata | Additive tables only; no credential values; API secrets stay in `tenant_secret_envelopes` and Worker secrets. |
| `migration-006-automation-usage.sql` | Workflow definitions/executions, tenant usage periods, lead/task operational enrichment | Additive tables plus one-time `ALTER TABLE` additions to lead and follow-up tables. |
| `migration-007-whatsapp-connection-state.sql` | Official Meta onboarding/connection state, WABA/phone metadata, and sanitized error state | Additive metadata table only. Meta access tokens and other secrets remain in `tenant_secret_envelopes`. |

## Legacy Credential Cleanup Procedure

Legacy plaintext cleanup is **not automatic**. The production path is:

1. Inventory ordinary client credential fields and associated secret envelopes without printing secret values.
2. Confirm the tenant envelope decrypts successfully and the configured provider/Meta operation can be validated safely.
3. Record provider metadata and validation state in `tenant_ai_provider_settings`.
4. Only after the validation checkpoint, neutralize the legacy active credential path using a dedicated, reviewed maintenance migration.
5. Retain a reversible, encrypted backup only in the approved secret storage process; never place raw values in Git, D1 reports, logs, or dashboard responses.

## Release Commands

The exact commands are documented in the production checklist. The safety sequence is always:

1. Run the complete local migration path.
2. Run automated tests and Worker bundle checks.
3. Apply the two V1.1 migrations to an isolated staging D1 database.
4. Validate staging webhook, portal, and export behavior.
5. Apply to production only after the owner-approved staging checklist passes.

## Historical Files

`archive/migration-001-audit-mode1.sql` is retained only to support a documented old-database recovery path. It is not part of the current fresh or production V1.1 path.
