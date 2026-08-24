# Aivastark Reference Assessment for Maqtomate

**Reviewed:** 24 August 2026  
**Reference:** [Aivastark public product, onboarding, features, pricing, and security pages][1]  
**Decision:** Use selected **onboarding and product-clarity patterns**. Do not copy feature claims, pricing structure, implementation shortcuts, or multi-channel availability statements.

## Executive assessment

Aivastark presents an effective self-service website-agent experience. Its strongest product pattern is not its channel list or plan grid; it is the way it moves a new user from “I have signed up” to “I know exactly what I should do next.” The referenced onboarding shows three helpful ideas: an immediate agent preview, visible setup progress, and a clear four-step checklist covering knowledge, behavior, deployment, and integrations.

Maqtomate should adopt that **clarity and progress model**, but it must not claim that a WhatsApp AI Employee is ready in minutes or automatically connect customer WhatsApp, Messenger, Instagram, voice, CRM, or payment systems. Maqtomate is a managed, official Meta WhatsApp rollout product. Its customer journey has real compliance, tenant-isolation, payment-review, customer-owned-business-asset, and official-connection requirements that a web-widget onboarding does not show.

> **Recommended product position:** Maqtomate should feel as clear as Aivastark’s onboarding while remaining more disciplined: customer identity → payment review → activation readiness → managed official connection → tenant activation → observed operations.

## What the reference does well

| Pattern | Visible reference behavior | Maqtomate-safe takeaway |
|---|---|---|
| **Immediate tangible outcome** | The user sees an “agent” preview early in setup. | Give customers a safe preview of their selected operating profile and activation state, not a fake live WhatsApp bot. |
| **Progress-led onboarding** | A short visible sequence shows what is complete and what is pending. | Add a customer activation progress tracker with real server-derived statuses. |
| **Single clear next action** | Each stage ends with a direct Continue action. | Make the customer portal show one next owner-approved action instead of a confusing dashboard. |
| **Checklist after onboarding** | The dashboard shows training, customization, embed, and integrations as an ordered checklist. | Use an equivalent managed-rollout checklist: business context, handoff, opt-in readiness, official connection, and go-live test. |
| **Done-for-you option** | Customers can choose assistance instead of completing every technical step. | Maqtomate should make its managed rollout service visible throughout onboarding. This matches the existing sales model. |
| **Plain-language navigation** | Conversations, deploy, leads, settings, automations, team and billing are easy to find. | Future Maqtomate customer navigation should be limited to features actually active for that tenant. |
| **Knowledge-first setup** | Website/documents/FAQ intake is presented before automation. | Later introduce an approved, tenant-scoped knowledge intake process with retention and source-review controls. |

## What Maqtomate must not copy

The public Aivastark pages make a range of commercial and capability claims including rapid deployment, multichannel availability, web widgets, social-channel routing, lead webhooks, agentic tools, analytics, revenue attribution, CRM connections, and document ingestion. These may be appropriate for that product, but they are not evidence that those capabilities are built or policy-ready in Maqtomate. [1]

| Reference pattern or claim | Why Maqtomate must not adopt it today |
|---|---|
| “Live in minutes” or “three minutes away” | Maqtomate requires manual payment review, customer-owned official WhatsApp assets, consent handling, connection preparation, and owner activation. |
| Website widget and copy-paste script | Maqtomate is WhatsApp-first. A website widget is a separate product surface with its own privacy, consent, analytics, support, and security design. |
| Messenger, Instagram, WhatsApp, email and follow-up listed as ready | Messenger, Instagram, voice, calls, recording, email automation and outbound follow-up remain feature-gated for Maqtomate. |
| Free trial and automatic self-service plan selection | Current Maqtomate payment activation is manual and owner-approved. No fake checkout or instant activation must be introduced. |
| Direct CRM, calendar, Shopify, database, MCP or webhook actions | Each future connector needs a named provider, customer approval, per-tenant authorization, idempotency, audits, cancellation, retries, and a clearly scoped allowed action. |
| Crawl/upload knowledge sources immediately | Customer documents can contain confidential or personal data. Maqtomate needs file handling, retention, source approval, access control, and tenant-isolation work first. |
| Published deflection, response-time, ROI, traffic or accuracy statistics | Maqtomate must only show independently verified results from its own product. It cannot reuse the reference company’s claims. |
| Claims of certifications, regional residency, PII redaction, or compliance coverage | These require Maqtomate-specific implementation and evidence. They must never be copied as marketing text. |

## Maqtomate product comparison

| Dimension | Aivastark reference | Maqtomate direction |
|---|---|---|
| Primary product surface | Self-service website agent and unified inbox. | Managed official WhatsApp AI Employee. |
| Customer activation | Public sign-up → agent setup → plan/trial. | Google identity → customer password → payment review → readiness → managed official connection → owner activation. |
| Channel promise | Website, Messenger, Instagram, WhatsApp and other tools are marketed together. | WhatsApp Cloud API only at present; other channels remain gated. |
| Customer assets | Website content and self-service deployment shown early. | Customer must use their own official Meta/WhatsApp business assets; no owner sharing. |
| AI policy | Reference markets a broader agent/tool stack. | Server-enforced Gemini BYOK or managed allowance only. |
| Sales motion | Product-led trial and tiered subscription. | Managed Launch and Custom Business Rollout with supervised activation. |
| Most valuable lesson | Clear activation UX and action-focused setup. | Apply that clarity to truthful, governed activation steps. |

