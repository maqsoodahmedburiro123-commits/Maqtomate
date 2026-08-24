# Maqtomate Cloudflare Configuration — Exact Safe Placement Guide

**Reviewed:** 24 August 2026  
**Purpose:** Tell the owner exactly which Maqtomate component owns each configuration item, without disclosing values or encouraging unsafe replacement of working credentials.

> **Current conclusion:** Do **not** delete or re-enter your existing Worker secrets now. The live Owner Command System reports the core database, KV binding, Meta App Secret, webhook verification token, Gemini connection, encryption-key format, and owner sender vault as healthy. The missing controlled test is therefore more likely the Meta test-recipient / conversation-window prerequisite than a Cloudflare secret-placement failure.

## First: use the right Cloudflare page

For a Worker runtime secret, go to:

```text
Cloudflare Dashboard
→ Workers & Pages
→ Select the exact Worker name
→ Settings
→ Variables and Secrets
→ Add (or Edit only when a specific value is known to be wrong)
→ Choose “Secret” — never plain-text Variable for credentials
```

The two Maqtomate Workers are different systems:

| Worker | What it does | Do not mix its secrets with |
|---|---|---|
| **`maqtomate-worker`** | Core WhatsApp webhook, tenant routing, Gemini, encrypted credential vault, and private Owner service. | Portal login/email/Turnstile settings. |
| **`maqtomate-portal`** | Public website, login, customer/owner pages, rollout intake, and private service-binding caller. | Meta App Secret, Gemini key, tenant encryption key, and WhatsApp tokens. |

## `maqtomate-worker` — Core Worker

Open **Workers & Pages → `maqtomate-worker` → Settings → Variables and Secrets**.

| Name in the current Worker source | Where the value originally comes from | Treat as | Current action |
|---|---|---|---|
| `APP_SECRET` | Meta Developer Dashboard → App Settings → Basic → App Secret | Secret | **Already reported configured. Do not replace.** |
| `MASTER_VERIFY_TOKEN` | A high-entropy private string created for Maqtomate’s webhook verification | Secret | **Already reported configured. Do not replace.** It must match the value entered in Meta’s Webhook configuration. |
| `GEMINI_API_KEY` | Google AI Studio / Google Gemini API key | Secret | **Already reported reachable. Do not replace.** |
| `ADMIN_API_KEY` | Private Maqtomate admin credential | Secret | **Already format-valid. Do not replace.** |
| `TENANT_DATA_ENCRYPTION_KEY` | Private Maqtomate encryption key | Secret | **Already format-valid. Never rotate casually**, because existing encrypted tenant credentials depend on it. |
| `OWNER_TEST_RECIPIENT_MSISDN` | Owner-controlled private recipient number, digits only | Secret | **Already used privately. Never display it, never place it in public code, and never use it as a sender.** |
| `OWNER_TEST_PHONE_NUMBER_ID` | Dedicated Maqtomate test sender Phone Number ID | Secret/owner-only configuration | **Already reported found. Do not replace.** |
| `OWNER_TEST_WABA_ID` | Dedicated Maqtomate test sender WhatsApp Business Account ID | Secret/owner-only configuration | **Already reported found. Do not replace.** |
| `OWNER_TEST_HANDOFF_TOKEN`, `OWNER_TEST_SYNC_TOKEN`, `PORTAL_CORE_SHARED_SECRET` | Legacy/internal owner-path compatibility values | Secret | Do not create or change these manually. The current Owner path uses a private Cloudflare service binding instead of browser or public token handling. |

### Important correction

An older comment in `wrangler.toml` mentions `VERIFY_TOKEN`. The **current core Worker source expects `MASTER_VERIFY_TOKEN`**. Do not add a new `VERIFY_TOKEN` just because you see that old comment.

### Core bindings — not secrets

These should remain configured on the Core Worker and must not be pasted as secret text:

| Binding | Current target | Action |
|---|---|---|
| `MAQVORA_DB` | Production D1 database `maqtomate-db` | Already healthy; do not change. |
| `MAQVORA_KV` | Production Maqtomate KV namespace | Already configured; do not change. |

## The WhatsApp access token is **not** a normal Cloudflare Worker secret

The dedicated sender’s Meta System User access token is stored in Maqtomate’s **encrypted tenant credential vault** after one-time validation. It is intentionally not a browser-visible Worker variable.

**Never**:

- paste it into the public website;
- add it to GitHub, `wrangler.toml`, a dashboard screenshot, browser local storage, or the demo ZIP;
- send it in chat;
- create a duplicate generic `WHATSAPP_TOKEN` just to test delivery.

If a real Meta token renewal is ever required, use the protected **Owner Console token-renewal flow** once. It validates and encrypts the value server-side, then masks it permanently.

## `maqtomate-portal` — Portal Worker

Open **Workers & Pages → `maqtomate-portal` → Settings → Variables and Secrets**.

| Name in the current Portal source | Purpose | Current action |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Owner Google sign-in client configuration | Leave unchanged while Google owner login works. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Owner Google sign-in secret | Leave unchanged while Google owner login works. |
| `RESEND_API_KEY` | Email/magic-link provider credential, if configured | Do not replace unless email delivery is specifically diagnosed as broken. |
| `EMAIL_FROM` | Approved email sender address | Change only with an approved verified sending-domain plan. |
| `TURNSTILE_SECRET` | Bot-protection server secret | Leave unchanged unless Turnstile is specifically failing. |

These Portal items are **not secrets** and are already declared in the Worker configuration:

| Name | Purpose | Action |
|---|---|---|
| `TEST_MODE_OWNER_EMAIL` | Owner access configuration | Do not alter casually. |
| `PORTAL_URL` | Public Portal URL | Must remain the live Maqtomate Portal URL. |
| `TURNSTILE_SITEKEY` | Public Turnstile site key | Not secret; leave configured. |
| `CORE_WORKER_URL` | Core Worker endpoint | Leave configured. |
| `OWNER_TEST_BRIDGE` | Private Cloudflare service binding to `maqtomate-worker#OwnerTestCredentialBridge` | Binding, not secret; do not replace with an HTTP token bridge. |
| `MAQVORA_DB`, `MAQVORA_KV` | Portal data bindings | Already configured; do not change. |

## Deployment credentials are not runtime secrets

`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_DEPLOY_TOKEN` are deployment/account credentials used outside the Worker runtime. **Do not add either one to a Worker’s Variables and Secrets page.** They do not fix webhook delivery or WhatsApp message delivery.

## What to do now

1. **Do not change Cloudflare secrets.** The health evidence does not support that theory.
2. Complete the official Meta **test recipient** and one-time reply steps in the app’s WhatsApp API Setup page.
3. Retry the protected Maqtomate test only once after the Meta test message arrives and you reply to it.
4. If a named runtime health check changes from healthy to missing/rejected, report only the check name—not any secret value—and use this guide to identify the exact Worker.

> Your personal WhatsApp remains recipient-only. This guide never asks you to register, migrate, disconnect, or use it as a Cloud API sender.

