# Merge note (this session)

A second, independently-built implementation ("Manus") was already live in
Cloudflare as Worker `maqtomate-worker`, deployed directly via Cloudflare API
token — NOT through this GitHub repo. Its own D1 (`maqvora-db`, old name) and
KV (`maqvora-kv`, old name) were separate from this repo's resources.

## What was merged
- This repo's `worker.js` (real per-client WhatsApp tokens, real voice/image
  processing via Gemini multimodal, per-client Mode 1 BYOK, HMAC signature
  verification, rate limiting) is the base — kept as-is because Manus's
  version had one critical bug: it referenced `client.meta_access_token`,
  a column that **does not exist in its own schema**, meaning it could
  receive and log messages but could never actually send a WhatsApp reply.
- Adopted from Manus: hashing the admin token in `audit_logs.actor`
  (SHA-256, truncated) instead of a hardcoded `'admin'` string — small,
  genuine improvement, added to `writeAuditLog()`.
- `wrangler.toml`'s `name` changed to `maqtomate-worker` to match the
  Worker that's already live, so connecting this repo via Cloudflare's
  "Import a repository" updates that same Worker instead of creating a third.

## Cleanup done directly in Cloudflare (not via any leaked token — used the
## already-authorized Cloudflare connector)
- Deleted duplicate D1 database `maqvora-db` (0 client rows, safe)
- Deleted duplicate KV namespace `maqvora-kv` (unused)

## Still true after this merge
The live `maqtomate-worker` in Cloudflare is running Manus's OLD code until
you connect this repo via Cloudflare dashboard → Workers & Pages → Import a
repository (see DEPLOY-NOW.md). Pushing to GitHub alone does not update it.
