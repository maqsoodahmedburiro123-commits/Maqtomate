# Deploy Now — exact remaining steps

I can't do these two things for you: GitHub push needs your GitHub login,
and connecting Cloudflare↔GitHub needs an OAuth click-through in your browser.
Everything else (D1, KV, this repo, wrangler.toml) is already done.

## 1. Push this repo to GitHub

```bash
# In this project's folder:
git remote add origin https://github.com/<your-username>/maqtomate-ai.git
git branch -M main
git push -u origin main
```

If you don't have the repo yet: go to github.com → New repository → name it
`maqtomate-ai` → **do not** initialize with a README (this repo already has one)
→ create → then run the commands above with that URL.

## 2. Connect Cloudflare to the GitHub repo

(Source: developers.cloudflare.com/workers/ci-cd/builds/ — confirmed current as of this session)

1. Go to **dash.cloudflare.com** → **Workers & Pages**
2. Click **Create application** → **Import a repository** → **Get started**
3. Choose your GitHub account (authorize if first time), select `maqtomate-ai`
4. Cloudflare will detect `wrangler.toml` automatically — confirm the Worker
   name matches (`maqtomate-worker`) and click **Save and Deploy**
5. Every future `git push` to `main` auto-builds and deploys. No manual
   `wrangler deploy` needed again after this.

## 3. Set secrets (do this before step 2's first deploy handles real traffic)

Via CLI (if you have `wrangler` installed locally and are logged in):
```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put ADMIN_API_KEY
npx wrangler secret put APP_SECRET
npx wrangler secret put VERIFY_TOKEN
```
Or via dashboard: your Worker → **Settings** → **Variables and Secrets** → **Add**.
Mark all four as **Encrypted**, not plaintext.

Where to get each:
- `GEMINI_API_KEY` — aistudio.google.com → Get API key
- `APP_SECRET` — developers.facebook.com → your App → Settings → Basic → App Secret (click "Show")
- `ADMIN_API_KEY` / `VERIFY_TOKEN` — invent any long random strings yourself, e.g. `openssl rand -hex 32`

## 4. Register the webhook with Meta

1. developers.facebook.com → your App → WhatsApp → Configuration
2. Webhook URL: `https://maqtomate-worker.<your-subdomain>.workers.dev/`
   (exact URL shown in Cloudflare dashboard after step 2's deploy)
3. Verify token: whatever you set as `VERIFY_TOKEN` in step 3
4. Subscribe to the `messages` field

## 5. Add your first real client

Once live, `POST` to `/api/clients` with your `ADMIN_API_KEY` bearer token
(see `worker.js`'s admin dashboard at `/admin` — same
bearer token gets you into the UI form instead of raw API calls).

## Sanity check before onboarding a paying client

- [ ] Send a test WhatsApp message to the number, confirm AI reply arrives
- [ ] Check `GET /api/audit` shows your client-creation entry
- [ ] Confirm `X-Hub-Signature-256` verification is actually rejecting bad
      requests: `curl -X POST https://your-worker-url/ -d '{"fake":"payload"}'`
      with no signature header should return `403 Forbidden`, not `200 OK`
