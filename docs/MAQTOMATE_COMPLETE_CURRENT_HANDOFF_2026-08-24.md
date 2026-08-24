# Maqtomate — Complete Current Product, Technical, and Launch Handoff

**Prepared:** 24 August 2026, Pakistan time  
**Product status:** Production Portal released; customer Google-first onboarding is live; official end-to-end WhatsApp reply proof remains a launch blocker.  
**Audience:** Maqtomate owner and future authorized implementation agents.  
**Repository:** [`maqsoodahmedburiro123-commits/Maqtomate`](https://github.com/maqsoodahmedburiro123-commits/Maqtomate)  
**Latest synchronized commit:** `14f02cc` — `feat: release customer Google onboarding and readiness gates`  
**Latest Portal production version:** `3e3849d2-ff11-4eb9-ac44-0ff63eb42380`

> **Important:** This is a secret-safe handoff. It intentionally excludes all passwords, API keys, Meta access tokens, Cloudflare tokens, OAuth secrets, encryption keys, OTPs, raw personal numbers, recipient identities, and internal database identifiers. A future agent must preserve that boundary.

---

## 1. Executive truth

Maqtomate is being built as a **secure, multi-tenant, managed WhatsApp AI Employee SaaS**. Its purpose is to help a business manage official WhatsApp conversations with supervised AI responses, lead qualification, handoff to people, follow-up context, and operational reporting. It is **not** a WhatsApp Web automation tool, QR-code session bot, personal-number automation product, or generic demo chatbot.

The public product site, private owner gate, owner operational console, tenant-security foundation, customer Google-first onboarding, manual payment-review gate, activation-readiness record, and server-enforced Gemini policy are live. A customer may now establish a Google-verified identity, choose a Maqtomate password, choose an offer and AI mode, submit a manual payment reference, and remain in a pre-tenant review state until the owner completes the official connection process.

The most important remaining launch dependency is not design or marketing. It is a recorded, repeatable proof of the official WhatsApp loop using the dedicated Maqtomate test sender:

```text
Official WhatsApp message or controlled test
        ↓
Meta Cloud API webhook
        ↓
Signature validation + tenant resolution
        ↓
Server-enforced Gemini policy
        ↓
Official WhatsApp reply
        ↓
Redacted, tenant-scoped audit evidence
```

Until that proof is complete, Maqtomate must not claim that live AI replies, call handling, voice processing, CRM synchronization, Excel automation, recordings, Messenger, or Instagram automation are generally available.

| Product layer | Current state | Accurate description |
|---|---|---|
| Public website | **Live** | Original marketing site for a managed WhatsApp AI Employee. |
| Customer authentication | **Live** | Google-first identity verification plus customer-created password. |
| Customer activation | **Live, supervised** | Payment reference, owner review, readiness record, managed connection, then tenant activation. |
| Owner access | **Live, private** | Password gate first, then Google owner verification. |
| Tenant foundation | **Live** | Membership-scoped access, encrypted secret envelopes, D1/KV, rate controls, redacted audit events. |
| Managed Gemini route | **Live policy** | Server chooses managed AI or tenant BYOK; browser choice cannot invoke a model. |
| WhatsApp end-to-end proof | **Pending** | Dedicated test sender setup is present, but final delivery and AI-reply evidence is not complete. |
| Voice, calls, recordings, CRM, Excel sync, Messenger, Instagram | **Deferred** | Feature-gated future work only. |

---

## 2. Business position and customer promise

Maqtomate should be sold as a **managed official WhatsApp AI Employee**. The practical customer promise is not “instant automation.” It is a supervised system that is designed around the customer journey, approved business knowledge, qualification rules, human handoff, security boundaries, and official business assets.

The public commercial offers are intentionally limited to the following two customer-safe paths:

| Public offer | Commercial position | Activation boundary |
|---|---|---|
| **Managed Launch** | Rs 5,000 setup and Rs 2,000 monthly for a small-business managed official rollout. | Payment begins review; it does not create an instant bot or shared sender. |
| **Custom Business Rollout** | Quoted after review for more volume, languages, complex workflows, or separately approved integrations. | Requires a scoped managed design and owner approval. |

The previously exposed public VIP offer was removed. No customer offer may imply that the customer can use the owner’s Meta business access, dedicated test sender, owner WhatsApp account, private recipient number, tokens, Cloudflare account, or any other owner credential.

> **Positioning rule:** Every client operates with their own official business assets. Maqtomate never shares the owner’s personal WhatsApp, Meta sender, or credentials with a customer.

---

## 3. Live public and protected entry points

| Surface | URL | Purpose | Access boundary |
|---|---|---|---|
| Public website | https://maqtomate-portal.moviesmaqxanimation.workers.dev/ | Product introduction and conversion surface. | Public |
| Product | `/product` | Explains the WhatsApp AI Employee model. | Public |
| Workflow | `/how-it-works` | Explains the managed rollout sequence. | Public |
| Use cases | `/use-cases` and industry routes | Presents safe industry-level workflows. | Public |
| Pricing | `/pricing` | Shows Managed Launch and Custom Business Rollout. | Public |
| Security | `/security` | Explains high-level protection and isolation. | Public |
| Resources | `/resources` | Educational content surface. | Public |
| Rollout request | `/connect` | Privacy-minimised planning request. | Public |
| Customer sign-in | `/login` | Customer email/password sign-in only. | Customer-only |
| Customer sign-up | `/signup` | Google identity verification before password setup. | Customer-only |
| Customer onboarding | `/onboarding/setup` and `/onboarding` | Pre-tenant setup, payment and readiness review. | Authenticated customer-only |
| Customer dashboard | `/dashboard` | Only for activated tenant memberships. | Active tenant membership required |
| Owner Console | `/owner` | Private fleet, readiness, connection and approval operations. | Owner password gate, then owner Google verification |
| Core Worker | https://maqtomate-worker.moviesmaqxanimation.workers.dev/ | Official Meta webhook and protected core services. | Public webhook, otherwise protected |
| Manus Owner Center | `manus-webdev://683b96f9` | Separate internal operational dashboard project. | Manus owner-only |

The owner route is deliberately absent from customer navigation and customer copy. A visit to `/owner` without the owner gate returns the private password screen. A direct unauthenticated owner API request fails closed and returns no owner data.

---

## 4. Customer journey: identity to live tenant

The key concept is that a **customer account is not a live WhatsApp tenant**. Customer identity, payment review, and business-readiness information must remain separate from the live `clients`/tenant model until a legitimate customer-owned official WhatsApp connection exists.

```text
Customer visits /signup
        ↓
Google verifies the customer’s Gmail or business email identity
        ↓
Customer creates their own Maqtomate password
        ↓
Customer chooses offer and AI preference
        ↓
Pre-tenant onboarding request is created
        ↓
Customer submits a manual payment reference
        ↓
Owner reviews payment and changes status to connection planning
        ↓
Managed official Meta / WhatsApp connection process
        ↓
Owner creates or confirms an active, real customer tenant
        ↓
Owner activates matching tenant membership
        ↓
Customer receives only their isolated operating dashboard
```

| Customer state | Customer can do | Customer cannot do |
|---|---|---|
| Google identity established | Create password and submit onboarding information. | Access another customer’s request, dashboard, or owner data. |
| `payment_pending` | Review selected plan, submit payment reference, complete readiness information. | Run WhatsApp automation, invoke AI, access a tenant dashboard. |
| `payment_submitted` | See review status. | Activate a tenant or self-connect a sender. |
| `connection_pending` | See concise managed-connection status. | Access operational WhatsApp data. |
| `connection_ready` | Await final owner activation. | Use an unapproved tenant or sender. |
| `active` | Use their tenant-scoped dashboard through an active membership. | View owner tools, other tenants, raw credentials, or provider secrets. |
| `rejected` or `cancelled` | Receive minimal status/support guidance. | Reactivate or change privileged state themselves. |

### 4.1 Customer Google identity and password

Customer sign-up uses a separate Google OAuth flow, including its own state and nonce cookies and its own callback route. It does not pass through, inherit, or bypass the owner password gate. The customer Google app configuration is now **External** and **In production**, with both required callback routes configured:

| OAuth use | Callback role |
|---|---|
| Owner identity | Existing private owner callback remains retained. |
| Customer identity | Separate customer callback establishes the customer pre-tenant session. |

Passwords are processed by server-side PBKDF2-SHA-256 with unique salts and a high iteration setting. Passwords are never written to logs, browser storage, emails, audit records, GitHub, or chat. Sessions remain opaque hashed sessions rather than browser-readable identity tokens.

### 4.2 Email delivery limitation

Customer Google identity is the live verification path. Generic customer email verification and password-reset delivery remain **not yet publicly available** because the email provider requires a verified sender/domain. The related code and secure token model exist, but Maqtomate must not claim that arbitrary Gmail verification or reset emails are reliable until a verified sender address has been configured and tested.

### 4.3 Payment review and tenant activation

Payments are currently **manual**. The system does not create fake transactions, automatic invoices, or automatic activation. A customer payment reference changes only their own authenticated pre-tenant request from `payment_pending` to `payment_submitted`.

Only the protected owner role may approve, reject, or activate an onboarding request. Payment approval moves a request to managed connection planning; it does not create a sender, inject a token, or create an operational customer tenant. Activation requires a real active tenant matching the requested AI mode and explicitly rejects the canonical owner test tenant.

### 4.4 Activation-readiness record

The activation-readiness layer is now deployed. It gathers only the minimum business-operational information needed for a managed rollout:

| Stored readiness field | Why it is collected |
|---|---|
| Service summary | Helps define an approved support/qualification scope. |
| Operating hours | Helps design handoff and availability expectations. |
| Human-handoff email | Identifies where approved escalations should go. |
| Opt-in acknowledgement | Records that the customer recognizes consent/opt-in responsibilities. |
| Readiness status | Allows owner review: submitted, reviewed, accepted, or changes requested. |

The readiness layer does **not** collect Meta passwords, Meta access tokens, App Secrets, Cloudflare credentials, WhatsApp OTPs, customer WhatsApp verification codes, personal phone numbers, or Gemini API keys. It does not create a tenant or membership.

---

## 5. Owner journey and private operational controls

The owner has a separate private route and must complete two distinct controls:

```text
/owner
  → private owner password gate
  → Google identity verification for allowed owner account(s)
  → secure owner console
```

The customer `/login` page intentionally does not reveal this path, owner email identities, owner Google terminology, test-sender metadata, or owner operational controls.

| Owner Console function | Present state | Security treatment |
|---|---|---|
| Owner login | Live | Password gate first, then allowlisted Google identity with state/nonce validation. |
| Runtime health | Live | Coarse safe state only; never secret values. |
| Test sender metadata | Live | Metadata only, no raw token output. |
| Token validation/renewal pathway | Live foundation | One-time protected input, server validation and encryption, no browser echo. |
| Controlled outbound test | Implemented | Server-only recipient/message boundary and redacted audit result. Do not retry without owner approval. |
| Customer onboarding queue | Live | Owner can see status and readiness state, not passwords or provider credentials. |
| Payment approval / rejection / activation | Live | Server-side owner authorization and state checks. |
| Tenant dashboard/fleet overview | Live foundation | Role-scoped, redacted, and tenancy-aware. |

The **Maqtomate Owner Test Tenant** remains the owner’s payment-exempt, customer-equivalent workspace. It must never be treated as a customer tenant or assigned to a customer activation. The owner’s personal WhatsApp remains recipient-only and must never be registered, migrated, disconnected, displayed publicly, or used as an API sender.

---

## 6. Current technical architecture

```text
Public visitors and customers
        │
        ▼
Maqtomate Portal Worker
├─ Public marketing routes
├─ /connect privacy-minimised rollout intake
├─ Customer login, Google sign-up, password and pre-tenant onboarding
├─ Owner password gate and private Owner Console
└─ Private service binding for owner-sensitive core actions
        │
        ▼
Maqtomate Core Worker
├─ Meta webhook verification
├─ Tenant and membership authorization
├─ Gemini AI policy routing
├─ Encrypted credential envelopes
├─ KV-backed duplicate/rate safeguards
├─ Redacted audit events
└─ OwnerTestCredentialBridge RPC
        │
        ▼
Cloudflare D1 and KV
```

| Component | Role |
|---|---|
| `portal-worker.js` | Public website, customer authentication/onboarding, rollout intake, private owner console, controlled Portal-to-core calls. |
| `worker.js` | Core WhatsApp webhook logic, tenant routing, AI provider enforcement, credential-vault logic, audit and owner bridge controls. |
| Cloudflare D1 | Tenant metadata, memberships, onboarding records, readiness records, rollout requests, audit and workflow foundations. |
| Cloudflare KV | Rate limiting, duplicate-message prevention, and runtime safeguards. |
| Cloudflare Service Binding | Private Portal-to-core owner operation trust boundary; replaces the old public/shared-secret bridge pattern. |
| GitHub | Source control. Only tested, secret-scanned source is synchronized. |
| Manus Owner Center | Separate internal dashboard, latest listed checkpoint `683b96f9`. |

### 6.1 Tenant isolation and credentials

Tenant context must always be derived from an authenticated membership or owner authorization, not from a browser-provided tenant ID. Customer connections, conversation data, exports, usage, workflows, AI settings, readiness records, and future integrations must be scoped to that server-derived tenant context.

Sensitive WhatsApp/Meta credentials use AES-GCM encrypted server-side envelopes. Browsers may receive redacted connection status but never full access tokens. The owner renewal path is intentionally a one-time masked input that validates and encrypts server-side rather than exposing stored credentials.

### 6.2 Meta webhook and runtime safeguards

The core Worker validates Meta webhook signatures and fails closed before AI/provider activity. Duplicate controls and rate limits execute before AI generation. Raw provider errors are not returned to senders. Redacted audit records preserve operational evidence without logging message bodies, recipients, secrets, or token material.

### 6.3 AI model and policy

The current managed model is **Google Gemini `gemini-3.6-flash`**. AI mode selection is server-enforced:

| Requested customer choice | Server policy |
|---|---|
| Customer Gemini BYOK | The live tenant must have its own securely stored eligible credential. If it does not, AI fails closed rather than consuming owner/platform AI. |
| Managed Gemini allowance | The server may use approved platform-managed Gemini according to the tenant plan, limits, and policy. |

No browser UI selection, cookie, query parameter, or JavaScript code may choose the provider, submit an API key, or call Gemini directly. Managed or BYOK provider policy is authoritative in the server-side plan configuration and AI router.

---

## 7. Security and privacy invariants

These rules are non-negotiable and apply to all future work.

| Invariant | Required outcome |
|---|---|
| Official WhatsApp only | Use Meta WhatsApp Cloud API and approved official Meta flows only. Never use WhatsApp Web, QR automation, unofficial libraries, personal-account automation, or session hijacking. |
| Personal-number protection | The owner’s personal WhatsApp is recipient-only and never becomes a sender, tenant asset, or onboarding field. |
| Server-only secrets | Tokens, API keys, passwords, OAuth secrets, encryption material, OTPs, and account credentials never enter the browser, GitHub, screenshots, or chat. |
| Customer-owned business assets | A customer uses their own official business assets during the managed connection process; owner assets are never reused. |
| Strict tenant isolation | Customer data, records, exports, dashboards, usage and integrations are derived from server authorization, never a user-controlled identifier. |
| Pre-tenant boundary | Customer account, payment, and readiness records do not become a live WhatsApp tenant until owner activation of a real customer tenant. |
| Evidence-first marketing | No fake reviews, testimonials, customer counts, delivery claims, ROI, traffic, rankings, backlinks, or cost-savings claims. |
| Feature truthfulness | Voice, calling, recording, transcription, CRM/Excel, Messenger, Instagram, and Embedded Signup remain gated until implemented and verified. |

> **Credential principle:** a “healthy,” “configured,” “readable,” or “validated” runtime state may be displayed as a coarse status, but it never authorizes reading, copying, showing, rotating, or writing a secret outside its protected server-side operation.

---

## 8. Production deployment and source control record

| Item | Verified state |
|---|---|
| Portal release version | `3e3849d2-ff11-4eb9-ac44-0ff63eb42380` at 100% production traffic. |
| Latest source commit | `14f02cc` on GitHub `main`. |
| Customer-account migration | Applied additively to production D1 before release. |
| Activation-readiness migration | Applied additively to production D1 before release. |
| Deployment variables | Preserved through the Portal release process; no secret values were replaced or printed. |
| Source integrity | Final whitespace and credential-literal scan passed. |
| Customer onboarding regression | Covered by focused customer-account tests. |
| Full core/Portal regression suite | Passed **49/49** tests for the release. |

The tests cover customer-login privacy, customer Google initiation separation, password-derivation/source checks, pre-tenant activation rules, payment/activation boundaries, public credential-collection prohibitions, readiness opt-in, owner console behavior, owner login privacy, webhook checks, tenant isolation, duplicate prevention, rate limiting, encrypted credentials, manual payment routes, public site policy, and AI/voice feature gates.

### 8.1 Production route verification on this release

| Route | Verified outcome |
|---|---|
| `/login` | Customer email/password only; no owner or customer Google wording. |
| `/signup` | Google-first customer sign-up page rendered; no owner wording or credential intake. |
| `/owner` | Private owner password gate rendered before owner Google verification. |
| `/api/owner/overview` | Unauthenticated request denied with no owner data. |
| `/pricing` | Managed Launch and Custom Business Rollout displayed with supervised activation boundary. |
| `/connect` | Privacy-minimised business-planning form; rejects credential and personal-number collection. |
| `/auth/customer/google` | Redirected to the distinct customer OAuth callback with customer-specific state and nonce cookies. |

A first cache-busted `/signup` request briefly returned a route-not-found response during edge propagation; both subsequent direct and fresh cache-busted checks rendered the expected sign-up page. This is recorded as a transient deployment-propagation anomaly, not an ongoing route defect.

---

## 9. Connectors, research, and what “use all connectors” means safely

The correct approach is not to connect every available service to the live SaaS. A connector is only useful when it solves a defined customer outcome with tenant isolation, server-side authentication, idempotency, audit visibility, cancellation/retry behavior, and explicit owner approval.

| Connector or service | Current role | Current decision |
|---|---|---|
| Cloudflare | Production runtime, D1, KV, Workers, service bindings. | Continue as core infrastructure. |
| Meta WhatsApp Cloud API | Official transport, webhook, sender and future Flows. | Continue; complete dedicated sender proof before wider claims. |
| Google OAuth | Owner and customer identity. | Live. Keep secrets server-side. |
| Google Gemini | Managed AI and future tenant BYOK routing. | Live server-side provider policy. |
| GitHub | Source control and code synchronization. | Continue only after tests and secret scans. |
| Resend | Legacy magic-link / future action-email delivery. | Customer reset/verification waits for verified sender domain. |
| Semrush and Profound | SEO/AI-search research. | Research-only. Current Semrush plan does not grant MCP access. |
| Taskade | Product planning. | Planning-only until a named, approved workflow is chosen. |
| Make and Zapier | Future CRM, spreadsheet, or workflow adapters. | Do not connect or execute yet. |
| Hugging Face, Replicate, Wireflow, Roboflow | Model and creative experimentation. | Do not add to live runtime or send customer data without separate approval/privacy/cost review. |

### 9.1 Reference-video research lessons

The supplied YouTube references and automation playlist contributed useful ideas: structured qualification, deterministic routing before AI, reviewed knowledge, human handoff, cost awareness, connection health, and customer-facing operational clarity. They did **not** authorize copying single-tenant demo patterns, placing secrets in workflow nodes, using Google Sheets as a tenant database, sharing knowledge across businesses, or making “zero cost” claims.

Meta’s official documentation states that businesses need user opt-in before messaging people, and documents WhatsApp Flows as structured interactions for business messaging. These are future product foundations, not presently enabled customer claims. [1] [2]

---

## 10. What is completed, incomplete, and deliberately deferred

### 10.1 Completed or deployed

| Area | Delivered capability |
|---|---|
| Public SaaS site | Product, workflow, vertical use cases, pricing, security, resources, connect form, robots and sitemap. |
| Pricing safety | Two public offers only; no shared owner-asset implication. |
| Public intake | Consent-aware, rate-limited, privacy-minimised rollout request. |
| Owner protection | Password-first private gateway followed by Google owner verification. |
| Customer identity | Separate Google-first customer sign-up and customer password setup. |
| Pre-tenant onboarding | Offer, AI preference, payment-reference, readiness and owner-review model. |
| Payment activation gate | Manual approval before connection/tenant activation. |
| Readiness gate | Minimal operational readiness/opt-in record, visible only in owner queue. |
| Tenant security | Membership isolation, encrypted credential envelopes, D1/KV safeguards, redacted audit design. |
| Managed AI policy | Gemini routing and BYOK versus managed mode enforced server-side. |
| Owner test foundation | Payment-exempt tenant, dedicated sender metadata, encrypted vault, protected outbound test path. |
| Source synchronization | Verified release committed and pushed to GitHub. |

### 10.2 Incomplete or externally dependent

| Item | Reality today | Required next step |
|---|---|---|
| Official WhatsApp AI reply proof | Dedicated test setup exists; end-to-end delivery and reply evidence remains incomplete. | Verify Meta test-recipient and webhook prerequisites, then request owner approval for one controlled test. |
| Inbound WhatsApp loop | Do not claim it as proven. | Record a real sequence from inbound message through AI response and audit evidence. |
| Customer password reset/verification email | Secure token tables/code exist, but generic sender is not verified. | Configure a verified Resend sending domain/address, then test delivery and expiry flows. |
| Official self-service Embedded Signup | Not built or marketed as live. | Separate Meta-approved design and end-to-end tenant-isolation implementation. |
| Automated payment collection | Not live. | Select provider, commercial policy, refunds/tax handling, webhook design, and tests first. |
| Customer operating dashboards | Live tenant dashboard foundation exists; mature product modules remain a programme. | Build only after official connection evidence. |
| Quantitative SEO | Ahrefs browser was CAPTCHA-blocked; Semrush plan lacks MCP access. | Use an authorized source before publishing metrics. |

### 10.3 Deliberately feature-gated

| Feature | Why it is not enabled now |
|---|---|
| WhatsApp Flows | Needs official tenant connection, opt-in/opt-out, schema minimisation, idempotency, owner activation and tests. |
| Voice note transcription | Needs consent, retention, provider selection, cost controls and end-to-end proof. |
| Calling and recording | Needs official API/provider path, consent, legal/privacy review, retention, price model and tests. |
| Messenger and Instagram | Needs a separately approved official channel/permission model and tenant isolation. |
| CRM/Excel/Google Sheets sync | Needs named customer-approved provider, OAuth/vault model, data mapping, retries, idempotency, audit and cancellation. |
| R2, Vectorize, Workers AI, Queues | Foundation-only until separate tenant-scoped design, cost and retention decisions are approved. |

---

## 11. Recommended next sequence

### Priority 1 — Prove the official WhatsApp loop

The next engineering goal is the verified dedicated sender path. Confirm the dedicated Maqtomate test sender’s Meta recipient and `messages` webhook prerequisites in the official Meta UI. Do not change unrelated Meta assets, recreate credentials, or add a personal number as a sender. When the owner expressly approves, perform **one** controlled test only and record coarse redacted evidence: requested, accepted/rejected, and confirmed recipient result. If the owner confirms a failure, diagnose the actual provider requirement before another send.

### Priority 2 — Complete customer email operations safely

Configure a verified email sender domain/address for the Portal. Then test account verification and password-reset messages with a non-owner account. The test must verify token expiration, one-time use, generic non-enumerating responses, rate limits, and no credential leakage. Until then, Google remains the customer identity entry route.

### Priority 3 — Build official Meta Embedded Signup as a separate project

Do not bolt credential forms into the existing customer UI. Build an official Meta Embedded Signup plan with app permissions, backend token exchange, tenant mapping, consent, safe progress states, error handling, audit events, and end-to-end tenant isolation tests. Public self-service connection must not be claimed before that work is verified.

### Priority 4 — Add honest tenant outcome telemetry

Add tenant-scoped outcome categories for deterministic paths, AI-assisted responses, human handoffs, policy blocks, and failures. Exclude raw customer messages, prompts, model reasoning, internal headers, secrets, and unverified ROI calculations. Use this to support a customer-safe operational dashboard only after retention and access decisions are explicit.

### Priority 5 — Prototype one low-risk WhatsApp Flow

After a real customer-owned official connection is available, build one owner-approved, opt-in-aware, data-minimised Flow for a low-risk qualification or service-request use case. No financial, health, legal, authentication, credential, or highly sensitive workflow should be enabled by default. Prove publication, submission mapping, idempotency, handoff, opt-out and tenant isolation before promoting it.

### Priority 6 — Connect one named business workflow only when approved

Do not broadly “use Make/Zapier/Sheets.” Ask for one named provider and one named action, such as “create a CRM lead after qualified consented customer request.” Build a tenant-scoped server adapter with per-tenant authorization, allowlisted action, idempotency key, audit event, cancellation, retry policy and customer approval before executing anything externally.

---

## 12. Future-agent operating rules

A future agent should use this decision framework before changing anything:

| Question | Required answer before implementation |
|---|---|
| Is it official Meta Cloud API work? | If no, reject it. |
| Does it expose or request a credential in a browser, chat, source file or public form? | If yes, redesign it. |
| Does it create or access customer data? | Identify tenant authorization, ownership, minimisation, retention and audit behavior first. |
| Does it send a message, payment, external write or modify a provider setting? | Obtain explicit owner approval for that specific action. |
| Does it claim a result? | Cite verified evidence, or frame it as future/gated. |
| Does it involve voice, recordings, social channels, CRM, exports or third-party automation? | Treat it as a separate feature-gated project. |
| Does it touch production D1? | Use additive migration, compatibility check, tests, verified target, and post-migration confirmation. |

Before any Portal/Core release, run the following checks locally and do not publish with a failure:

```bash
cd /home/ubuntu/maqtomate/worktree
node --check portal-worker.js
node --test test/*.test.mjs test/unit/*.test.mjs
git diff --check
```

Then perform a focused live verification of customer login, signup, owner gate, protected owner API, pricing, and public connect form. Scan the staged diff for credential literals before committing. Never commit temporary migration request JSON, any token, any secret, personal information, or production screenshots that expose sensitive content.

---

## 13. Key files for future work

| File | Responsibility |
|---|---|
| `portal-worker.js` | Portal public site, customer account flow, onboarding, owner gate/console and private bridge calls. |
| `worker.js` | Core Meta webhook, tenant resolution, Gemini routing, encrypted secrets and redacted audit logic. |
| `wrangler.portal.toml` | Portal bindings and runtime configuration references. |
| `wrangler.toml` | Core Worker binding/configuration references. |
| `services/ai/router.js` | Server-side AI provider policy layer. |
| `config/plans.js` | Server-side plan entitlement and feature-gate configuration. |
| `backend/migration-010-customer-accounts-and-onboarding.sql` | Customer password fields, account action tokens and pre-tenant onboarding request model. |
| `backend/migration-011-customer-activation-readiness.sql` | Additive readiness record with opt-in acknowledgement and owner-review statuses. |
| `test/customer-account-onboarding.test.mjs` | Customer privacy, Google initiation, pre-tenant, activation and readiness regression coverage. |
| `test/portal-owner-console.test.mjs` | Owner-gate and customer/owner separation regression coverage. |
| `docs/CUSTOMER_ACCOUNT_AND_PAYMENT_ACTIVATION_DESIGN.md` | Detailed approved customer-account/activation design. |
| `docs/CONNECTOR_AND_REFERENCE_INFORMED_ROADMAP_2026-08-24.md` | Connector/video-informed feature-gating decision record. |
| `docs/DEPLOYMENT_VERIFICATION_NOTES_2026-08-24.md` | Exact route verification record for this customer-onboarding release. |
| `docs/CLOUDFLARE_SECRET_PLACEMENT_GUIDE_2026-08-24.md` | Secret-safe core-vs-Portal configuration placement guide. |

---

## 14. Final summary

Maqtomate has progressed from an early WhatsApp automation concept into a production-hosted, security-conscious, multi-tenant managed SaaS foundation. The important accomplishments are the official Meta-only boundary, encrypted tenant credential architecture, controlled owner access, public managed-rollout site, customer Google-first identity, separate password setup, manual payment gate, activation-readiness record, customer-owned asset policy, and server-enforced Gemini modes.

The product is **not finished**, and it should not be presented as finished in areas that still lack evidence. The honest next goal is to prove the dedicated official WhatsApp loop, then complete customer email delivery, then design official Embedded Signup, then add measured tenant-safe operations one gated module at a time. This is the route to a credible, sellable, secure product rather than a fragile collection of demos.

## References

[1]: [Meta for Developers — Get opt-in for WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in)

[2]: [Meta for Developers — WhatsApp Flows](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows)

[3]: [Meta for Developers — Messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits)

[4]: [Meta for Developers — Template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization)

[5]: [Maqtomate repository on GitHub](https://github.com/maqsoodahmedburiro123-commits/Maqtomate)
