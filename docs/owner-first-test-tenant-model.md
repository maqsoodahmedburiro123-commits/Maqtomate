# Maqtomate Owner-First Test Tenant Model

## Product Decision

The first live Maqtomate user is the platform owner. The owner must be able to enter the SaaS as an **Owner Test Tenant**, see the same onboarding and AI Employee experience that a paying customer will see, and use the flow without a payment requirement.

## Owner Test Tenant Rules

| Requirement | Decision |
|---|---|
| Access | Limited to the verified Owner Control Center identity. |
| Payment | Explicitly payment-exempt; it never enters a customer payment gate. |
| Onboarding | Mirrors the future customer journey: tenant details, Connect WhatsApp status, AI readiness, test console, and audit evidence. |
| Sender | Uses the Maqtomate-owned Meta test WABA and its approved test sender for controlled testing. |
| Personal WhatsApp | The owner's personal WhatsApp remains a recipient/test-contact only. It must never be registered, migrated, or disconnected. |
| Customer experience | Customers later use official Meta Embedded Signup. They never receive a request for Meta developer-dashboard setup, webhook URLs, App Secrets, tokens, passwords, or OTPs. |

## Acceptance Criteria

The Owner Test Tenant is complete only when the owner can log in, see a payment-exempt status, see the Maqtomate test connection status, trigger a controlled test, and view unambiguous live evidence of each stage. Customer activation remains blocked until the equivalent controlled test flow is green.
