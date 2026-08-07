# Maqtomate AI — Multi-Tenant Deployment Guide

> **From zero accounts to a live, multi-tenant WhatsApp bot platform in ~90 minutes.**

## What you're building

A single Cloudflare Worker that powers WhatsApp AI bots for unlimited clients. Each client has their own WhatsApp Business number, their own knowledge base, and their own admin view — all routed through one worker by `phone_number_id`.

```
┌─────────────────────────────────────────────────────────────┐
│                  Meta WhatsApp Cloud API                    │
│     Client A (phone #1) · Client B (phone #2) · Client C    │
└──────────────────────┬──────────────────────────────────────┘
                       │ Webhooks (one URL, multiple phone IDs)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              Single Cloudflare Worker                        │
│  Webhook handler → phone_number_id lookup → per-client logic │
│  Admin API + dashboard + audit log                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
   ┌─────────┐                  ┌─────────┐
   │   D1    │                  │   KV    │
   │ clients │                  │ history │
   │  logs   │                  │ dedup   │
   │  audit  │                  │ rate    │
   └─────────┘                  └─────────┘
        │
        ▼
   ┌─────────┐
   │ Gemini  │
   │   API   │
   └─────────┘
```

## Prerequisites

You'll need accounts on:
- **Cloudflare** (free tier is enough for 100k req/day)
- **Google AI Studio** (free tier is enough for 1,500 Gemini calls/day)
- **Meta Developer** (free; you need a Business App for WhatsApp)
- **GitHub** (optional, for code backup)

Plus for each client:
- A WhatsApp-enabled phone number (their existing business number, or a new one)
- A Meta Business account (we walk through this in §5)

## 0. The 5-Minute Decision

Before you start, decide:
- **Are you going single-tenant (one worker per client) or multi-tenant (one worker, many clients)?**
  - **Multi-tenant (recommended):** this guide. One worker, D1 database, scales to 100+ clients with zero extra ops work.
  - **Single-tenant:** see the legacy `env-config-guide.md` for the env-var approach. Not recommended — duplicated ops, harder to maintain.

If you went multi-tenant (you should), continue.

## 1. Cloudflare setup (15 min)

### 1.1 Create a D1 database

