# Maqtomate V2 Proposal Compatibility Audit

**Status:** Initial evidence review complete; **do not overwrite the live Worker, execute the submitted full schema, or deploy the submitted Wrangler file.**

## Current production baseline

The live Maqtomate Worker uses `MAQVORA_DB`, `MAQVORA_KV`, the `clients` tenant model, `tenant_whatsapp_connections`, and AES-GCM `tenant_secret_envelopes`. The submitted V2 Worker instead expects `DB`, `KV`, `tenants`, `tenant_secrets`, and `channel_connections`. These are incompatible contracts. Replacing `worker.js` would break verified Portal-to-Worker controls, tenant lookup, encrypted credential storage, owner-test sender handling, and current webhook routes.

A read-only production D1 catalog confirms that all deployed tenancy and operational tables use `client_id INTEGER` and foreign keys to `clients(id)`. Production already has `voice_notes`, `lead_data`, `follow_up_tasks`, `tenant_voice_settings`, `tenant_voice_metrics_daily`, and feature overrides. It does **not** have the V2 proposal's `tenants`, `tenant_secrets`, `channel_connections`, `conversations`, `messages`, or `call_sessions` contract. This confirms an additive `client_id`-based extension is mandatory.

The submitted Wrangler configuration contains literal placeholder IDs for D1 and KV. Deploying it would replace the real bindings with invalid values. Its proposed `AI`, R2, Vectorize, and Queue bindings are not currently implemented safely in the active Worker and therefore cannot be added as an untested all-at-once production deployment.

The submitted `d1-schema.sql` is a standalone alternate schema, not an additive migration for the existing production D1 database. It uses different table names and primary-key types and includes Markdown-style `#` headings, which are not SQLite comments. It must not be run against production.

## External capability findings

Cloudflare supports Workers AI, Vectorize, R2, and Queues bindings, but they are usage-metered services rather than an unlimited zero-cost stack. Workers AI includes 10,000 Neurons per day on the Free plan, R2 includes 10 GB-month storage and operation allowances, Vectorize has included dimension limits, and Queues has a 10,000-operation daily free allowance. [1] [2] [3] [4]

The V2 claim that a simple `POST /{phone-id}/calls` body can initiate a complete AI call is incomplete. Meta’s Calling API requires calling to be enabled for the business number, the `calls` webhook subscription, required permissions, user call permission for business-initiated calls, and a compliant WebRTC SDP offer/answer and media path. Recording and transcription require explicit opt-in and an announcement purpose/language. [5] [6] [7]

## Decision table

| Submitted element | Decision | Reason |
|---|---|---|
| Replace `worker.js` | **Reject** | Incompatible tenant, D1, KV, secret-envelope, and route contracts. |
| Replace `wrangler.toml` | **Reject** | Contains invalid placeholder IDs and would erase required production configuration. |
| Execute full `d1-schema.sql` | **Reject** | Alternate schema, non-additive, invalid SQL headings, and production-data risk. |
| `call_sessions`/`voice_jobs` foundation | **Candidate after schema-first design** | Must be additive to `clients`/`client_id` model, tenant-scoped, consent-aware, and feature-gated. |
| R2 recording storage | **Defer** | Need approved retention policy, consent, signed access, usage limits, and actual recording webhook validation. |
| Workers AI transcription | **Defer** | Existing owner policy has voice processing paused; enable only after explicit cost and retention controls. |
| Vectorize/RAG | **Defer** | Useful after customer knowledge-base upload, chunking, embeddings, deletion, and access policy exist. |
| Cloudflare Queues | **Candidate later** | Requires queue resources, idempotent consumer code, dead-letter handling, and operational budget. |
| WhatsApp Calling API | **Roadmap only** | Requires Meta eligibility, calling enablement, WebRTC media architecture, customer permission, and recording consent. |

## Approved V2 integration design

The safe V2 direction is to preserve `clients` as the canonical tenant table and extend the existing voice foundation in a disabled-safe state:

| Foundation | Approved production model | Default state |
|---|---|---|
| Call-session metadata | New `whatsapp_call_sessions` table with `client_id`, unique external call ID, status machine, call-permission state, and consent metadata | Schema only; no calls initiated |
| Media metadata | New `tenant_media_assets` table with `client_id`, opaque object key, content metadata, retention timestamp, and deletion state | Schema only; no raw media persisted |
| Recording storage | R2 object keys only; never public URLs; presigned retrieval and tenant authorization required later | No binding or upload until retention/consent implementation |
| Voice transcription | Existing `voice_notes` and global voice flags remain authoritative | Disabled |
| Knowledge/RAG | Separate D1 document metadata and tenant-scoped vector namespace design | Deferred until upload/deletion and budget flow are implemented |
| Background sync | Existing idempotency and usage controls remain source of truth; Queues consumer must be a separate tested handler | Deferred |
| Calling | Meta Calling API adapter with user call permission, call settings, SDP/WebRTC handling, recording purpose/language, and strict geography/eligibility checks | Deferred |

The submitted V2 Worker’s hard-coded `POST /{phone-id}/calls` payload is not an implementation of Calling API media handling. In particular, it lacks required user permission, SDP offer/answer, media handling, recording announcement, and call-state controls. Calling remains disabled until those operational and consent contracts are implemented and independently verified. [5] [6] [7]

## Safe next implementation sequence

1. Finish the current dedicated Maqtomate sender credential renewal and controlled inbound-text proof.
2. Add a versioned, additive `migration-008-v2-voice-foundation.sql` that extends the live `client_id` schema and stays disabled by default.
3. Add provider-neutral call-session and media-asset metadata behind disabled feature flags, with no raw-media retention by default.
4. Add R2 and Workers AI only with tenant-scoped controls, retention configuration, per-tenant usage metering, and tests.
5. Implement calling only as a separately approved Meta Calling API project, including WebRTC/media design, user permission flow, recording disclosure, and country/eligibility checks.

## Implemented safe V2 foundation

On 21 August 2026, the reviewed additive migration `migration-008-v2-call-media-foundation.sql` was applied to production D1 after the full regression suite passed (**37/37**). It created only these empty metadata tables and indexes:

| Created structure | Purpose | Activation state |
|---|---|---|
| `whatsapp_call_sessions` | Tenant-scoped future call lifecycle, call-permission, and consent metadata | No calling runtime exists or is enabled |
| `tenant_media_assets` | Tenant-scoped opaque future object metadata and retention/deletion tracking | No R2 binding, upload, URL, or raw media storage is enabled |
| Four tenant-aware indexes | Efficient client-scoped retrieval and retention work when future features are approved | No job, Queue, or cron consumes them |

Production D1 verification confirmed both tables and all four indexes exist. No tenant records, call records, media records, provider credentials, or personal phone data were inserted or changed.

The live Worker’s unauthenticated `/api/health` request correctly returned `401 Unauthorized`, confirming the existing bearer-token boundary remains in place. The submitted V2 `/health` endpoint was not deployed, and neither the submitted Worker nor its placeholder binding configuration was used.

## References

[1]: https://developers.cloudflare.com/workers-ai/platform/pricing/
[2]: https://developers.cloudflare.com/r2/pricing/
[3]: https://developers.cloudflare.com/vectorize/platform/pricing/
[4]: https://developers.cloudflare.com/queues/platform/pricing/
[5]: https://developers.facebook.com/documentation/business-messaging/whatsapp/calling
[6]: https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/reference
[7]: https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/user-call-permissions
