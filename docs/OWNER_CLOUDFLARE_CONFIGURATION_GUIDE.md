# Maqtomate Cloudflare Configuration Guide

## Use only the production services

Maqtomate has two **current production Workers** and two old **staging Workers**. The staging Workers are retained only as legacy test artifacts. They must not be used for owner login, credential renewal, Meta webhooks, or any customer operation.

| Purpose | Use this production Worker | Production URL | Do not use |
|---|---|---|---|
| WhatsApp webhook, AI processing, encrypted tenant credentials | `maqtomate-worker` | `https://maqtomate-worker.moviesmaqxanimation.workers.dev` | `maqtomate-worker-staging` |
| Owner login, customer dashboards, owner credential renewal | `maqtomate-portal` | `https://maqtomate-portal.moviesmaqxanimation.workers.dev/owner` | `maqtomate-portal-staging` |

> **Important:** The `-staging` URLs in the Cloudflare dashboard are old test services. They are not part of the live owner-first activation flow. Do not enter credentials or test the Owner Console there.

## Secret-entry rules

Cloudflare displays only that a secret exists; it never reveals the existing value. Therefore, a visible **“Value encrypted”** field confirms that a secret is stored, but it cannot confirm that a newly pasted value is correct. Replace a secret only when its exact authoritative source is known.

Never place a Meta temporary access token, a WhatsApp sender token, a personal WhatsApp number, an OTP, or a password in a Cloudflare runtime variable. The Owner Console validates a Meta temporary access token once and stores it encrypted per tenant in D1. This maintains tenant isolation and prevents accidental exposure through Cloudflare settings.

## Production core Worker: `maqtomate-worker`

Open **Workers & Pages → maqtomate-worker → Settings → Variables and Secrets** only when the relevant source credential has genuinely been rotated or confirmed missing.

| Cloudflare variable | Type | Authoritative source | Purpose | Owner action |
|---|---|---|---|---|
| `APP_SECRET` | Secret | Meta Developer Dashboard → App Settings → Basic | Verifies Meta webhook signatures | Replace only after rotating the Meta App Secret. |
| `GEMINI_API_KEY` | Secret | Google AI Studio | Tenant AI fallback | Replace only with a newly issued Gemini API key. |
| `ADMIN_API_KEY` | Secret | Maqtomate internal secure administration value | Protects internal administration routes | Do not change during owner activation. |
| `MASTER_VERIFY_TOKEN` | Secret | Maqtomate internal secure value | Meta webhook verification challenge | Do not change after Meta webhook verification without updating Meta at the same time. |
| `TENANT_DATA_ENCRYPTION_KEY` | Secret | Maqtomate internal cryptographic key | Encrypts tenant credentials in the vault | **Never replace casually.** Replacing it can make existing encrypted tenant credentials unreadable. |
| `PORTAL_CORE_SHARED_SECRET` | Secret | Legacy transitional bridge value | Protected compatibility route only | Do not manually edit. The active Owner Console bridge now uses the private `OWNER_TEST_BRIDGE` service binding. |
| `OWNER_TEST_PHONE_NUMBER_ID` | Secret | Meta WhatsApp API Setup for the Maqtomate test sender | Fixed dedicated test sender identifier | Must be the dedicated Maqtomate sender, never the owner’s personal number. |
| `OWNER_TEST_WABA_ID` | Secret | Meta WhatsApp API Setup | Dedicated Maqtomate test WhatsApp Business Account | Must match the dedicated Maqtomate app/test sender. |
| `OWNER_TEST_HANDOFF_TOKEN`, `OWNER_TEST_SEND_TOKEN`, `OWNER_TEST_SYNC_TOKEN` | Secret | Maqtomate internal secure values | One-time protected test operations | Do not manually modify. |
| `RESEND_API_KEY` | Secret | Resend dashboard | Legacy email sign-in fallback | Do not change while Google owner sign-in is working. |
| `MAQVORA_DB` | D1 binding | Cloudflare D1 | Production tenant data | Must point to `maqtomate-db`; do not change. |
| `MAQVORA_KV` | KV binding | Cloudflare KV | Sessions, rate limits, deduplication | Must point to the production Maqtomate KV namespace; do not change. |

The following core settings are intentionally plain text and currently disabled for controlled release: `VOICE_EMPLOYEE_ENABLED`, `VOICE_TRANSCRIPTION_ENABLED`, `VOICE_AUTO_PROCESSING_ENABLED`, `WORKFLOWS_ENABLED`, and `ADVANCED_WORKFLOWS_ENABLED`. Leave them set to `false` until their consent, storage, cost-control, and end-to-end approval work is complete.

