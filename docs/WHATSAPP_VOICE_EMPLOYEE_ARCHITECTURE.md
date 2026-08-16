# Maqtomate WhatsApp Voice Employee Architecture

**Active product model:** WhatsApp-first AI employee with voice-note intelligence, tenant-isolated lead follow-ups, and Excel reporting.  
**Removed from the active architecture:** Vapi, paid PSTN calling, telephone recordings, and Vapi webhooks.

## Product Flow

A customer sends a WhatsApp text or voice note to a Maqtomate tenant. The Worker verifies Meta’s webhook signature, resolves the correct tenant from the WhatsApp phone-number identifier, rate-limits and de-duplicates the interaction, then processes it under that tenant’s encrypted credentials and business prompt.

For a voice note, the Worker downloads the ephemeral Meta media file, transcribes it through the tenant’s Gemini BYOK key or the platform’s configured Gemini key, stores the transcript without storing the raw audio, and generates a business-specific WhatsApp service response. It also creates or updates a tenant-isolated lead record and an actionable follow-up task for the customer’s team.

```
Customer voice note or text
        │
        ▼
Meta WhatsApp webhook → Maqtomate Worker
        │
        ├─ Signature verification, routing, rate limit, de-duplication
        ├─ Voice transcription (Gemini, tenant BYOK preferred)
        ├─ Tenant-specific AI service response
        ├─ WhatsApp reply inside the service conversation
        ├─ Lead record + follow-up task
        └─ Private dashboard + XLSX reporting
```

## Cost Boundary

Meta states that service messages during the 24-hour customer service window opened by a user message are not charged. This is the product’s no-telephony-cost follow-up path. [1] Maqtomate must not claim that it can make ordinary cellular or landline calls for free; carrier-network calls require a number and carrier route.

To keep Maqtomate’s own operating cost at zero, each customer should use their own Gemini API key under the existing encrypted BYOK model. Customers may use a provider’s available free tier or pay for their own AI usage; this is separate from Maqtomate charging them for a managed automation service.

## Tenant Isolation Rules

Every new table includes `client_id`. All portal queries must resolve the authenticated session’s active tenant membership before querying records, and every data query must bind `client_id`. Platform-wide owners may view fleet metrics through owner-only APIs, while customer users never receive cross-tenant rows, credentials, raw media, or internal audit data.

| Data type | Customer visibility | Owner visibility |
|---|---|---|
| Voice transcript and AI reply | Only the matching tenant membership | Via owner-only tenant detail when operationally necessary |
| Follow-up task and lead data | Only the matching tenant membership | Fleet metrics and tenant detail only |
| WhatsApp token / Gemini key | Never returned by any dashboard endpoint | Never returned by dashboard endpoints; stored encrypted server-side |
| Raw voice audio | Not retained by Maqtomate | Not retained by Maqtomate |

## Reporting

Each authorized customer can download an Excel workbook with four sheets: Summary, Voice Notes, Lead Data, and Follow-up Tasks. The export is generated server-side, has `Cache-Control: no-store`, is recorded in the dashboard audit log, and queries only the requesting tenant’s rows.

## Reference

[1] [Meta — WhatsApp Business Platform Pricing](https://whatsappbusiness.com/products/platform-pricing/)
