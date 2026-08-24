# Maqtomate Connector and Reference-Informed Upgrade Roadmap

**Author:** Manus AI  
**Date:** 24 August 2026  
**Status:** Design decision record. This is not authorization to connect customer systems, send messages, or enable unverified channels.

## Decision summary

Maqtomate should become a more capable **managed WhatsApp AI Employee**, not a collection of loosely connected automation demos. The supplied references contain useful product patterns: structured qualification, button-first deflection, knowledge review, human handoff, cost visibility, connection health, and operational dashboards. However, several example implementations are single-tenant, display credentials in automation nodes, assume Google Sheets is a production database, or suggest cost and policy facts that require independent validation. Those shortcuts must not enter Maqtomate.

The safe path is to release the existing customer Google-first onboarding flow first, then build three additive, server-enforced layers: **activation readiness**, **AI outcome and cost telemetry**, and **native WhatsApp Flow qualification**. Every external connector remains behind a tenant-scoped adapter, explicit owner approval, idempotency, audit logging, and a product feature flag.

> “Businesses are required to obtain opt-in before messaging people on WhatsApp.” — Meta’s WhatsApp Business Platform documentation. [1]

> “WhatsApp Flows is a way to build structured interactions for business messaging.” — Meta’s WhatsApp Flows documentation. [2]

## Evidence reviewed

| Source | Product lesson retained | Evidence boundary |
|---|---|---|
| [WhatsApp Automation with n8n playlist][3] | Production-minded workflow design, visible status, human handoff, structured forms, and cost discipline. | n8n demonstrations are not Maqtomate architecture. No node configuration, credentials, or single-tenant workflow may be copied into production. |
| [₹0 WhatsApp Automation That Replies, Sells & Follows Up][4] | Knowledge sources, rule-based behavior, test-before-go-live, and handoff are useful customer-facing concepts. | “Zero cost,” training on past chats, and any global or shared knowledge source are not valid Maqtomate claims or designs. |
| [WhatsApp agent workflow reference][5] | Deterministic tools, inventory/FAQ separation, and an AI fallback pattern are useful. | Google Sheets is not a production multi-tenant datastore; no API key may appear in a client or workflow node. |
| [Account-safety reference][6] | Quality, opt-in, template hygiene, controlled scale-up, and fast human escalation are valuable operating ideas. | The video’s thresholds and appeal statistics are unverified and are not adopted as policy. |
| [AI-cost reference][7] | Button-first and deterministic routing should protect AI spend; customers should see outcome categories. | The cited fee projections and free-window claims must never be hard-coded; Meta’s current platform policy is the source of truth. |
| [Live dashboard reference][8] | Connection health and delivery-state visibility improve operator decisions. | No live dashboard may expose provider credentials, model reasoning, another tenant’s data, or unverified delivery state. |

## Product architecture decisions

### 1. Customer account and activation boundary

The in-progress customer journey remains the first release priority. A customer verifies their identity through their own Google account, creates their own Maqtomate password, selects **customer BYOK** or **managed AI**, submits a manual payment reference, and awaits owner review. This account is intentionally a **pre-tenant prospect account** until a real customer-owned official Meta connection is complete and the owner activates a matching tenant membership.

The owner’s access continues to be isolated at `/owner` through a private password gate followed by Google verification. Customer routes must never show the owner path, owner Google terminology, test sender, personal WhatsApp number, Meta token, Cloudflare access, or any owner credentials.

### 2. Activation readiness layer — next safe implementation

The first next-level product surface should be a customer-safe activation checklist. It will let an approved customer provide the minimum operational information Maqtomate needs to prepare a managed rollout, such as business context, supported hours, approved handoff contact, privacy/opt-in acknowledgement, and preferred AI mode. It must **not** collect Meta passwords, Meta tokens, app secrets, Cloudflare credentials, WhatsApp verification codes, a customer’s WhatsApp number through the public site, Gemini keys, or any owner credential.

