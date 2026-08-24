# Maqtomate Elite Upgrade Specification — Safety Assessment

**Reviewed source:** User-uploaded `pasted_content.txt`  
**Assessment status:** Initial requirements reconciliation. No architecture, secret, access-control, owner-gate, customer-login, tenant-isolation, or pricing-policy change is authorized by this document alone.

> **Core decision:** The specification is right to preserve the existing Maqtomate architecture and visual identity. Its usable direction is an **additive visual-storytelling upgrade**, not a rebuild. Any product, pricing, AI-mode, or dashboard claim must remain tied to a verified server-side capability and the owner’s current commercial policy.

## Safe directions identified so far

| Requested direction | Safe Maqtomate treatment |
|---|---|
| Preserve the dark navy, mint, editorial, premium visual system | Keep the live visual language and evolve it gradually. |
| Reduce repeated page structures | Create page-specific CSS workflow illustrations rather than duplicating the same chat card on every route. |
| Make the AI Employee operating loop clearer | Use an original, factual visual flow: message → approved context → qualification → human handoff → reportable next action. |
| Distinct product, workflow, use-case, security, resources, and connect experiences | Safe if each route uses only implemented or supervised capabilities and has responsive/reduced-motion fallbacks. |
| Technical security architecture visual | Safe when it describes the actual official Meta → Worker → tenant isolation → encrypted credentials → audit boundary, without claiming certification. |
| Improve the managed rollout page visually | Safe if the existing privacy-minimised form, no-credential rule, and supervised activation wording stay unchanged. |
| Server-side entitlement enforcement | Already an important Maqtomate rule; continue to test it and do not use frontend-only gates. |

## Requirements that conflict with current decisions or need evidence first

| Specification request | Why it is not safe to apply immediately | Correct next condition |
|---|---|---|
| Publish `Plain` and `AI Powered` as two public pricing modes | The live public offer was intentionally revised to **Managed Launch** and **Custom Business Rollout**. The owner also removed any package implying owner Meta/WhatsApp credential use. | Define a new, owner-approved commercial model with verified feature entitlements before changing public pricing. |
| State that `Plain` has no Gemini but includes operational WhatsApp functions | The actual non-AI execution path and feature availability must be verified end-to-end for the marketed client mode. | Audit source and test the exact plain path before a customer-facing promise. |
| State AI/voice-note capabilities as available in an AI plan | Voice and advanced AI features remain feature-gated and some require end-to-end proof. | Advertise only after plan entitlement, server gate, and production evidence are verified. |
| Restore DIY BYOK / Smart Pro / VIP Managed public packages | The owner recently removed the public owner-credential-dependent package. | Keep legacy/internal entitlement concepts separate from today’s public sales offer unless the owner explicitly approves a new safe package. |
| Change price to values listed in the specification | The uploaded text lists older conflicting prices and says not to invent new prices. | The current public pricing source and owner-approved offer remain authoritative. |
| Introduce voice, Facebook, Instagram, autonomous workflows, or external providers | These require official API approval, tenant scope, consent, retention, cost, and release tests. | Treat as future feature-gated work. |

## Non-negotiable preservation rules

1. Keep the live Cloudflare Portal/Core Worker architecture and current D1/KV/service-binding model.
2. Keep the owner password gate before Google verification and keep all owner wording out of `/login`.
3. Keep customer magic-link access separate from owner access.
4. Never expose Meta, Gemini, Cloudflare, Google OAuth, encryption, or tenant credential values in code, browser traffic, screenshots, or GitHub.
5. Keep the personal WhatsApp number recipient-only and never use it as a business sender.
6. Keep public copy truthful: no fake activity, testimonials, certifications, uptime, performance, channel, voice, or automation claims.
7. Run unit/regression tests and mobile review before any live deployment.

## Recommended first upgrade after full audit

Start with a **non-destructive visual-storytelling pass** on the Product, How It Works, Use Cases, Security, Resources, and Connect pages. Build lightweight CSS/SVG-like workflow panels, distinct content hierarchy, and reduced-motion support. Do not change prices, plans, owner routes, sign-in, database schema, worker secrets, or AI entitlement logic in that first pass.

