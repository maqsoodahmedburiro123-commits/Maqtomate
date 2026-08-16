# Maqtomate WhatsApp Voice Employee: Production Activation

This guide activates Maqtomate’s **WhatsApp-first, tenant-isolated Voice Employee**. It contains no telephone provider, paid phone-call workflow, call recording, or telephone webhook.

## What the Customer Receives

Each active customer receives a private dashboard where their approved team can review WhatsApp voice-note transcripts, AI responses, leads, and follow-up tasks. The customer can download an Excel workbook containing only their own data. The platform owner sees aggregate fleet metrics and tenant-specific details only through owner-authorized routes.

| Capability | Active production behaviour |
|---|---|
| WhatsApp voice note | Media is downloaded from Meta only to process it, then transcribed and discarded; raw audio is not retained. |
| AI response | Maqtomate replies as the customer’s configured AI employee. |
| Lead capture | A voice-note interaction creates a tenant-scoped lead record when the feature is enabled. |
| Follow-up | The system creates a WhatsApp service follow-up task for the tenant team. High-intent or appointment-request interactions create an open human follow-up task. |
| Reporting | The private portal exports Summary, Voice Notes, Follow-up Tasks, and Lead Data worksheets. |

## Production Deployment Order

First apply Migration 004 to D1. Only then deploy `maqtomate-worker` and `maqtomate-portal`, because both Workers query the new voice-note, lead, task, and metric tables.

```bash
# Run against the production D1 binding only after confirming the Cloudflare token.
wrangler d1 execute maqtomate-db --remote --config wrangler.toml --file=backend/migration-004-voice-calling.sql

# Deploy both revised Workers.
wrangler deploy --config wrangler.toml
wrangler deploy --config wrangler.portal.toml
```

The migration has already been applied successfully to a disposable local D1 database during validation. It creates `tenant_voice_settings`, `voice_notes`, `lead_data`, `follow_up_tasks`, and `tenant_voice_metrics_daily`.

## Required Secrets

| Worker | Secret | Purpose |
|---|---|---|
| `maqtomate-worker` | `TENANT_DATA_ENCRYPTION_KEY` | Existing AES-GCM key used to encrypt customer credentials. |
| `maqtomate-worker` | `GEMINI_API_KEY` | Optional platform fallback for AI and transcription. To avoid Maqtomate paying central AI costs, use each customer’s encrypted Gemini BYOK credential instead. |
| `maqtomate-worker` | `APP_SECRET` | Existing Meta webhook-signature validation secret. |
| `maqtomate-worker` | `ADMIN_API_KEY` | Existing restricted internal administration credential. |
| `maqtomate-portal` | Existing authentication, Turnstile, and email secrets | Existing secure portal access and magic-link delivery. |

No telephony-provider API key is required.

## Configure a Tenant

After the customer’s payment has been approved and their WhatsApp credentials are stored securely, enable their Voice Employee settings. `follow_ups_enabled` creates action records; it does not send marketing messages or place phone calls.

```sql
INSERT INTO tenant_voice_settings (
  client_id,
  voice_notes_enabled,
  follow_ups_enabled,
  follow_up_mode,
  lead_capture_enabled,
  follow_up_instructions
) VALUES (
  :CLIENT_ID,
  1,
  1,
  'whatsapp_service',
  1,
  'Review high-intent WhatsApp leads promptly and contact them only under the business’s approved process.'
)
ON CONFLICT(client_id) DO UPDATE SET
  voice_notes_enabled = excluded.voice_notes_enabled,
  follow_ups_enabled = excluded.follow_ups_enabled,
  follow_up_mode = excluded.follow_up_mode,
  lead_capture_enabled = excluded.lead_capture_enabled,
  follow_up_instructions = excluded.follow_up_instructions,
  updated_at = datetime('now');
```

## Compliance Boundary

The product’s zero-telephony-cost route is WhatsApp service messaging in the customer-initiated support window. Meta states that service messages are not charged during the 24-hour customer service window after a user messages the business; the window resets with each user message. [1] Do not use the service workflow to send unsolicited marketing or circumvent WhatsApp template rules.

The business must maintain its own privacy notice, customer consent process, and human escalation policy. Users requesting no further contact are classified as `do_not_contact` and should not receive new manual follow-up tasks from the Voice Employee.

## Current Deployment Blocker

The Cloudflare token in the earlier setup was rejected. The uploaded page was a token-review screen, not a newly issued token. A new limited deployment token is required before production migration and deployment can be completed.

| Scope | Required permission |
|---|---|
| Account | Workers Scripts — Edit; D1 — Edit; Workers KV Storage — Edit; Account Settings — Read |
| Zone, only if Cloudflare requests it | Workers Routes — Edit; Zone — Read |

## Reference

[1] [Meta — WhatsApp Business Platform Pricing](https://whatsappbusiness.com/products/platform-pricing/)