The owner reviews readiness in the existing private console. The checklist is a readiness and evidence record, not an automatic Meta connection flow. Official Meta Embedded Signup remains a separate, future connection experience that must be built and verified before public self-service is claimed.

### 3. AI outcome and cost telemetry — next safe implementation

Maqtomate should record a small set of tenant-scoped result categories for each processed conversation path: **deterministic**, **AI-assisted**, **human handoff**, **policy-blocked**, and **failed**. These categories support a customer dashboard that answers operational questions without revealing customer message contents, secrets, full prompts, model reasoning, or internal provider headers.

This layer must remain an honest activity and outcome view, not a fabricated ROI calculator. Managed-AI usage and customer-BYOK usage remain server-resolved through the existing provider policy. A customer selection in the browser must never change the provider, call Gemini, or expose a key.

### 4. Native WhatsApp Flow qualification — gated feature

Meta describes WhatsApp Flows as structured business interactions that can support lead collection and other guided experiences. [2] Maqtomate can later use them for low-risk, tenant-specific service requests and qualification steps that should not require free-form AI. Before release, the feature needs: a tenant-owned official Meta connection; data-minimised Flow schema; opt-in and opt-out treatment; a Flow-to-tenant mapping; an idempotent submission key; signed endpoint validation where applicable; handoff logic; policy and abuse tests; and owner activation.

No financial, health, legal, authentication, credential, or highly sensitive workflow will be enabled by default. A customer dashboard must never claim that a Flow is live until the official Meta API confirms publication and the tenant-scoped test passes.

### 5. Official Meta quality and messaging controls

Meta requires opt-in before businesses message people on WhatsApp and requires that users be told which business they are authorizing, with an intuitive opt-out path. [1] Its current documentation also states that messaging limits are assessed at the business portfolio level, beginning at 250 for newly created portfolios and increasing through defined scaling criteria. [9] Therefore Maqtomate will not copy informal “warm-up” or “block-rate” thresholds from videos. It will later add official-webhook-driven health indications and a manual-review circuit breaker only after the exact Meta events and tenant ownership model are verified.

Template category must also be treated as a provider-controlled compliance and pricing state, not a customer-side label. Meta classifies messages as marketing, utility, or authentication and documents that category changes can be applied to templates. [10] Maqtomate will not promise a template is utility-priced or guarantee any message window, pricing, delivery, or scaling outcome.

## Integration decision matrix

| Integration category | Current purpose | Release decision | Non-negotiable safeguards |
|---|---|---|---|
| **Cloudflare** | Runtime, D1/KV, Worker deployment, service bindings, encrypted server-side operations. | Continue as production foundation. | Keep secrets server-side; use additive migrations; verify bindings and rollback path; never expose account credentials to customers. |
| **Google Gemini** | Server-enforced managed AI or tenant BYOK routing. | Continue as the only current AI provider path. | Provider is selected server-side; BYOK values stay encrypted; no browser API calls; enforce usage and failure controls. |
| **GitHub** | Source control and verified code review. | Continue for tested commits only. | Secret scan before commit; no credentials, customer PII, or production database identifiers in commits. |
| **Semrush and Profound** | Market positioning, SEO, and AI-search visibility research. | Research-only. | Do not publish unverified quantitative SEO claims; do not modify external sites or campaigns. |
| **Taskade** | Product planning and project coordination. | Planning-only until a named workflow is approved. | No customer data sync, live task creation, or automation without a tenant-scoped contract and owner approval. |
| **Make and Zapier** | Future customer-selected CRM, spreadsheet, or business workflow adapters. | Design only; do not connect or execute. | A separate per-tenant OAuth or credential vault, idempotency key, explicit action allowlist, audit event, retry/cancellation policy, and customer approval are required. |
| **Hugging Face, Replicate, Wireflow, Roboflow** | Model discovery and isolated creative/experimental evaluation. | Do not add to Maqtomate runtime now. | No paid prediction, training, customer upload, inference, or external data transfer without explicit approval, an approved model, and a separate privacy/cost review. |

