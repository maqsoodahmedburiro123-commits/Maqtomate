# Maqtomate Free-Tier Follow-Up Options

**Decision trigger:** Vapi has been removed because the user requires a zero-cost approach.

## Reality Check

A platform cannot place normal telephone calls to arbitrary mobile or landline numbers at zero cost indefinitely. A call to a telephone number uses a carrier network and normally requires a phone number, a SIP/PSTN route, and per-minute service. Open-source PBX software removes the software license cost, but it does not make carrier minutes, telephone numbers, a server, recording storage, or AI inference free.

The strongest genuine zero-cost launch model for Maqtomate is therefore **WhatsApp-first follow-up**, not simulated or misleading “free AI phone calls.” Meta states that service messages sent during the 24-hour customer service window opened by a user message are not charged; this window resets when the user messages again. [1]

## Options

| Approach | What the customer experiences | Cost profile | What is free | Limitation |
|---|---|---|---|---|
| **A. WhatsApp-first voice follow-up — recommended** | Customer sends a text or voice note; Maqtomate transcribes it, responds intelligently, and creates lead/report records. | Zero messaging charge for service messages inside Meta’s 24-hour window; AI processing may still require a tenant BYOK key. | The compliant WhatsApp service-message window. | It is not a normal phone call. Outbound templates or marketing messages can have charges. |
| **B. Secure web voice room** | The bot sends a private click-to-talk link; lead and business speak through the browser rather than a phone network. | Zero PSTN cost; hosting/STUN/TURN and AI services still may cost at scale. | Browser-based calling can avoid carrier minutes. | Customer must open a browser link; it cannot ring their ordinary phone number. |
| **C. Self-hosted Asterisk / FreePBX** | Normal business phone calling via the customer’s own SIP account and number. | No PBX software license, but phone service and call minutes are paid by the customer. | Asterisk/FreePBX software. | It is not zero-cost PSTN calling and requires infrastructure/security work. |

## Recommended Revised Product

Maqtomate should launch with Option A as the included core service:

1. WhatsApp text and voice-note handling, with the actual voice transcript stored in the customer’s isolated dashboard.
2. AI service follow-up inside the customer-initiated WhatsApp conversation window.
3. Consent-tagged lead capture, task creation, and instant notification to the business when a human follow-up is appropriate.
4. Tenant-specific Excel exports covering transcripts, leads, AI responses, and follow-up status.
5. An optional **“Call Request”** record rather than an automatic PSTN call. A customer administrator or staff member can call the lead manually; the platform retains the lead and outcome data.

The Vapi-specific call trigger and webhook implementation should remain disabled and be removed from the active configuration. It may be retained in source control as a future paid upgrade only if the user wants it later.

## References

[1] [Meta WhatsApp Business Platform Pricing](https://whatsappbusiness.com/products/platform-pricing/)  
[2] [Asterisk — Free and Open Source Communications Framework](https://www.asterisk.org/)  
[3] [FreePBX — Free to Download and Use](https://www.freepbx.org/)
