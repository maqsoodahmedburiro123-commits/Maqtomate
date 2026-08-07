# Maqtomate — Multi-Tenant WhatsApp AI Platform

Production Cloudflare Worker + full agency kit (landing pages, onboarding
forms, sales scripts, docs).

## Deploy
`wrangler.toml` at repo root is already wired to live Cloudflare resources
(`maqtomate-db` D1, `maqtomate-kv` KV). See **DEPLOY-NOW.md** for exact
remaining steps (secrets, Meta webhook registration).

## Structure
- `worker.js` + `wrangler.toml` — the deployable Worker (repo root, so
  Cloudflare Workers Builds auto-detects it)
- `backend/` — schema + migration SQL (for reference / re-running manually)
- `docs/` — pricing decision, built-vs-roadmap, deployment guide
- `pages/` — niche landing pages (dental, salon, real estate, restaurant, generic)
- `onboarding/` — client onboarding form
- `sales/` — outreach scripts
