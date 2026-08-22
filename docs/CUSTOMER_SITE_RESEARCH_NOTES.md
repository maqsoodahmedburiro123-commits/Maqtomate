# Maqtomate Customer Website Research Notes

**Scope:** Worldwide customer-facing positioning for an official Meta WhatsApp Cloud API AI Employee SaaS. These notes capture public competitive-pattern evidence only; they do not authorize copying visual design, copy, testimonials, metrics, or other protected content.

## Sources reviewed

| Source | URL | Evidence retained for original strategy |
|---|---|---|
| AiSensy — WhatsApp AI Agents | https://aisensy.com/features/whatsapp-ai-agents | Outcome-led hero, official API trust cue, agent-vs-keyword-chatbot comparison, visible guided setup, industry/use-case modules, knowledge/actions/AI-routing pillars, two-path CTA (self-serve and assisted build), FAQ depth. |
| AiSensy — WhatsApp Automation | https://aisensy.com/features/whatsapp-automation | Trigger → logic → action education, feature grouping, industry cards, case-study pattern, broad engagement feature taxonomy, action-oriented CTA placements. |
| QuickReply.ai — WhatsApp Lead Generation | https://quickreply.ai/whatsapp-automation/whatsapp-lead-generation-for-converting-high-intent-prospects | Capture → qualify → route → nurture → convert → measure funnel framing; context-aware website entry points; click-to-chat, QR, flows, and behavior-triggered widget concepts. |
| Landbot — WhatsApp Automation | https://landbot.io/whatsapp | Clear Marketing / Support & Operations segmentation, visual product proof, no-code capability blocks, test environment explanation, team handoff, integrations and analytics modules, official API FAQ. |
| Wati — Homepage | https://www.wati.io/ | Lifecycle-led Marketing / Sales / Support organization, AI capability sub-products, proof-of-work interface patterns, integrations, security/reliability modules, and role-specific CTA paths. |
| Respond.io — Homepage | https://respond.io/ | Customer-lifecycle narrative (capture → convert → retain), team inbox positioning, AI agent task framing, interactive-tour CTA, product proof, and trust architecture. |
| Manychat — WhatsApp | https://manychat.com/product/whatsapp | Pain-before/after contrast, workflow examples, clear WhatsApp-specific FAQ, and conversion-oriented entry-point framing. |
| Meta — WhatsApp Business Platform | https://developers.facebook.com/documentation/business-messaging/whatsapp/overview | Official platform scope: Cloud API messaging/calling, templates, webhooks, Business Management API, and the documented customer-onboarding Embedded Signup route. |
| Twilio — WhatsApp | https://www.twilio.com/en-us/messaging/channels/whatsapp | Developer-led modularity, customer-journey use-case framing, consent-aware calling concepts, and an explicit text-to-call context-continuity pattern. |
| Infobip — WhatsApp API provider guide | https://www.infobip.com/blog/best-whatsapp-api | Clear buyer education differentiating personal app, Business app, and Business API; provider-evaluation criteria around automation, integrations, analytics, security, and onboarding. |
| Chatwoot — WhatsApp Business | https://www.chatwoot.com/features/whatsapp-for-business | Official-API trust positioning, shared-inbox primitives, approved-template explanation, agent assignment, private notes, labels, operational automation, and human-handoff framing. |
| Chatwoot — WhatsApp Embedded Signup | https://developers.chatwoot.com/self-hosted/configuration/features/integrations/whatsapp-embedded-signup | Reference implementation checklist for a future secure Embedded Signup: server-only app settings, official OAuth, automated webhooks/phone setup, progress feedback, and error guidance. |
| Trengo — WhatsApp | https://trengo.com/whatsapp | URL was no longer available at review time; it must not be treated as a current page-template reference. |

## Original Maqtomate positioning decision

Maqtomate should not be marketed as another chatbot builder. The customer website must position it as a **managed WhatsApp AI Employee** that responds to text and voice notes, qualifies leads, captures structured context, escalates to people, and produces tenant-isolated operational reporting. The core trust boundary is **official Meta WhatsApp Cloud API only**; customers should connect through a simple approved flow and must never be asked for developer credentials, OTPs, webhook URLs, passwords, or API tokens.

## Website structure inferred from evidence

