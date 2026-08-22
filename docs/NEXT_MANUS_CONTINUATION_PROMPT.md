# Copy-Paste Prompt for the Next Manus Agent

```text
Continue Maqtomate production activation. Read these two files first:
1. /home/ubuntu/maqtomate/worktree/docs/MAQTOMATE_FUTURE_AGENT_HANDOFF.md
2. /home/ubuntu/maqtomate/worktree/docs/OWNER_CLOUDFLARE_CONFIGURATION_GUIDE.md

Then inspect /home/ubuntu/maqtomate/worktree/todo.md and git status before making any change.

Critical safety rules:
- The owner personal WhatsApp +92 311 1232752 / 03111232752 is recipient-only. Never migrate, disconnect, register, or use it as a Cloud API sender.
- Use official Meta WhatsApp Cloud API only. No QR/session/unofficial library workaround.
- Never ask for or expose Meta tokens, Cloudflare tokens, Gemini keys, App Secrets, OAuth secrets, passwords, or OTPs in chat, screenshots, GitHub, logs, or UI.
- Do not use maqtomate-worker-staging or maqtomate-portal-staging for activation or credential entry.
- Use the production Owner Console only: https://maqtomate-portal.moviesmaqxanimation.workers.dev/owner

Current live state:
- Production core Worker: maqtomate-worker, version 2ca792cb-2c25-41ee-a287-d3a0c1f42b9d.
- Production Portal Worker: maqtomate-portal, version 75322ae0-fb06-4650-b5ca-21a5e53efbd7.
- Owner Console opens and shows canonical client ID 2: Maqtomate Owner Test Tenant.
- Dedicated sender status: PHONE_FOUND, webhook VERIFIED, sender FOUND, encrypted token record present, current token INVALID.
- Previous Portal-to-core shared-secret bridge repeatedly returned 404. It has now been replaced by a private Cloudflare service binding named OWNER_TEST_BRIDGE calling core entrypoint OwnerTestCredentialBridge.
- Full regression suite was 37/37 passing before deploy.
- The next proof is to have the owner tap “Check saved bot credential” in the production Owner Console with the token input empty. The expected result is INVALID, not “temporarily unavailable.”

Immediate goal:
1. Verify the post-service-binding credential-health action through production evidence/audit without revealing a token.
2. Only after it returns INVALID normally, guide the owner to generate a fresh temporary Meta token for the dedicated Maqtomate test sender +1 (555) 661-6458, and submit it once through the Owner Console renewal field.
3. Verify token state securely, ensure Meta `messages` webhook subscription is active, then prove an official WhatsApp text → Worker → Gemini → WhatsApp reply path with the personal number as recipient only.

Before claiming completion, sync the current uncommitted service-binding changes to GitHub after tests. Do not delete legacy staging Workers without explicit owner confirmation.
```