## Production Portal Worker: `maqtomate-portal`

Open **Workers & Pages → maqtomate-portal → Settings → Variables and Secrets** only for Portal-specific configuration.

| Cloudflare variable | Type | Authoritative source | Purpose | Owner action |
|---|---|---|---|---|
| `OWNER_TEST_BRIDGE` | Service binding | Cloudflare Worker binding | Private Portal-to-core owner credential check and renewal RPC | Must target the production `maqtomate-worker` service. It replaces the active credential workflow's duplicate-secret dependency. |
| `CORE_WORKER_SHARED_SECRET` | Secret | Legacy transitional bridge value | Protected compatibility route only | Do not manually edit. The active Owner Console bridge now uses `OWNER_TEST_BRIDGE`. |
| `GOOGLE_OAUTH_CLIENT_ID` | Secret | Google Cloud Console → OAuth client | Starts Google owner sign-in | Replace only if a new Google OAuth client is created. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Secret | Google Cloud Console → same OAuth client | Completes Google owner sign-in | Replace only with the matching client secret for the configured client ID. |
| `RESEND_API_KEY` | Secret | Resend dashboard | Optional magic-link fallback | Leave unchanged unless the Resend key is explicitly rotated. |
| `TURNSTILE_SECRET` | Secret | Cloudflare Turnstile dashboard | Bot-protection verification | Replace only with the matching secret for the listed site key. |
| `CORE_WORKER_URL` | Text | Maqtomate production URL | The core bridge destination | Must be `https://maqtomate-worker.moviesmaqxanimation.workers.dev`. |
| `PORTAL_URL` | Text | Maqtomate production URL | Canonical Portal redirects | Must be `https://maqtomate-portal.moviesmaqxanimation.workers.dev`. |
| `TEST_MODE_OWNER_EMAIL` | Text | Approved owner email | Controlled bootstrap fallback | Must be the approved owner email. |
| `TURNSTILE_SITEKEY` | Text | Cloudflare Turnstile dashboard | Browser-side bot-protection widget | Must match `TURNSTILE_SECRET`. |
| `MAQVORA_DB` | D1 binding | Cloudflare D1 | Portal users, sessions, memberships, audit events | Must point to `maqtomate-db`; do not change. |
| `MAQVORA_KV` | KV binding | Cloudflare KV | Session and rate-limit state | Must point to the production Maqtomate KV namespace; do not change. |

## Manus Owner Center Cloudflare status token

The Manus Owner Center is a separate owner-only dashboard. It uses a server-only Cloudflare API token only to verify the infrastructure connection; its live fleet, tenant, health, and WhatsApp connection data continues to come through the protected production Worker API. Do not place this token in the Cloudflare Worker dashboard or in browser code.

Create the replacement in **Manage Account → Account API Tokens → Create Token → Start from scratch** with the name `Maqtomate Owner Center — Server Only`. Grant only **Developer Platform → Workers Scripts → Read**, scope it to this Cloudflare account, set a 90-day expiry, and leave IP filtering blank unless the application is deployed from a stable egress IP. Paste the one-time token value only into the Manus secure secret input named `CLOUDFLARE_API_TOKEN`; never paste it in chat, GitHub, a screenshot, or a Cloudflare Worker variable. After the Manus server-side validation succeeds, revoke only the expired token marked `Maqtomate`.

## Correct owner-first activation order

1. Open only the production Owner Console at `https://maqtomate-portal.moviesmaqxanimation.workers.dev/owner`.
2. Sign in with the approved Google account.
3. Use **Check saved bot credential**. This action does not change or reveal a Meta token.
4. Once it reports `INVALID` rather than a temporary bridge error, generate a fresh temporary token in the dedicated Maqtomate Meta App’s WhatsApp API Setup screen.
5. Paste that token once into **Renew dedicated test credential** in the production Owner Console. Do not paste it into Cloudflare, GitHub, chat, or staging.
6. Confirm the Portal reports `VALID`, then test the dedicated Maqtomate sender with the owner’s personal WhatsApp as a recipient only.

## Permanent safety boundaries

The personal WhatsApp number `03111232752` is a **recipient-only test number**. It must never be placed in `OWNER_TEST_PHONE_NUMBER_ID`, registered as a Cloud API sender, migrated, disconnected, or linked to a Meta business sender asset.

Customer credentials will follow the official Meta Embedded Signup path in a future approved flow. Customers must never be asked for a Meta password, OTP, permanent token, webhook URL, App Secret, WABA ID, or Cloudflare access.
