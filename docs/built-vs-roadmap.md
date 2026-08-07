# What's Actually Built vs. What's Roadmap

The Enterprise Architecture doc describes the platform you want. This is what
exists in your uploaded files today, so the two don't get conflated in a client
or investor conversation.

> **Correction:** an earlier version of this file wrongly listed voice notes and
> KV conversation memory as "not present." I said that without reading the full
> worker file — a mistake on my part. Full line-by-line read below; both are real.

## ✅ Actually built (confirmed by reading the full worker file, not skimming)
- Multi-tenant Cloudflare Worker routing by `phone_number_id` → D1 lookup
- D1 schema: `clients`, `logs`, and now `audit_logs` tables
- Text, voice note (OGG, base64 inline to Gemini), and image handling — all three
  message types are actually parsed and routed in `maqtomate-multitenant-worker.js`
- KV-based dedup (`dup:<client>:<msgId>`, 24h TTL) and conversation memory
  (`conv:<client>:<number>`, last 24 messages, 7-day TTL) — both real, both wired in
- Meta webhook GET verification + HMAC-SHA256 POST signature verification (added this session)
- Human handoff keyword detection (multi-language trigger list, per-client configurable)
- Admin API (`/api/clients`) behind a shared bearer token, now with server-side
  required-field validation (added this session)
- Audit logging on client create/update/deactivate (added this session)
- Basic KV rate limiting: 20 msgs/60s per number per client (added this session)
- Mode 1 (BYOK) partially real: `whatsapp_token` was already per-client; `gemini_api_key`
  is now also per-client with fallback to the shared key (added this session)
- Niche landing pages (dental, salon, real estate, restaurant, generic) + onboarding forms

## ⚠️ Referenced in docs but still not in the code
- Client portal / `/portal` — clients have no self-serve dashboard; only your admin one
- Analytics beyond raw `logs` rows — no latency tracking, token-cost accounting, MRR
  trend charts (the admin dashboard shows current MRR/client count only)
- LLM abstraction layer — `callGemini()` is hardcoded to Gemini's API shape; swapping
  to OpenAI/Claude/DeepSeek would mean writing a new function, not flipping a flag
- Mode 2 embedded signup (1-click Facebook OAuth) — still fully manual today
- RBAC (Super Admin vs Support Agent) — one shared bearer token for all admin access;
  `audit_logs.actor` is hardcoded to `'admin'` until real per-user tokens exist

## ❌ Pure roadmap (Enterprise doc, Version 2.0+)
Instagram/Messenger/Telegram channels, voice calling AI, AI workflow builder,
white-label mode, AI marketplace, public API, multi-platform deploy (Docker/Fly.io/Railway),
monitoring/status page, Zapier/n8n/HubSpot integrations.

None of this is a criticism of having the vision written down — it's useful to
know where you're going. The risk is only in presenting Version-2.0-and-beyond
items as if they're live when pricing, pitching, or onboarding a client this month.