1. Hero: outcome, precise ICP, official Meta/API boundary, customer CTA and demo CTA.
2. Product proof: visual conversation-to-lead-to-report operating loop.
3. AI Employee capabilities: reply, voice-note transcription, qualification, human handoff, reporting.
4. Operating model: Connect → teach → supervise → improve; never promise unimplemented self-serve setup.
5. Industry use cases: real estate, clinics, salons, education, ecommerce, professional services.
6. Security and trust: tenant isolation, server-side encrypted credentials, official APIs, audit-ready owner oversight.
7. Conversion: clear pricing/consultation qualification, customer onboarding route, FAQ, final CTA.
8. SEO resource architecture: use-case pages, feature pages, integrations pages, guides and comparison/alternatives pages only when factual substantiation is available.

## Additional original design decisions

- The Maqtomate homepage will organize its proof around **Reply → Understand voice → Qualify → Escalate → Report**, rather than generic channel unification or a no-code flow-builder claim.
- Public CTAs will distinguish **"See the AI Employee workflow"** from **"Talk to an automation specialist"**. A self-serve "Connect WhatsApp" step must remain an implementation placeholder until Meta Embedded Signup is complete and verified.
- The public site will use a capability-led product demo and consent-aware conversion journey, but will not claim specific response-time, conversion, customer-count, uptime, rating, or ROI figures without first-party evidence.
- Reference pages will retain the useful operational journey pattern (capture → qualify → route → follow-up → report) while preserving Maqtomate's official-API-only and managed-onboarding position.

## Public-research expansion — 23 August 2026

Public source research confirms a consistent category pattern: established platforms frame WhatsApp around the full customer journey rather than a standalone bot. Wati structures this as marketing, sales, and support; Respond.io emphasizes team context, agent collaboration, lifecycle stages, integrations, and measurement; Manychat uses a strong pain-to-outcome narrative; Landbot demonstrates the value of a supervised test environment and clearly documented human takeover. Meta documentation establishes that Embedded Signup is the appropriate official onboarding route when Maqtomate is ready to make customer connection self-serve. [Meta WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview)

The resulting Maqtomate differentiation remains original: **official WhatsApp AI Employee operations for a business that wants a managed, tenant-isolated setup—not a generic automation canvas.** Priority product lessons are a visible customer-journey loop, supervised test-before-activation, crisp human-handoff conditions, role-aware operational visibility, and consent-aware follow-up. These are product principles only, not permission to copy a competitor’s text, visual system, workflow templates, commercial claims, ratings, or customer evidence.

The research deliberately excludes public claims about competitor customer counts, revenue lift, open rates, ROI, uptime, reviews, or market share. Semrush MCP access was checked but the connected subscription did not authorize research access; no quantitative Semrush data was used.

## GitHub implementation-reference boundary — 23 August 2026

The public [`WhatsApp/WhatsApp-Business-API-Setup-Scripts`](https://github.com/WhatsApp/WhatsApp-Business-API-Setup-Scripts) repository was reviewed as an official historical reference. Its README explicitly states that the on-premises API is deprecated and directs implementers to the WhatsApp Business Cloud API. Maqtomate must therefore **not** adopt its Docker/on-premises setup; the only useful takeaway is confirmation that the Cloud API is the correct supported production path.

Two mature open-source repositories were also evaluated as architecture references: [`chatwoot/chatwoot`](https://github.com/chatwoot/chatwoot) for customer-conversation operating concepts, and [`n8n-io/n8n`](https://github.com/n8n-io/n8n) for workflow-automation extensibility. Neither is approved as Maqtomate’s production core or should be copied wholesale. The implementation lessons are limited to explicit agent ownership, private internal context, auditable workflow actions, and integration boundaries. Any future use would require a separate tenant-isolation, licensing, data-retention, cost, security, and operational review.

## Live implementation verification — 22 August 2026

The public production homepage was visually verified after deployment at the Portal root. The page renders the dark navy and signal-mint Maqtomate visual system, a clear customer-facing hero, product workflow illustration, five capability cards, managed-onboarding explanation, use-case navigation, and secure sign-in separation. The verified public links include Product, How it works, Use cases, Security, Resources, managed rollout planning, and secure portal login. No secret, personal recipient number, tenant token, or fabricated review/rating appears in the rendered public page.

## Non-negotiable exclusions

- Do not reuse competitor copy, logos, UI screenshots, metrics, case-study outcomes, reviews, ratings, or testimonials.
- Do not claim WhatsApp calling, call recording, self-serve activation, Meta Embedded Signup, AI model capabilities, CRM/Excel integrations, or customer results until each feature is implemented and verified.
- Do not mention the owner’s personal recipient number on public pages.
- Do not offer unofficial QR/session WhatsApp automation.
