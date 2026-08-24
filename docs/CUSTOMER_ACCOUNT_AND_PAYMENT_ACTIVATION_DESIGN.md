# Customer Account and Payment-Gated Activation Design

**Status:** Approved design for implementation.  
**Scope:** Customer Gmail/business-email plus password access, email verification, password reset, manual payment review, isolated onboarding status, and server-enforced Gemini mode selection.

> **Design principle:** A customer account is not a WhatsApp tenant. A customer can create and verify an account, choose a customer-safe offer, and submit a payment reference without supplying a Meta token, WhatsApp number, password, OTP, or API key. A live tenant is created only after the owner approves payment and completes the managed official connection process.

## Why a separate onboarding model is required

The current `clients` table is the live WhatsApp tenant model. Its legacy schema requires operational sender fields, and `requireSession()` correctly grants customer dashboard membership only for active tenants. Creating a fake inactive live tenant at ordinary account signup would either require unsafe placeholder credentials or blur the difference between a prospect and an activated business.

The new account/onboarding model remains separate:

```text
Customer account
  → verified email + password session
  → onboarding request
  → payment reference
  → owner review
  → managed official Meta connection
  → active live tenant + tenant membership
  → isolated operating dashboard
```

## Customer roles and access states

| State | What the customer can see | What remains blocked |
|---|---|---|
| `email_verification_required` | Account-verification instruction. | All dashboard and payment actions. |
| `payment_pending` | Selected offer, expected setup amount when fixed, and a manual payment-reference form. | Tenant operations, Meta connection, AI execution. |
| `payment_submitted` | Payment review status. | Tenant operations, Meta connection, AI execution. |
| `payment_approved` | Managed connection checklist and owner-review status. | Tenant operations until the official sender connection is ready. |
| `connection_pending` | Official managed connection progress. | Live WhatsApp AI and customer operational data. |
| `active` | Tenant-scoped dashboard through an active membership. | Other tenants, owner functions, raw credentials, and unrelated records. |
| `rejected` / `cancelled` | Minimal status and support guidance. | Tenant activation and privileged actions. |

## Customer-safe offer and Gemini choices

The live public offer remains **Managed Launch** and **Custom Business Rollout**. No package grants a customer access to the owner’s Meta test sender, personal WhatsApp number, Meta credentials, or Cloudflare secrets.

The onboarding form can select an AI-cost model, but the label is not an authorization decision:

| Requested mode | Customer responsibility | Platform behavior |
|---|---|---|
| `customer_byok` | Customer may later authorize their own Gemini usage through a secure server-side onboarding step. | Server must fail closed if an AI request is attempted before a tenant-owned credential is securely stored and the tenant is eligible. |
| `managed_ai` | Customer receives an owner-approved managed Gemini allowance after commercial approval. | Server enforces the active tenant mode, provider policy, limits, and audit trail before a Gemini request. |

The existing server-side `PLAN_ENTITLEMENTS` and AI router remain authoritative for provider choice. No frontend selection, cookie, query parameter, or UI label may call Gemini or override entitlement policy.

## Password and email controls

Passwords will use a salted server-side PBKDF2-SHA-256 verifier with a high configured iteration count. Plaintext passwords are not logged, stored, returned, emailed, or written to D1. The system will use generic failure messages for sign-in and reset requests to avoid account enumeration.

Email verification and password reset use hashed, single-use, expiring opaque tokens. Customer delivery requires a verified Resend sender/domain. Until such a sender is configured, only the existing test-owner email delivery behavior is available; customer email delivery must not be claimed as live.

## Payment and activation controls

The existing `tenant_payment_requests` table applies to a live `client_id`. The new onboarding payment record remains separate until a managed connection produces a real tenant. Owner approval does **not** automatically create a WhatsApp sender or inject credentials; it changes the onboarding state to connection planning. The customer receives a tenant membership only after the managed connection creates an active tenant.

## Security invariants

1. Owner password gate and Google owner verification remain unchanged and exclusive to `/owner`.
2. Customer password sessions use the same opaque hashed session model and are separate from owner-gate cookies.
3. A customer onboarding account can view only its own request/status using the authenticated user ID, never an email supplied by the browser.
4. Payment approval requires the owner platform role and same-origin request protection.
5. Customer Meta/WhatsApp credentials are not collected by public signup or payment forms.
6. No owner Meta credential is assigned to a new customer.
7. All onboarding and payment state transitions create redacted audit events.
8. An active operational dashboard still requires an active `tenant_memberships` row attached to an active live tenant.