The Make and Zapier connector entries are visible in the user connector configuration, but no server was available in this task session for safe capability inspection. This does not block the product roadmap; it confirms that no workflow action has been taken. The implementation rule remains: **never use every available connector just because it exists**. Each connector must earn its place through a customer outcome, a tenant boundary, and a tested server-side contract.

## Explicitly rejected patterns

| Pattern | Reason it is rejected |
|---|---|
| WhatsApp Web automation, QR automation, personal-number automation, or unofficial libraries | Violates Maqtomate’s official Meta-only product boundary and risks customer accounts. |
| One shared Meta sender, WABA, token, or knowledge base across customers | Breaks customer ownership, tenant isolation, and credential safety. |
| Frontend Gemini, Meta, Sheets, database, or automation-provider keys | Exposes credentials and permits unauthorized use. |
| Google Sheets as the primary customer conversation or transaction database | Does not provide the concurrency, tenant isolation, access control, or audit model required for this SaaS. |
| Fake customer reviews, fabricated delivery indicators, invented cost savings, or unverified “free” claims | Misleads customers and violates Maqtomate’s evidence-first sales policy. |
| Voice calls, recordings, CRM writes, Excel sync, Instagram, or Messenger marketed as live features before official connection, consent, storage, retention, and end-to-end validation | These remain feature-gated future capabilities. |

## Delivery sequence

| Sequence | Scope | Release condition |
|---:|---|---|
| 1 | Customer Google-first sign-in, password creation, payment review, customer-safe pricing, server-enforced AI-mode choice. | Google OAuth customer callback is configured; test suite and route checks pass; owner gate remains intact. |
| 2 | Customer activation-readiness checklist and private owner review view. | Additive schema, origin and authorization tests, pre-tenant state checks, and no credential collection. |
| 3 | AI outcome and usage telemetry. | Tenant-only query enforcement, no prompt/secret exposure, clear data-retention decision, and regression coverage. |
| 4 | WhatsApp Flow prototype for an owner-approved low-risk qualification use case. | Official Meta connection, Flow publication proof, opt-in/opt-out controls, idempotency, and end-to-end tenant test. |
| 5 | Named CRM/spreadsheet workflow connector. | The user chooses a named provider and action; per-tenant authorization, adapter contract, idempotency, retries, audit, cancellation, and customer consent are complete. |
| 6 | Voice, recording, Messenger, Instagram, and advanced outbound follow-up. | Separate provider, consent, retention, cost, policy, and full end-to-end evidence gates are passed. |

## References

[1]: [Meta for Developers — Get opt-in for WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in)

[2]: [Meta for Developers — WhatsApp Flows](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows)

[3]: [Lakshit Ukani — WhatsApp Automation with n8n playlist](https://www.youtube.com/playlist?list=PLSyxJTtV97zmuOnEojXRV6XDTIyV76ZJH)

[4]: [₹0 WhatsApp Automation That Replies, Sells & Follows Up](https://youtu.be/PX9qhPehpXU)

[5]: [Supplied WhatsApp agent workflow reference](https://youtu.be/zQM2HgNTBCs)

[6]: [Lakshit Ukani — Why WhatsApp Is Banning Business Accounts](https://www.youtube.com/watch?v=6gv36PhoQog)

[7]: [Lakshit Ukani — Your WhatsApp Bot Is Wasting Money on AI](https://www.youtube.com/watch?v=CGgzE1_2dv4)

[8]: [Lakshit Ukani — See What Your WhatsApp Bot Is Really Doing](https://www.youtube.com/watch?v=SpVyKJ1cmM0)

[9]: [Meta for Developers — Messaging Limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits)

[10]: [Meta for Developers — Template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization)
