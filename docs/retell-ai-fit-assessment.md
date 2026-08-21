# Retell AI Fit Assessment for Maqtomate

**Assessment date:** 21 August 2026  
**Decision scope:** Owner-first Maqtomate AI Employee, official WhatsApp Cloud API, multi-tenant SaaS, and the protected personal WhatsApp number policy.

## Evidence-led conclusion

Retell AI is a strong **optional future voice-call layer**, but it must not replace Maqtomate's official WhatsApp Cloud API runtime. Retell is telephony-first: its official deployment paths use Retell-managed phone numbers, a web-call/widget, or external telephony through SIP and providers such as Twilio, Telnyx, and Vonage. This conflicts with the present Maqtomate objective of WhatsApp-first automation with no paid telephony dependency.[1][2]

For WhatsApp messaging, Retell's own chat-agent documentation explicitly states that it has no built-in third-party-chat integration for WhatsApp or Messenger; WhatsApp requires a custom channel through Retell's chat API. Its public WhatsApp listing is labelled an **unofficial connector** delivered through viaSocket, not a native official WhatsApp Cloud API channel.[3][4]

Maqtomate should therefore keep Meta Cloud API as the sole WhatsApp system of record for messages, voice notes, webhook security, tenant routing, lead data, and Excel exports. Meta documents that Cloud API supports programmatic WhatsApp messages, rich media, interactive messages, calls, and webhooks. Meta also provides Embedded Signup so future customers can authorize assets without being asked for developer tokens or webhook setup.[5][6][7]

## Fit against Maqtomate requirements

| Requirement | Retell AI fit | Decision |
|---|---|---|
| Official WhatsApp text and voice-note automation | No native third-party chat-platform integration; custom API bridge required | **Do not use as the WhatsApp runtime** |
| Zero-paid-telephony model | Voice calls are metered at $0.07–$0.31 per minute before or alongside telephony/add-on costs | **Not suitable for the current default** |
| AI phone calls, recordings, transcripts, QA | Strong: voice agents, testing, monitoring, post-call analytics, integrations | **Consider as a paid opt-in later** |
| Personal-number protection | Safe only if a separate business/telephony number is used | **Never connect 03111232752** |
| Multi-tenant SaaS isolation | Possible only through a Maqtomate-controlled adapter, per-tenant credentials, webhooks, and audit boundaries | **Future integration, not direct customer access** |
| Customer onboarding simplicity | Retell does not remove Meta onboarding for WhatsApp; Embedded Signup is the official Meta path | **Keep Meta Embedded Signup roadmap** |

## Recommended architecture

> **Now:** Meta Cloud API → Maqtomate Worker → Gemini → encrypted tenant data, lead/follow-up records, and XLSX reporting. The dedicated Maqtomate test sender handles the owner's trial. The owner’s personal WhatsApp remains only a recipient/handoff endpoint.

> **Later, optional paid add-on:** Maqtomate Worker → Retell API → separate SIP/telephony business number → Retell webhooks → Maqtomate tenant event ledger, transcript reference, lead update, and human escalation. Every call must have consent, recording disclosure where required, budget limits, and a tenant-specific audit trail.

## Cost implication

Retell's published pay-as-you-go price is currently **$0.07–$0.31 per voice-agent minute**, with possible separate telephony, phone-number, quality-assurance, safety, and knowledge-base charges. It offers a $10 starting credit, which is appropriate for a sandbox evaluation but not evidence that voice calls are zero-cost.[2]

## Explicitly rejected approach

Maqtomate must not use an unofficial WhatsApp connector, QR/session automation, or the owner's personal number as an API or Retell phone number. Meta's platform documentation states that unauthorized third-party tools are prohibited. The official Cloud API and its webhooks remain the compliance boundary.[5][6]

## References

[1]: https://docs.retellai.com/general/introduction "Retell AI — Introduction"
[2]: https://www.retellai.com/pricing "Retell AI — Pricing"
[3]: https://docs.retellai.com/build/create-chat-agent "Retell AI — Create Chat Agent"
[4]: https://www.retellai.com/integrations/whatsapp?f8fd828e_page=2 "Retell AI — WhatsApp Integration Listing"
[5]: https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform "Meta — About the WhatsApp Business Platform"
[6]: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview "Meta — WhatsApp Business Platform Webhooks"
[7]: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview "Meta — WhatsApp Embedded Signup"