## Remaining specification requirements

The remainder of the uploaded specification reinforces several existing Maqtomate rules: official Meta Cloud API only, no personal-number automation, server-side entitlement checks, no fake AI status, no browser-visible keys, cautious voice processing, responsive design, and real test evidence. These are all compatible with the current direction.

| Requirement | Assessment | Implementation boundary |
|---|---|---|
| Lightweight cinematic motion | Safe future website enhancement. | CSS transform/opacity only, reduced-motion support, no stock images, no heavy WebGL, and no fake activity data. |
| Different workflow visuals per public route | Safe first visual upgrade. | Use original factual flows and preserve the current CTA/form/navigation behavior. |
| SEO metadata, semantic headings, canonical/structured data | Safe after route-by-route review. | Structured data may describe only factual Organization/WebSite/WebPage facts; never ratings, reviews, certifications, or unsupported claims. |
| Security review | Necessary, but separate from a visual refresh. | Review tested source and production signals; do not change secrets or loosen access for convenience. |
| Official Meta Embedded Signup | Future onboarding enhancement. | Keep managed rollout until official implementation and verification are complete. |
| Voice-note processing privacy | Correct long-term rule. | Do not activate paid voice calls, persistent recordings, or public voice claims before consent/retention/provider/end-to-end gates. |
| Canonical engine/entitlement configuration | Worth a future design review. | Do not relabel or expose public plans until the customer modes, actual non-AI path, and pricing policy are approved and tested. |
| Network verification of plain versus AI paths | Correct required proof. | This is not satisfied by UI. It requires an actual tenant mode, authorized request tests, and audited provider-call evidence. |
| Real WhatsApp → Worker → Gemini → WhatsApp proof | Still the highest technical proof gap. | Remains blocked by official Meta test-recipient / conversation-window setup, not by a website redesign. |

## Final controlled implementation order

1. **Audit the existing pricing and entitlement source.** Confirm which capabilities can truthfully be marketed as managed today; do not change current public offers until that is done.
2. **Apply a visual-storytelling refresh only.** Begin with one distinct Product workflow panel and one distinct How It Works flow, while leaving secure routes and pricing untouched.
3. **Add testing and responsive review.** Confirm customer login, owner password gate, `/owner`, `/connect`, public routes, and entitlement tests remain green.
4. **Deploy through the existing version workflow only after tests pass.** Preserve existing Worker secrets and bindings.
5. **Address advanced AI-plan mode and voice claims later.** Require owner commercial approval and real back-end evidence first.

## Current entitlement and pricing audit

The implementation contains three **internal entitlement modes**: `DIY BYOK`, `Smart Pro`, and legacy `VIP Managed`. The server-side configuration distinguishes a tenant-owned Gemini path from a platform-managed Gemini path and uses feature/usage limits. This supports the underlying principle of server-side entitlement enforcement, but it does **not** create a verified public `Plain` / `AI Powered` sales model on its own.

The customer dashboard can already read a tenant’s plan entitlement, limits, and enabled features. However, the live public pricing route was intentionally changed on 24 August 2026 to two owner-approved managed offers:

| Live public offer | Current public boundary |
|---|---|
| **Managed Launch** | Managed official rollout with approved business context, qualification rules, human handoff design, and supervised readiness review. |
| **Custom Business Rollout** | Quote after review for higher-volume or separately approved requirements. |

The canonical pricing document retains older historical price models for traceability, but expressly states that new customer sales must not revive the retired owner/agency Meta package. Therefore the visual pass must keep **Managed Launch** and **Custom Business Rollout** visible, and must not show `VIP Managed`, price values from old documents, `Plain`, or `AI Powered` labels to prospects until the owner separately approves an evidence-backed commercial change.

> The safe implementation target is a visual differentiation pass—not a plan, billing, entitlement, credential, or product-claim rewrite.
