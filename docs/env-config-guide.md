# Maqtomate AI — Environment Variables Configuration Guide

## Overview
Each client gets their own isolated Cloudflare Worker. You configure the bot behavior entirely through Environment Variables — no code changes needed per client.

---

## REQUIRED Variables (Must be set for every client)

| Variable | Description | Example |
|----------|-------------|---------|
| `GEMINI_API_KEY` | Your Google AI Studio API key. One key can serve all clients. | `AIzaSyB...` |
| `WHATSAPP_TOKEN` | Meta System User Access Token for sending messages. | `EAAI...` |
| `PHONE_NUMBER_ID` | Meta WhatsApp Phone Number ID. | `123456789012345` |
| `VERIFY_TOKEN` | Custom string for webhook verification. Create once, use forever. | `maqtomate_secure_2026` |
| `APP_SECRET` | **Meta App Secret** (from developers.facebook.com → App Settings → Basic). Used to verify the `X-Hub-Signature-256` header on every incoming webhook so only Meta can POST messages to your worker. **Without this, anyone who finds your worker URL can send it fake WhatsApp payloads.** | `f3a1c9...` |
| `CLIENT_BUSINESS_NAME` | Name displayed in AI responses. | `Dr. Ahmed Dental Care` |
| `CLIENT_WORKING_HOURS` | Business timings. | `4PM - 9PM, Mon-Sat` |
| `CLIENT_LOCATION` | Address or location description. | `Auto Bhan Road, Hyderabad` |
| `CLIENT_SERVICES` | Comma-separated list of services/products. | `Dental Checkup, Teeth Cleaning, Root Canal` |
| `CLIENT_PRICING` | Pricing breakdown. Use newlines for readability. | `Checkup: Rs 500\nCleaning: Rs 1,500` |
| `CLIENT_CONTACT` | Human escalation contact. | `923111232752` |

---

## OPTIONAL Variables (Enhance behavior)

| Variable | Description | Default |
|----------|-------------|---------|
| `AI_NAME` | How the AI introduces itself. | `AI Customer Service Assistant` |
| `GEMINI_MODEL` | Gemini model to use. | `gemini-1.5-flash` |
| `CLIENT_NOTES` | Any extra business rules or info. | *(empty)* |
| `FALLBACK_MESSAGE` | Message when AI fails. | Urdu fallback |
| `UNSUPPORTED_MSG` | Message for unsupported message types. | Urdu fallback |

---

## How to Set Variables in Cloudflare

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Navigate to **Workers & Pages** → Select your worker
3. Click **Settings** tab → **Variables and Secrets**
4. Click **Add** for each variable
5. For sensitive values (API keys, tokens), check **Encrypt** to make them secrets
6. Click **Deploy** to save

---

## Quick Copy-Paste Template

Use this template when creating a new client worker. Fill in the brackets and paste into Cloudflare.

```
GEMINI_API_KEY = [YOUR_GOOGLE_AI_STUDIO_KEY]
WHATSAPP_TOKEN = [META_SYSTEM_USER_TOKEN]
PHONE_NUMBER_ID = [META_PHONE_NUMBER_ID]
VERIFY_TOKEN = maqtomate_secure_[RANDOM_STRING]
APP_SECRET = [META_APP_SECRET]
CLIENT_BUSINESS_NAME = [BUSINESS_NAME]
CLIENT_WORKING_HOURS = [TIMINGS]
CLIENT_LOCATION = [ADDRESS]
CLIENT_SERVICES = [SERVICE_LIST]
CLIENT_PRICING = [PRICE_LIST]
CLIENT_CONTACT = [OWNER_WHATSAPP]
AI_NAME = AI Assistant for [BUSINESS_NAME]
CLIENT_NOTES = [ANY_EXTRA_INFO]
```

---

## KV Namespace Binding (Required for Memory & Logs)

The worker uses Cloudflare KV for:
- **Conversation history** (so AI remembers context)
- **Duplicate message protection** (prevents double replies)
- **Interaction logs** (for you to review)

### Setup Steps:
1. Go to **Workers & Pages** → **KV**
2. Click **Create a namespace**
3. Name it: `maqtomate-kv-[client-name]` (e.g., `maqtomate-kv-dental-care`)
4. Go to your Worker → **Settings** → **Bindings**
5. Click **Add** → Select **KV Namespace**
6. Variable name: `MAQVORA_KV`
7. Select your namespace from dropdown
8. Click **Deploy**

> **Note:** If KV is not bound, the worker will still function for text replies, but conversation memory and logging will be disabled.

---

## Security Best Practices

1. **Never commit API keys to GitHub.** Always use Cloudflare Environment Variables.
2. **Rotate tokens quarterly.** Meta tokens expire; set calendar reminders.
3. **Use separate VERIFY_TOKEN per client.** Prevents cross-client webhook confusion.
4. **Encrypt WHATSAPP_TOKEN and GEMINI_API_KEY** as secrets in Cloudflare.
5. **Limit Meta token permissions** to only `whatsapp_business_messaging` and `whatsapp_business_management`.
6. **Always set `APP_SECRET` as an encrypted secret.** Without it, the worker cannot verify that incoming webhook POSTs actually came from Meta — this is the difference between a real bot and one anyone on the internet can puppet.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Webhook verification fails | VERIFY_TOKEN mismatch | Check Cloudflare env var matches Meta console entry |
| Messages not sending | WHATSAPP_TOKEN expired | Generate new token in Meta Business Settings |
| AI replies are generic | CLIENT_* vars not set | Verify all business info variables are populated |
| No conversation memory | KV not bound | Add MAQVORA_KV binding in Worker Settings |
| Duplicate replies | KV delay or missing | Ensure KV is bound; duplicates auto-clear in 24h |
| Worker returns 403 on real messages | `APP_SECRET` doesn't match your Meta App's secret | Copy the exact App Secret from developers.facebook.com → App Settings → Basic (click "Show") |
