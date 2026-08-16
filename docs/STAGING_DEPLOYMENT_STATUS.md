# Maqtomate Production V1.1 — Staging Deployment Status

## Isolated Staging Environment

| Component | Staging resource | Status |
|---|---|---|
| WhatsApp Worker | `https://maqtomate-worker-staging.moviesmaqxanimation.workers.dev` | Deployed with V1.1 modules and voice flags disabled. |
| Customer/Owner Portal | `https://maqtomate-portal-staging.moviesmaqxanimation.workers.dev` | Deployed with plan, usage, and automation-status views. |
| D1 | `maqtomate-staging-db` | Fresh schema plus migrations 002–006 applied. |
| KV | `maqtomate-staging-kv` | Dedicated staging namespace; not shared with production. |
| Worker secrets | Staging-only webhook, admin, verification, and encryption secrets | Created independently; no production secret was copied or exposed. |

## Verified Staging Checks

| Check | Result |
|---|---|
| Worker deployment and binding resolution | Passed. Staging Worker uses staging D1/KV only. |
| Portal deployment and availability | Passed with an HTTP 200 portal response. |
| Unsigned webhook request | Rejected with HTTP 403. |
| Signed webhook request | Accepted safely with HTTP 200. |
| Voice feature pause | Passed. A signed audio message generated exactly one `voice_feature_disabled` log event. |
| Voice cost/data safety | Passed. The audio test produced **0** voice-note records and **0** AI-usage records. No media download or transcription was required. |
| Fresh schema path | Passed locally with zero initial tenants and V1.1 provider/workflow/usage tables present. |
| Regression suite | Passed: 22 tests. |

## Intentionally Not Yet Tested in Staging

The following require the owner’s real third-party setup. They are deliberately blocked rather than simulated as completed.

| Test | Required configuration |
|---|---|
| Real WhatsApp text → Gemini response → WhatsApp reply | A staging Meta WhatsApp phone-number configuration and a production-capable Gemini key. |
| Magic-link email delivery | A staging-safe Resend configuration and verified sender domain, or a controlled test delivery path. |
| Customer login and owner payment approval journey | A staging test customer email and the email-delivery configuration above. |
| Real XLSX download through authenticated portal | A staging test user/session created through the secure auth flow. |
| Customer BYOK validation | A test-only customer Gemini credential that is encrypted in the staging envelope. |

## Promotion Rule

Production must remain unchanged until the outstanding staging checks pass. The approved promotion sequence is: apply Migrations 005 and 006 to production, deploy the V1.1 Workers with voice still disabled, verify non-production test traffic is not routed to production, then tag and synchronize the release in GitHub.