1. Log into [dash.cloudflare.com](https://dash.cloudflare.com)
2. Click **Workers & Pages** in the sidebar → **D1** → **Create database**
3. Name: `maqtomate-db`
4. Click into the database → **Console** tab
5. Open `backend/d1-schema.sql` from this kit, copy the entire contents, paste into the console
6. Click **Execute**

You should see `clients`, `logs`, `audit_logs` tables created with indexes. The kit also inserts one sample "Demo Dental Clinic" client — delete it before going to production.

### 1.2 Create a KV namespace

1. Still in **Workers & Pages** → **KV** → **Create a namespace**
2. Name: `maqtomate-kv`
3. Note the namespace ID (you'll bind it in a moment)

### 1.3 Deploy the worker

1. **Workers & Pages** → **Create** → **Create Worker**
2. Name: `maqtomate-bot` (or whatever you want — this becomes your webhook URL)
3. Click **Deploy** (it'll show a placeholder)
4. Click **Edit Code** → delete everything in the editor
5. Open `backend/maqtomate-multitenant-worker.js` from this kit, copy the entire file
6. Paste into the Cloudflare editor
7. Click **Save and Deploy**

### 1.4 Bind D1 + KV to the worker

1. In your worker → **Settings** tab → **Bindings** → **Add**
2. **D1 database:**
   - Variable name: `MAQVORA_DB`
   - D1 database: select `maqtomate-db`
   - Save
3. **KV namespace:**
   - Variable name: `MAQVORA_KV`
   - KV namespace: select `maqtomate-kv`
   - Save

### 1.5 Set environment variables (secrets)

Worker → **Settings** → **Variables and Secrets** → add:

| Variable | Type | Value | How to get it |
|----------|------|-------|---------------|
| `GEMINI_API_KEY` | Secret | `AIzaSy...` | [aistudio.google.com](https://aistudio.google.com) → API keys → Create |
| `ADMIN_API_KEY` | Secret | (long random string) | Generate with `openssl rand -hex 32` or use a password manager |
| `MASTER_VERIFY_TOKEN` | Secret | (random string) | Same as above — used as fallback for Meta webhook verification |
| `APP_SECRET` | Secret | (hex string) | [developers.facebook.com](https://developers.facebook.com) → Your App → Settings → Basic → App Secret → Show |

**Critical:** `APP_SECRET` is what prevents anyone from POSTing fake WhatsApp payloads to your worker. Without it, someone could burn your Gemini quota and send messages to your real customers. See §6 for the security implications.

Click **Save** then **Deploy**.

### 1.6 Verify the worker is up

Visit `https://maqtomate-bot.YOUR-SUBDOMAIN.workers.dev/admin` — you should see the admin dashboard prompt for an API key. Enter your `ADMIN_API_KEY` and you should see the empty clients list.

If you see a 404 or error, check the worker logs (Worker → Logs tab) for the actual problem.

## 2. Google AI Studio setup (5 min)

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Sign in with the Google account that will own the API key
3. **Get API key** → **Create API key** → copy it
4. **Critical:** Go to [console.cloud.google.com](https://console.cloud.google.com) → Billing → confirm billing is **disabled**. If billing is enabled, your free tier silently converts to paid and you can rack up charges from a bug or attack.
5. Paste the key into your worker's `GEMINI_API_KEY` secret (if you haven't already)

**Model selection:** the worker defaults to `gemini-1.5-flash`. As of August 2026, that's still a stable free-tier model. If you want to upgrade:
- Set `client.gemini_model` in D1 per-client, or
- Change the default in the worker code (search for `gemini-1.5-flash`)

**Free tier limits:** 1,500 requests/day, 15 RPM. Each bot reply = 1 request. If you exceed the RPM limit, you'll get 429 errors and the user will see the Urdu fallback message. If you exceed the daily limit, the bot stops working until midnight Pacific. Watch this as you scale.

## 3. Meta setup (30 min)

This is the part that takes longest because of Meta's verification.

### 3.1 Create a Meta Business App

1. Go to [developers.facebook.com](https://developers.facebook.com) → **My Apps** → **Create App**
2. Type: **Business**
3. Name: `Maqtomate AI` (or whatever)
4. Contact email: your business email
5. Once created, find the **App ID** and **App Secret** (Settings → Basic → App Secret → Show) — the App Secret is what you set as `APP_SECRET` in your worker

### 3.2 Add WhatsApp product

1. In your app dashboard → **Add Product** → **WhatsApp** → **Set Up**
2. You'll be asked to select or create a Meta Business Account. If you don't have one, create one.
3. **API Setup** page will show:
   - **Phone Number ID** (this is what each client will need)
   - **WhatsApp Business Account ID**
   - A temporary **Access Token** (24-hour validity, for testing)

### 3.3 Register your webhook

1. In the WhatsApp product → **Configuration** → **Webhook** → **Edit**
2. **Callback URL:** `https://maqtomate-bot.YOUR-SUBDOMAIN.workers.dev/`
3. **Verify Token:** the value of your `MASTER_VERIFY_TOKEN` secret
4. Click **Verify and Save** — your worker should respond with the challenge
5. Under **Webhook Fields**, subscribe to: `messages`

### 3.4 Get a permanent access token (for real clients)

The 24-hour test token is only for your own test number. For real clients, you need a System User token:

1. Meta Business Settings → **Users** → **System Users** → **Add**
2. Name: `Maqtomate Bot`, role: Admin
3. **Add Assets** → select your WhatsApp Business Account → toggle **Manage**
4. **Generate New Token** → select your app → permissions: `whatsapp_business_management`, `whatsapp_business_messaging`
5. **Save the token** — this never expires unless you revoke it

## 4. Add your first client (10 min)

You have two ways to add a client:

### Option A: Admin dashboard (easiest)

1. Visit `https://maqtomate-bot.YOUR-SUBDOMAIN.workers.dev/admin`
2. Enter your `ADMIN_API_KEY`
3. Click **+ Add Client**
4. Fill the form:
   - Business name
   - Niche
   - Country
   - **Mode** (1/2/3) — see pricing doc for which to pick
   - Monthly fee
   - **Phone Number ID** — from Meta (per-client)
   - **WhatsApp Token** — the System User token (per-client)
   - **Gemini API key** (only if Mode 1) — client's own key
   - Working hours, location, services, pricing, contact number
5. Click **Create Client**
6. You'll see a success message with the new client ID

### Option B: Have the client fill the onboarding form

1. Open `onboarding/universal-onboarding-form.html` in your browser
2. Send the link to your client (or fill it on their behalf)
3. They walk through 4 steps, click "Submit & Copy"
4. The form auto-copies a JSON blob to their clipboard
5. They paste it into a WhatsApp message to you
6. You paste that JSON into the admin form (or directly into D1)

**Time saved:** the form is designed to pre-fill 80% of the fields based on their niche — they just verify and tweak.

## 5. Test the bot (5 min)

1. From a phone that's NOT the registered WhatsApp Business number, send a WhatsApp message to the business number
2. Within 10 seconds, you should get an AI-generated reply
3. Try a few message types:
   - Plain text (FAQ question)
   - Voice note (in Urdu or English)
   - Image (with or without caption)
   - Human handoff trigger ("I want to talk to a human")
4. If replies don't come:
   - Check worker logs (Worker → Logs tab)
   - Verify the `phone_number_id` in D1 matches what Meta shows
   - Verify `active = 1` in D1
   - Check `GEMINI_API_KEY` quota in Google AI Studio

## 6. Security checklist

Before going to production with real clients:

- [ ] `APP_SECRET` is set as an encrypted secret in Cloudflare
- [ ] `ADMIN_API_KEY` is at least 32 random characters
- [ ] `MASTER_VERIFY_TOKEN` is a random string, not "test" or "maqtomate"
- [ ] D1 database is not publicly accessible (Cloudflare handles this by default — verify by trying to hit the DB directly)
- [ ] KV namespace is not publicly accessible (same — default)
- [ ] No API keys, tokens, or secrets are committed to Git
- [ ] Sample "Demo Dental Clinic" client deleted from D1
- [ ] Each client has a unique `verify_token` (auto-generated by the worker, but verify)
- [ ] Rate limiting is on (default 20 msgs/60s — see worker code `checkRateLimit`)
- [ ] Webhook signature verification is on (APP_SECRET set)
- [ ] Billing is DISABLED on the Google Cloud project behind `GEMINI_API_KEY` — confirm at [console.cloud.google.com/billing](https://console.cloud.google.com/billing)

## 7. Going to production checklist

- [ ] Remove sample data from D1 (`DELETE FROM clients WHERE business_name = 'Demo Dental Clinic';`)
- [ ] Pick your launch pricing (see `docs/pricing-canonical.md` for the 3-Mode structure)
- [ ] Set up payment collection (JazzCash/Easypaisa for PK, Stripe for international)
- [ ] Deploy a niche landing page (in `pages/`) to Cloudflare Pages
- [ ] Set up the universal onboarding form somewhere clients can access it
- [ ] Test end-to-end with a paying client (even if it's a friend discounted to 50%)
- [ ] Monitor Gemini free tier usage for the first 2 weeks — if you hit limits, you need a paid key or stricter rate limiting
- [ ] Set up a way to receive client feedback (a Google Form, a Typeform, or just a WhatsApp group)

## 8. Adding more clients

The whole point of multi-tenant: each new client is just a row in D1. No new worker, no new DNS, no new ops.

Repeat §4 for each new client. You'll be doing 30-40 min of work per client (mostly waiting for Meta verification) once you're past the first 3.

## 9. Scaling beyond 20 clients

- **20-50 clients:** start seeing Gemini free-tier pressure. Options:
  - Move Mode 2/3 clients to their own BYOK keys (Mode 1)
  - Upgrade to a paid Gemini plan ($0.075 per 1M input tokens for Flash)
  - Implement per-client rate limits (lower the 20/60s default for noisy clients)
- **50-100 clients:** you're hitting Cloudflare Worker free-tier limits (100k req/day). Upgrade to the $5/month Workers Paid plan.
- **100+ clients:** seriously consider:
  - Moving logs to a separate analytics DB (D1 reads get slow at 100k+ rows)
  - Adding a real LLM abstraction layer (today `callGemini` is hardcoded)
  - Building the client portal (per the roadmap in `docs/built-vs-roadmap.md`)

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Webhook verification fails | `MASTER_VERIFY_TOKEN` mismatch | Check Cloudflare secret matches what you entered in Meta console |
| Bot returns Urdu fallback | Gemini API error or quota exceeded | Check Google AI Studio quota; check worker logs for `[GEMINI ERROR]` |
| Messages not received | Webhook not subscribed to `messages` event | Meta console → Webhook → subscribe to `messages` |
| "Forbidden" on every POST | Signature verification failing | Check `APP_SECRET` matches Meta App Secret exactly |
| No conversation memory | KV not bound | Worker → Settings → Bindings → add `MAQVORA_KV` |
| Admin dashboard says "Unauthorized" | Wrong `ADMIN_API_KEY` | Re-enter the secret in the prompt |
| Bot replies in English when customer writes Urdu | System prompt needs reinforcement | Check the `buildSystemPrompt` function in worker |
| Rate limit hit | Customer / bot sending too fast | Default is 20/60s — raise in worker code if needed |

## 11. What you do NOT need to do

- No Dockerfile
- No Kubernetes
- No CI/CD pipeline
- No custom domain (workers.workers.dev is fine for now)
- No monitoring service (Cloudflare Worker logs are enough at <100 clients)
- No LLM observability tool (worker logs show every Gemini call)

If someone tells you to add any of these before you have 20 paying clients, they're selling you something you don't need yet.

---

**You now have a production-grade multi-tenant WhatsApp AI platform. Go sell.** 🚀
