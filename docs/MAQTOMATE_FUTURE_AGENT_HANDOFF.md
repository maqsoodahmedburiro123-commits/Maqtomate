# Maqtomate — Future Agent Production Handoff

**Document status:** Current as of 22 August 2026 (Pakistan time).  
**Purpose:** Give a future Manus agent enough verified context to continue safely without asking the owner to repeat history, share secrets, or risk the owner’s personal WhatsApp account.

> **Read this entire file before changing Cloudflare, Meta, D1, KV, GitHub, or any credential. Do not trust legacy staging services. Do not ask the owner to paste a secret into chat.**

## 1. Product and non-negotiable safety boundary

Maqtomate is a multi-tenant, official-Meta-API-only **WhatsApp AI Employee** platform. It is being built for text replies, WhatsApp voice-note intake, lead extraction, follow-up tasks, tenant-isolated reporting, and an owner oversight console. It is not an unofficial WhatsApp session, QR, or browser automation product.

The owner’s personal WhatsApp number **`03111232752` / `+92 311 1232752` is recipient-only** for controlled testing. It must **never** be registered as a Cloud API sender, disconnected, migrated, inserted into any sender-ID variable, attached to a WABA, or changed in Meta. The dedicated Maqtomate test sender is separate and is the only sender asset allowed for the owner-first test.

| Rule | Required behavior |
|---|---|
| Credentials | Never echo, log, commit, screenshot, or request Meta tokens, Gemini keys, Cloudflare API tokens, App Secrets, OAuth secrets, OTPs, passwords, or bridge secrets in chat. |
| Tenant isolation | Customer data, conversations, secrets, reports, leads, and memberships must remain tenant-scoped in D1. |
| Meta setup | Customers must eventually use official Meta Embedded Signup; do not require Meta Developer Dashboard access, tokens, passwords, OTPs, WABA IDs, App Secrets, or Cloudflare access. |
| Voice and calls | V2 schema foundation exists but calls, recording, storage, transcription, RAG, and advanced automation remain disabled until separately approved, consented, costed, and tested. |
| Staging | Do not use, edit, or enter secrets into `maqtomate-worker-staging` or `maqtomate-portal-staging` during owner activation. |

## 2. Live production inventory

| Component | Production name / identifier | Status |
|---|---|---|
| Core Worker | `maqtomate-worker` | Live; current version `2ca792cb-2c25-41ee-a287-d3a0c1f42b9d` |
| Portal Worker | `maqtomate-portal` | Live; current version `75322ae0-fb06-4650-b5ca-21a5e53efbd7` |
| Owner Console | `https://maqtomate-portal.moviesmaqxanimation.workers.dev/owner` | Live and owner confirmed it opens; Google owner session works |
| Core public URL | `https://maqtomate-worker.moviesmaqxanimation.workers.dev` | Live |
| D1 database | `maqtomate-db` — `e05012b3-3c59-407f-b073-41183cf5a07c` | Production D1 |
| KV namespace | `fbf76e29e82e46ef9b19a828ae5b369e` | Production KV |
| GitHub repository | `maqsoodahmedburiro123-commits/Maqtomate` | Public; latest committed source before current live bridge work: `4ff6c04` |
| Legacy staging Worker | `maqtomate-worker-staging` | Legacy; do not use for owner activation |
| Legacy staging Portal | `maqtomate-portal-staging` | Legacy; do not use for owner login or credential forms |

### Current live tenant state

The canonical owner test tenant is **client ID 2**, business name **`Maqtomate Owner Test Tenant`**. It is active and payment-exempt. The owner user has an active `customer_admin` membership, while the platform role remains `owner`.

| Sender state | Latest verified value |
|---|---|
| Dedicated sender present | `PHONE_FOUND` |
| Webhook connection state | `VERIFIED` |
| Sender phone state | `FOUND` |
| Encrypted WhatsApp token envelope | Present |
| Token status | `INVALID` — current saved temporary token is rejected/expired |
| Personal number usage | Recipient-only; no sender registration or migration |

The dedicated Maqtomate test assets are separate from the owner’s personal WhatsApp. The known dedicated test phone ID is `1195835330290417`, the dedicated test WABA ID is `2021200748859223`, and the displayed test sender is `+1 (555) 661-6458`.

## 3. Verified current code and deployment work

### Completed owner authentication and console work

Google OAuth is the primary owner login. The approved owner identity is `maqsoodahmedburiro123@gmail.com`. The Portal uses secure HTTP-only session cookies, owner/platform-role checks, server-rendered Owner Console rendering, D1-backed sessions, and owner-only routes. Magic-link fallback exists but is not the primary operational login due to Resend test-mode constraints.

The Owner Console correctly displays live production sender state without showing any token, key, personal number, or secret. The current production console was visually confirmed by the owner after the latest deployment.

### Root cause of the repeated credential-check failure

The initial Owner Console failure was not caused by the Meta App Secret, Gemini key, mobile browser, or token field. Investigation showed two separate issues:

1. The canonical owner tenant’s legacy `clients.phone_number_id` was a placeholder, while the real sender phone ID lived in `tenant_whatsapp_connections`. `getOwnerTestTenant()` was fixed to prefer `COALESCE(wc.phone_number_id, c.phone_number_id)`.
2. The Portal-to-core HTTPS bridge used two duplicated Worker secrets. Repeated production diagnostics proved the Portal received **HTTP 404** from the core (`saved_credential_bridge_failed` audit events), which meant the duplicate internal secret values still did not match at runtime despite rotations.

The current live code removes this fragile production dependency for owner credential actions. The Portal now uses a **private Cloudflare Service Binding** named `OWNER_TEST_BRIDGE` to call the core `OwnerTestCredentialBridge` RPC entrypoint. The service binding avoids the public Internet and eliminates the Portal’s dependency on a manually matched HTTP bridge secret for credential health and renewal.[1] [2]

### Current bridge implementation

| Location | Current implementation |
|---|---|
| `worker.js` | Exports `OwnerTestCredentialBridge`, with `credentialHealth()` and `renewCredential(replacementToken)` methods. These return only `{ http_status, payload: { success, token_status } }`; they never return token text. |
| `portal-worker.js` | Calls `env.OWNER_TEST_BRIDGE.credentialHealth()` and `env.OWNER_TEST_BRIDGE.renewCredential(replacementToken)`. |
| `wrangler.portal.toml` | Contains `[[services]] binding = "OWNER_TEST_BRIDGE"`, `service = "maqtomate-worker"`, and `entrypoint = "OwnerTestCredentialBridge"`. |
| Legacy HTTP routes | Retained temporarily behind their existing core shared-secret guard for compatibility; Portal does not use them for owner credential actions anymore. |
| Diagnostics | Portal audit events record only `bridge_http_status`, `bridge_response_class`, and `credential_plaintext_accessed: false` if a bridge call fails. |

> **Important current checkpoint:** The service-binding code is deployed, production Portal opens, and all 37 regression tests passed before deployment. The next required proof is for the owner to tap **“Check saved bot credential”** in the production Owner Console after the service-binding release. The expected safe result is a returned `INVALID` token state, not a black “temporarily unavailable” error page. The user has not yet supplied that post-service-binding button result.

## 4. Cloudflare configuration map

The full human-readable configuration mapping is in [`OWNER_CLOUDFLARE_CONFIGURATION_GUIDE.md`](./OWNER_CLOUDFLARE_CONFIGURATION_GUIDE.md). Do not duplicate or type every secret into every Worker. Each secret has one correct scope.

### Core Worker — `maqtomate-worker`

The core uses production D1 and KV bindings named `MAQVORA_DB` and `MAQVORA_KV`. Its significant secrets are `APP_SECRET`, `GEMINI_API_KEY`, `ADMIN_API_KEY`, `MASTER_VERIFY_TOKEN`, `TENANT_DATA_ENCRYPTION_KEY`, `PORTAL_CORE_SHARED_SECRET`, `OWNER_TEST_PHONE_NUMBER_ID`, `OWNER_TEST_WABA_ID`, and protected owner-test operational tokens. Core feature flags for voice/calls/workflows remain explicitly set to `false`.

Do **not** casually change `TENANT_DATA_ENCRYPTION_KEY`. It protects existing D1 tenant secret envelopes; replacing it risks making currently encrypted data inaccessible. Do not put an owner Meta temporary token into Cloudflare variables. Tenant sender tokens must be written through the owner-only encrypted renewal workflow.

### Portal Worker — `maqtomate-portal`

The Portal uses the same production D1 and KV bindings, Google OAuth client credentials, Resend fallback configuration, Turnstile configuration, `PORTAL_URL`, and `CORE_WORKER_URL`. It now also has the private `OWNER_TEST_BRIDGE` service binding. `CORE_WORKER_SHARED_SECRET` may remain present during compatibility migration, but it is no longer the operational path for owner credential health/renewal.

### Visible Cloudflare dashboard names

The owner’s screenshots were accurate: Cloudflare displays **“Value encrypted”** for secret fields. This proves a secret binding exists, but does not prove an arbitrary new value is correct. Do not re-enter all secrets from scratch. Re-enter a credential only when its authoritative provider value was deliberately rotated or the specific binding is confirmed missing.

## 5. Meta and AI integrations

| Integration | Current state | Safe next action |
|---|---|---|
| Meta WhatsApp Cloud API | Dedicated Maqtomate test asset attached to owner tenant; current temporary token invalid | After bridge-health proof, create a fresh temporary token in the dedicated Maqtomate Meta App → WhatsApp → API Setup and submit it once via the production Owner Console. |
| Meta webhook | Worker webhook route exists; sender connection says `VERIFIED` | Confirm the `messages` field subscription in the dedicated Maqtomate app before inbound end-to-end testing. |
| Gemini | Platform fallback secret is configured in core; model stack uses `gemini-3.6-flash` | Do not rotate without a new valid Google AI Studio key. |
| Google OAuth | Production owner login works | Keep the Google client ID and client secret paired. |
| Resend | Magic-link fallback exists but test-mode delivery is unreliable beyond allowed inboxes | Keep Google login as primary until a verified sending domain is added. |