## Recommended Maqtomate implementation backlog

### Priority A — Customer activation command center

Build a customer-safe onboarding screen that uses the existing server statuses rather than generic progress. The customer should always see their current step, why it matters, what Maqtomate is doing, and the next permitted action.

```text
1. Google identity verified                ✓
2. Maqtomate password created              ✓
3. Offer and AI mode selected              ✓
4. Payment reference submitted             Pending / under review
5. Business readiness reviewed             Pending / changes requested / accepted
6. Official connection managed by owner    Not started / in progress / complete
7. Safe go-live test                       Not started / approved / verified
8. Tenant dashboard active                 Locked until activation
```

The UI must derive every state from the server. A customer must never be able to click “complete,” claim payment, mark connection done, or unlock a tenant dashboard from the browser.

### Priority B — Managed rollout preview, not a fake bot

Once the activation command center exists, provide a **read-only operating-profile preview**. It can summarize the customer’s approved business service scope, office hours, handoff destination, chosen AI mode, and activation status. It must use clearly labelled placeholder/sample interaction cards until official WhatsApp testing is verified for that tenant.

The preview must not send WhatsApp messages, impersonate a live agent, call Gemini, show fabricated performance metrics, or reveal customer credentials.

### Priority C — “Set it up for me” as a real Maqtomate conversion path

The reference uses a done-for-you choice. Maqtomate should surface a comparable, truthful CTA:

> **“Request managed setup”** — Maqtomate reviews your business context, payment status, opt-in readiness, handoff process, and official connection requirements with you.

This CTA should route to the existing safe managed-rollout process. It should not promise a same-day bot, instant Meta approval, or self-service sender activation.

### Priority D — Tenant-safe knowledge controls after official connection proof

The eventual customer dashboard can include a **Knowledge & Business Rules** area, but only after a separate secure design. It should support small, reviewed source entries first: approved FAQs, products/services, business hours, escalation rules, disallowed topics, and manually approved updates. Website crawling, document upload, automatic re-crawling, retrieval/vector systems, and model-answer citations must wait for their own privacy, storage, cost, retention, and evaluation work.

### Priority E — Customer dashboard navigation only for verified features

The future tenant dashboard should use simple, truthful navigation:

| Navigation item | Release condition |
|---|---|
| **Overview** | Active tenant and real operational status. |
| **Conversations** | Official inbound/outbound message handling has been proven for that tenant. |
| **Leads** | Qualified lead model and permission checks are implemented. |
| **Knowledge & Rules** | Secure tenant content controls and approval history are implemented. |
| **Team & Handoff** | Team roles, notification path and escalation ownership are implemented. |
| **Usage & AI mode** | Server-side usage policy and redacted, tenant-scoped telemetry are implemented. |
| **Integrations** | A named, customer-approved adapter is fully built and activated. |

Do not display a navigation item merely because a competitor displays it. If a feature is not available, either omit it or present a clear “managed rollout pending” state rather than a misleading empty dashboard.

## Design direction

The screenshots show a friendly light interface with a bright cyan/purple accent system, progressive setup, rounded cards, and reassurance at each step. Maqtomate can adopt the **clarity**, not the visual identity. Its existing dark green security-oriented public and owner visual language should remain distinct. The suggested Maqtomate onboarding style is:

| Element | Direction |
|---|---|
| Visual language | Maqtomate deep green/teal foundation with controlled mint for verified status and amber for pending owner review. |
| Progress | Thin server-derived progress rail with exact state labels; no arbitrary percentages. |
| Cards | One current action card, one “what happens next” card, and a privacy/asset boundary card. |
| Feedback | Reassuring but specific copy: “Your request is under owner review,” not “Your AI Employee is live.” |
| Conversion | Persistent **Request managed setup** CTA, not a free-trial or immediate deployment claim. |
| Accessibility | High contrast, mobile-first controls, keyboard flow, reduced motion, and clear error/empty states. |

## Exact decision

**Adopt now:** activation-progress UX, one-next-action guidance, a future managed-rollout preview, and the conversion clarity of a done-for-you choice.

**Build next, after the current owner-login issue is resolved:** the customer activation command center using existing server-side onboarding, payment, readiness, and connection statuses.

**Defer:** knowledge ingestion, web embedding, unified inbox, lead automation, social-channel integrations, agentic tools, analytics, visitor tracking, billing automation, CRM/Sheets/Shopify connections, and all claims of outcomes.

**Never adopt:** shared credentials, personal WhatsApp automation, unofficial APIs, frontend keys, browser-controlled tenant access, fake dashboards, fabricated results, or unverified compliance claims.

## References

[1]: [Aivastark — public product, features, pricing, security, and onboarding pages](https://www.aivastark.com/onboarding/plan)
