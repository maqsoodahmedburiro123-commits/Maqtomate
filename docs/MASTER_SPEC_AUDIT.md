# Maqtomate Master Specification Compliance Audit

**Baseline reviewed:** GitHub `main` at commit `61c110d`  
**Production state reviewed:** Existing Cloudflare Workers and D1 deployment  
**Scope:** Assessment against the founder-approved Master Production, Automation & Future-Ready Implementation Prompt.

> This audit preserves the existing architecture. It does not recommend a rebuild. The objective is a backward-compatible Production V1.1 evolution with modular configuration, secure feature controls, and verified migrations.

## Executive Assessment

Maqtomate already has a meaningful secure SaaS foundation: tenant membership boundaries, magic-link sessions, owner roles, payment approval, AES-GCM secret envelopes, D1/KV storage, WhatsApp routing, lead/task tables, and a private portal are present. However, the newly approved master specification introduces several **mandatory architectural controls** that do not yet exist in the current source: centralized plan entitlements, platform/tenant feature flags, paused voice controls, provider abstraction, usage control, a reusable workflow layer, and a substantive test suite.

The correct next release is therefore **Production V1.1 Modular Foundation**, not a redesign and not an immediate feature expansion.

| Area | Current status | Assessment |
|---|---|---|
| Multi-tenant identities and memberships | Implemented | Server-side membership resolution is present in portal routes. Preserve it. |
| Owner Control Center | Implemented | Baseline owner overview, customer directory, payment review, and security views exist. Expand through guarded APIs only. |
| Passwordless authentication | Implemented | Hashed sessions, magic-link tokens, cookie protections, Turnstile, and role gates exist. Validate with real tests. |
| Tenant secret envelopes | Implemented | AES-GCM secret-envelope helpers exist. Remove legacy/plaintext compatibility paths only through a measured migration. |
| Manual payment activation | Implemented | Retain as the activation gate. |
| WhatsApp text handling | Implemented | Meta signature check, dedupe, rate limiting, tenant routing, and text response flow exist. |
| Voice workflow | Implemented and currently active | **Non-compliant with new instruction:** voice must be feature-paused, cost-safe, and non-destructive until re-enabled. |
| Plan entitlements | Not implemented | **Mandatory gap.** Plan checks are not centralized. |
| Feature flags | Not implemented | **Mandatory gap.** Needed to pause voice and control future features. |
| AI provider interface | Not implemented | **Mandatory gap.** `worker.js` directly calls Gemini helpers. |
| Platform AI boundary | Not implemented | **Mandatory gap.** Platform-owned AI needs a separate, owner-authorized configuration path. |
| Workflow engine | Not implemented | **Mandatory gap.** Existing lead/task behavior is workflow-specific rather than reusable event-condition-action infrastructure. |
| Usage limits and alerts | Partial metrics only | **Mandatory gap.** No centralized tenant usage budgets, warnings, or hard feature limits. |
| Lead/follow-up foundation | Partially implemented | Tables and basic classification exist; assignment, configurable status, overdue automation, notes, and conversion state are incomplete. |
| Dashboard operations | Partially implemented | Current views expose core conversations, voice records, follow-ups, leads, reports, and owner metrics; the full master dashboard scope is not yet available. |
| Automated testing | Superficial only | The current test file contains placeholder assertions and does not exercise Worker behavior. **Must be replaced.** |
| Migration discipline | Inconsistent | Root `migration-001-audit-mode1.sql`, an archived duplicate, and base-schema instructions conflict. **Must be consolidated safely.** |
| Error-response hygiene | Needs fix | The WhatsApp Worker returns raw `err.message` in a 500 response. **Must be replaced with a safe generic response plus structured internal log.** |
| Sample credential hygiene | Needs fix | The fresh schema contains a demo insert with credential-like placeholders. Fresh production bootstrap must never insert a demo tenant. |

## Critical Findings

### 1. Voice Is Active but Founder Direction Is to Pause It

The current Worker detects audio messages, downloads media, invokes Gemini transcription, writes voice-note records, creates leads/tasks, and sends a reply. The new master specification requires the opposite for the current phase: preserve the voice code and data model but stop transcription, stop voice processing jobs, stop voice-generated AI cost, do not retain raw audio, and write only a safe disabled event if allowed.

**Required remediation:** introduce a centralized `VOICE_EMPLOYEE_ENABLED`, `VOICE_TRANSCRIPTION_ENABLED`, and `VOICE_AUTO_PROCESSING_ENABLED` policy, default all three to `false`, and add a graceful audio-message response path that does not invoke Gemini or create voice processing data.

### 2. Plan Logic and Feature Access Are Not Centralized

The code contains `client_mode` and plan labels, but there is no central `PLAN_ENTITLEMENTS`, `hasFeature`, `getPlanLimit`, or comparable policy layer. This creates a risk that future limits and product rules will be hard-coded across routes.

