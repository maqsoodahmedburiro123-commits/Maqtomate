# Maqtomate Production V1.1 — Modular Foundation Backlog

**Starting baseline:** GitHub `main` commit `61c110d`  
**Guiding rule:** Preserve the existing secure SaaS and payment-gated tenant model. Deliver backwards-compatible modular layers in small, verifiable migrations.

## Release Objective

Production V1.1 turns the existing Maqtomate foundation into a configurable system rather than a collection of fixed feature paths. It adds plan entitlements, feature flags, provider routing, safe voice pause behavior, usage policy, reusable workflow records, and reliable tests without replacing the working WhatsApp, portal, authentication, or payment systems.

## Compatibility Rules

| Rule | Implementation requirement |
|---|---|
| Preserve live tenant access | No change may invalidate existing magic-link users, memberships, or platform roles. |
| Preserve payment approval | Tenants remain inactive until a Primary Owner approves the payment request. |
| Preserve secret envelopes | All credential changes use `tenant_secret_envelopes`; never move a secret to browser code or normal export tables. |
| Default new risk-bearing features off | Voice auto-processing, new provider fallback, and new workflows remain disabled until explicitly enabled by policy. |
| Make migrations additive first | New tables/columns are additive and idempotent. Destructive cleanup requires a separately reviewed maintenance migration. |
| Keep existing routes stable | Existing portal and WhatsApp routes should preserve safe responses while new policy checks are added. |
| Release only after verified tests | Every release includes real unit/integration tests, a migration test, bundle check, and controlled staging validation. |

## Ordered Work Packages

| Package | Scope | Key outputs | Dependency | Release gate |
|---|---|---|---|---|
| **V1.1-A** | Safety/config foundation | `config/plans.js`, `config/features.js`, centralized policy helpers, safe error responses, fresh-schema cleanup, migration manifest | None | Unit tests for policies and safe error paths |
| **V1.1-B** | Voice pause | Default-off global and tenant feature policy; audio messages get a safe no-cost response; no Gemini transcription, no voice jobs, no raw audio retention | V1.1-A | Signed audio webhook integration test |
| **V1.1-C** | AI provider layer | Provider interface, Gemini adapter, tenant/platform scope router, provider metadata, validation state model | V1.1-A | Router and BYOK policy tests |
| **V1.1-D** | Secure provider migration | Legacy plaintext discovery, envelope verification, neutralization plan, provider/key metadata, rotation states | V1.1-C | Migration dry run and envelope decryption test |
| **V1.1-E** | Workflow and usage foundation | Normalized events, workflow definitions/executions, usage ledger, limits, alerts, lead/task enrichment | V1.1-A | Tenant-scoped workflow and usage tests |
| **V1.1-F** | Portal/owner operations | Feature/plan status, usage, automations, lead/task filters, owner health and provider status | V1.1-E | Authorization and tenant-isolation API tests |
| **V1.1-G** | Quality/security release | Full tests, migration manifest verification, D1 audit, staging deploy, Meta/Gemini controlled test, GitHub release | All preceding | Production release checklist |

## Initial Feature Policy

| Capability | DIY BYOK | Smart Pro | VIP Managed | Default state in V1.1 |
|---|---:|---:|---:|---|
| WhatsApp text automation | Yes | Yes | Yes | Enabled subject to valid tenant configuration |
| Tenant BYOK Gemini | Yes | Optional | Optional | Enabled only for designated plan/tenant policy |
| Shared platform Gemini | No by default | Yes | Yes | Requires platform provider configuration and usage limit |
| Excel export | Yes | Yes | Yes | Enabled and tenant-scoped |
| Voice Employee data model | Ready | Ready | Ready | Preserved, but processing paused |
| Voice transcription | No | No | No | Disabled globally by default |
| Voice auto-processing | No | No | No | Disabled globally by default |
| Workflow automation | Limited | Standard | Advanced | Disabled until a specific workflow is enabled |
| Advanced provider fallback | No | No | Optional | Disabled until configured and tested |
| Team expansion | Plan-limited | Plan-limited | Plan-limited | Policy-enforced after V1.1-E |

## Migration Strategy

1. Retain the historical Migration 001 only for legacy production compatibility; do not run it against a new database.
2. Create a migration manifest that identifies the exact ordered path for fresh versus existing databases.
3. Remove the demo tenant insertion from the fresh schema; a new database must start empty and secure.
4. Add new V1.1 tables and columns additively.
5. Build a read-only legacy credential inventory before any plaintext neutralization.
6. Validate that every candidate secret has a functioning encrypted envelope before clearing/marking a legacy source field.
7. Keep a database backup/export checkpoint before any data-altering cleanup.

## Testing Strategy

| Test tier | Required coverage |
|---|---|
| Unit | Plan entitlements, feature policy, provider router, token hash/expiry, signature comparison, lead classification, usage limits, workflow conditions. |
| Integration | Signed text/voice Meta payloads, duplicate messages, rate limits, onboarding/payment activation, dashboard membership boundaries, exports, support grant limits. |
| Security | Cross-tenant access denial, unauthenticated route denial, safe error response, disabled voice no-cost path, secret redaction, CORS/CSRF checks. |
| Migration | Fresh-schema bootstrap, existing-schema upgrade path, V1.1 additive migration, legacy secret-envelope verification. |
| Controlled staging | Real Meta callback verification, valid text message, disabled voice message, valid Gemini text response, portal report export. |

## Explicitly Deferred

The following are architecture-prepared but not implemented in the first V1.1 pass: additional AI providers, Instagram/Facebook/Email/Telegram channels, vector knowledge retrieval, automated billing, custom-domain-only features, browser voice rooms, and customer-facing AI-generated code changes. Each will be added through the policy, provider, channel, and workflow extension points after the core controls are stable.