## 6. Required next sequence

Perform these in order. Do not skip from an error screen directly to a new Meta token.

1. The owner opens the exact production link with no space: `https://maqtomate-portal.moviesmaqxanimation.workers.dev/owner`.
2. The owner signs in through Google, if prompted.
3. The owner taps **Check saved bot credential**. The token input remains empty.
4. If the result returns to the Owner Console with `INVALID`, query D1/audit only if needed to confirm no bridge error occurred. The private service binding is then proved.
5. The owner opens the dedicated Maqtomate Meta App’s WhatsApp **API Setup** page and generates a fresh temporary token for **only** the dedicated Maqtomate test sender.
6. The owner pastes the new token one time into **Renew dedicated test credential** and taps **Validate and securely save new Meta token**. The token must never be pasted into Cloudflare, GitHub, chat, a staging Worker, or a screenshot.
7. Verify token state is `VALID` (or the deliberately accepted limited test-scope state) through the Owner Console and safe D1 connection metadata only.
8. Confirm Meta has subscribed the dedicated WABA/app to the `messages` webhook field.
9. Conduct the controlled text test: owner personal WhatsApp sends a message to the dedicated test sender, or the protected owner-test route sends a controlled message to the personal number as recipient only. Verify webhook receipt → signature validation → tenant routing → Gemini response → outgoing WhatsApp reply → audit/log/lead evidence.
10. Rotate the Cloudflare API token that was previously shown in a development screenshot before a production launch. Do not rotate active encryption or internal operational secrets without a migration plan.

## 7. Known technical constraints and deferred work

| Area | Current decision |
|---|---|
| Meta Embedded Signup | Required future customer onboarding path; not yet implemented. |
| Customer billing | Manual payment-gated activation is current policy. Owner test tenant is payment-exempt. |
| Voice, calls, recording, R2, Vectorize, Workers AI transcription | Schema foundation only; feature flags disabled. Require consent, retention, cost controls, isolation, and end-to-end tests before enabling. |
| Retell / paid telephony | Rejected as the core WhatsApp solution. It can only be reconsidered later as a separate optional paid AI Call Employee using a distinct business number. |
| V2 overwrite proposal | Rejected. Only additive migration 008 was applied. Do not overwrite Worker/schema with an unverified V2 package. |
| Staging scripts | Legacy only. Do not delete them without owner confirmation, but do not use them for activation. |

## 8. Source repository and current uncommitted work

The live service-binding deployment is ahead of GitHub’s latest committed SHA. Before handing off or starting other features, a future agent should inspect, test, then commit and push the currently modified files.

| File | Reason it is modified / added |
|---|---|
| `worker.js` | Canonical owner sender lookup plus private `OwnerTestCredentialBridge` RPC entrypoint. |
| `portal-worker.js` | Portal credential health/renewal changed from public HTTP shared-secret fetch to private service binding. |
| `wrangler.portal.toml` | Adds `OWNER_TEST_BRIDGE` service binding. |
| `test/owner-test-sender-route.test.mjs` | Regression coverage for service binding and token-safe bridge behavior. |
| `docs/OWNER_CLOUDFLARE_CONFIGURATION_GUIDE.md` | Safe production-versus-staging configuration map. |
| `todo.md` | Production activation history and outstanding tasks. |
| `docs/MAQTOMATE_FUTURE_AGENT_HANDOFF.md` | This document. |

### Required pre-push checks

```bash
cd /home/ubuntu/maqtomate/worktree
node --test test/*.test.mjs test/unit/*.test.mjs
git status --short
git add worker.js portal-worker.js wrangler.portal.toml test/owner-test-sender-route.test.mjs todo.md docs/
git commit -m "fix(owner): private credential bridge via service binding"
git push origin main
```

Do not commit `.env` files, raw downloaded screenshots, access tokens, OAuth client secrets, Cloudflare tokens, Meta tokens, Gemini keys, or any plaintext tenant credential.

## 9. Future-agent operational checklist

1. Read this file and `OWNER_CLOUDFLARE_CONFIGURATION_GUIDE.md`.
2. Inspect `todo.md` and `git status --short` before changing code.
3. Use only production `maqtomate-worker` and `maqtomate-portal` for owner activation.
4. Use Cloudflare D1/KV/Worker read-only inspection first. Never reveal secret values.
5. Never ask the owner for a token in chat. Keep temporary Meta tokens in the production Owner Console only.
6. Run the 37-test suite after every credential, bridge, auth, or tenant-routing change.
7. Use version upload/deploy flow for Cloudflare Workers and verify the deployed live version.
8. Log safe status, not secret data. For bridge errors, audit HTTP class and token-safe result only.
9. Preserve recipient-only handling for the personal WhatsApp number.
10. Do not declare activation complete until a real official WhatsApp text reply has been proven end-to-end.

## 10. References

[1] [Cloudflare Workers Best Practices — Use service bindings for Worker-to-Worker communication](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)  
[2] [Cloudflare Wrangler Configuration — Service bindings](https://developers.cloudflare.com/workers/wrangler/configuration/#service-bindings)