**Required remediation:** create one versioned entitlement module; make the Worker and portal resolve a tenant’s plan through it. It should define BYOK availability, AI provider mode, team limit, exports, automations, usage limits, and feature access.

### 3. AI Provider Calls Are Coupled to Gemini

Current code directly invokes Gemini helper functions. This makes future OpenAI, Claude, fallback selection, tenant BYOK policy, and platform-owned AI harder to add safely.

**Required remediation:** introduce a provider-router interface while keeping Gemini as the only enabled production adapter. The interface must distinguish customer tenant AI from Maqtomate platform AI and never expose any key to browser code, exports, logs, or GitHub.

### 4. Current Test File Is Not a Real Test Suite

The tracked Node test file only asserts `true === true`. It does not test signature verification, rate limits, database query scoping, encrypted envelopes, sessions, plan policies, dashboard authorization, exports, or payment approval.

**Required remediation:** replace it with isolated unit and integration tests, using mock D1/KV/fetch dependencies and fixtures. Add a CI-ready test command and test coverage report documenting what is exercised.

### 5. Migration and Fresh-Bootstrap Documentation Conflict

The repository currently contains both `backend/migration-001-audit-mode1.sql` and an archived copy. The base schema documentation tells fresh users to skip Migration 001 but also includes columns/tables that Migration 001 adds. This is confusing and can cause failed bootstrap runs. The base schema also inserts a demo tenant with credential-like values.

**Required remediation:** retain legacy Migration 001 only as clearly named historical compatibility material; create an explicit ordered migration manifest; make the fresh schema free of all demo tenants and all runtime credentials; provide an idempotent legacy-credential migration that validates encrypted envelopes before neutralizing plain text fields.

### 6. Error Responses Need Production Sanitization

The WhatsApp Worker currently forms a 500 response with a raw runtime message. Infrastructure, provider, or database internals should never be returned to a sender.

**Required remediation:** return a generic safe error with request ID; log a structured sanitized diagnostic containing category, request ID, tenant reference when safe, and timing—never a secret or raw provider payload.

## Verified Strengths to Preserve

| Strength | Why it must be preserved |
|---|---|
| Session-derived tenant resolution | It prevents a browser-provided client ID from becoming an authorization boundary. |
| Magic-link and hashed session design | It avoids stored customer passwords while preserving revocation and expiry patterns. |
| Tenant secret envelopes | Credentials remain separate from dashboard APIs and can be decrypted only inside server operations. |
| Payment-gated customer activation | It matches the founder’s approved manual payment verification operating model. |
| Signature, dedupe, and rate-limit foundations | These are the correct baseline protections for Meta webhook traffic. |
| Existing lead/task and reporting tables | They can be extended into the workflow/usage model without a data rewrite. |
| Owner/customer separation | It is central to the service promise and must remain enforced server-side. |

## Proposed Backward-Compatible Delivery Sequence

| Release | Content | Production risk |
|---|---|---|
| V1.1-A | Migration manifest cleanup, safe errors, centralized entitlements, feature flags, pause voice | Low; changes are mainly safety and policy controls. |
| V1.1-B | Provider router, tenant provider metadata, legacy plaintext credential migration/neutralization | Medium; require controlled tenant verification. |
| V1.1-C | Workflow event-condition-action tables, usage ledger, lead/task enrichment | Medium; deploy after unit/integration test coverage is established. |
| V1.1-D | Dashboard feature/usage/automation views and owner health controls | Medium; depends on V1.1-C APIs. |
| V1.1-E | Staging validation, Meta/Gemini controlled tests, GitHub release tag, production promotion | Controlled; do not release without passing the production checklist. |

## Production Data Caution

A previous automated smoke test created a non-customer test tenant in the production database. Before V1.1 is launched, identify and deactivate or remove only that known test record through a controlled migration or owner-approved cleanup step. Do not delete any real customer data.

## Definition of Done for V1.1

1. Voice feature flags are default-off and an inbound voice note produces no AI or transcription cost.
2. All plan/feature decisions are made through a single entitlement/policy module.
3. Gemini is accessed through the provider interface, while platform AI and tenant AI are separate scopes.
4. Tenant usage has a centralized ledger, configurable limits, warnings, and feature-limit behavior.
5. Leads and follow-ups support priority, ownership, due status, audit information, and tenant-only access.
6. Migration instructions are unambiguous for both fresh and existing D1 databases.
7. Test suites exercise real behaviors, not placeholder assertions.
8. Errors shown to users are safe and request-ID based.
9. No tracked source file contains a real credential, sample tenant credential, or browser-exposed secret.
10. GitHub and deployed Workers are synchronized only after tests, staging validation, and a formal release checklist pass.
