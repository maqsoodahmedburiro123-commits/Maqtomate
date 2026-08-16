# Maqtomate Production V1.1 — Security and Migration Audit

**Audit scope:** V1.1 modular source tree, local fresh migration path, existing production D1 inventory, and automated regression suite.

## Result

The V1.1 source is suitable for an isolated staging deployment. The production deployment remains gated on a separate staging database/KV setup, successful staging end-to-end checks, and an explicit production promotion checkpoint.

| Control | Result | Evidence |
|---|---|---|
| Webhook HMAC verification | Pass | Missing or invalid `APP_SECRET`/signature returns `403` before D1 or AI provider processing. |
| Fail-closed rate limiting | Pass | Missing KV binding blocks automated message processing rather than bypassing rate limits. |
| Duplicate handling | Pass | Per-tenant WhatsApp message IDs are deduplicated in KV before provider generation. |
| Voice cost control | Pass | Global flags default to false; the audio route exits before media download or transcription and records a safe disabled event. |
| Tenant access boundaries | Pass | Portal routes resolve tenant access from server-side membership and bind `client_id` to data queries. |
| Passwordless sessions | Preserved | Magic-link expiry, hashed tokens, secure HTTP-only cookies, session revocation, and role enforcement remain in the portal. |
| Secret protection | Pass | AES-GCM tenant envelopes remain server-side; dashboard/export paths do not return secret fields. |
| Provider separation | Pass | Gemini is behind a router; platform and tenant scopes select credentials separately. |
| Plan/feature governance | Pass | Plan limits and feature flags are centralized; voice remains non-entitled and globally paused. |
| Usage cost control | Pass in source | AI/message usage is checked before provider execution and recorded tenant-scoped after the response. |
| Export scoping | Pass | Exports bind to the authenticated tenant and apply a central export entitlement check. |
| Fresh schema hygiene | Pass | The demo tenant and credential-like placeholders were removed; a fresh local database finishes with zero tenants. |
| Migration ordering | Pass | The new manifest separates fresh, current-production, and legacy compatibility paths. |
| Tracked secret scan | Pass | No known Cloudflare, GitHub, Gemini, or generic service key pattern was found in Git-tracked source. |
| Automated regression tests | Pass | 22 tests passed, including actual Webhook `fetch` tests for signature behavior. |

## Production D1 Finding

Production already contains the V1.0 tenant, auth, payment, voice, lead, and follow-up tables. It does not contain the V1.1 provider metadata, workflow, or usage tables. Therefore, the only V1.1 database changes for the current production database are:

1. `migration-005-modular-foundation.sql`
2. `migration-006-automation-usage.sql`

No historical Migration 001 should be run on current production.

## Important Residual Risks and Gates

The following are intentionally not treated as “complete” until staging validation is done.

| Gate | Why it remains | Required next action |
|---|---|---|
| Staging isolation | Production D1/KV must not be used for a deployment rehearsal. | Create dedicated staging Worker, D1, and KV resources. |
| Legacy plaintext credential neutralization | Existing legacy tenant fields must be verified against encrypted envelopes before any clearing action. | Run a read-only envelope inventory and validation procedure in staging first. |
| Real Meta/Gemini workflow | Tests use non-billable mocked/unsupported requests; they do not prove a customer’s provider account. | Use an owner-controlled test tenant and test phone only after staging configuration. |
| Production test tenant cleanup | A previous smoke-test tenant exists in production. | Identify and deactivate only that known test record through owner-approved cleanup; do not touch real tenant data. |
| Workflow mutations | V1.1 foundation records qualified actions for review; auto-mutating workflow actions are intentionally not enabled. | Add each action through an owner-approved handler with tests and audit logging. |

## Deployment Decision

> **Do not deploy directly to production next.** The approved next action is a dedicated Cloudflare staging environment. Apply Migrations 005 and 006 there, publish the two Workers with voice flags explicitly off, and validate sign-in, tenant isolation, text response, disabled voice behavior, usage limits, payment approval, and XLSX export before promotion.
