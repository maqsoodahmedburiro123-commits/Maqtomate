# Pricing — Canonical Version (resolves conflicting docs)

> **UPDATE:** A third pricing model arrived (the "Enterprise Master Architecture" doc,
> 3-Mode DIY/Smart Pro/VIP structure). It supersedes the two-tier decision below —
> see "Final Call (v2)" at the bottom. Left the original reasoning in place since the
> underlying conflict-resolution logic still applies.

Your files contained two different pricing philosophies. This picks one so your
landing pages, onboarding form, and admin dashboard defaults all agree.

## The conflict
- `Maqtomate_AI_Agency_Blueprint.md` / `.pdf` (earlier, single-tenant plan): **one tier**,
  Rs 3,000 setup / Rs 1,500 monthly, bumping to Rs 4,500 / Rs 2,000 after 20–30 clients.
- `MAQVORA-MASTER-INDEX.md` / multi-tenant kit (newer, current system): **two tiers at
  launch** — Standard Rs 3,000/Rs 1,500, Pro Rs 5,000/Rs 2,500 — with no scale-based bump.

These aren't reconcilable as-is: one raises price over time, the other splits by
feature set from day one. The multi-tenant kit is also the only one whose *code*
(`plan` field in D1, the admin dashboard's Standard/Pro dropdown) already assumes tiers
exist — the single-tier model isn't wired into anything you'd actually deploy.

## Canonical going forward
**Adopt the tiered model, and layer the scale-based increase on top of both tiers**
instead of choosing one or the other:

| Plan | Setup Fee | Monthly | Features |
|------|-----------|---------|----------|
| Standard | Rs 3,000 / $10 | Rs 1,500 / $5 | Text AI, FAQs, lead capture, single language |
| Pro | Rs 5,000 / $18 | Rs 2,500 / $9 | + Voice notes, images, multi-language, priority updates |

**After 20–30 total clients**, raise both tiers ~50%:

| Plan | Setup Fee | Monthly |
|------|-----------|---------|
| Standard | Rs 4,500 / $15 | Rs 2,000 / $7 |
| Pro | Rs 7,000 / $25 | Rs 3,500 / $13 |

This keeps the tier structure your worker/dashboard already implement, while
preserving the "reward early clients, charge more once you have traction" logic
from the original blueprint.

## Files that still reference the old single-tier-only pricing
Not rewritten here — update these before using them with clients:
- `Maqtomate_AI_Agency_Blueprint.md`, `Maqtomate_AI_Agency_Blueprint.pdf`,
  `WhatsApp_AI_Agency_Blueprint.pdf` — treat as superseded by this file for pricing.
- Check each niche landing page (`dental-`, `salon-`, `realestate-`, `restaurant-`,
  `landing-page.html`) and the onboarding forms for hardcoded price numbers that
  should match the table above.

---

## Final Call (v2) — 3-Mode structure replaces Standard/Pro

The Enterprise Architecture doc's Mode 1/2/3 split is a *better* model than
Standard/Pro, because it's not just a feature tier — it's a real cost-ownership
distinction:

| Mode | Who pays Meta/Gemini API costs | Your margin |
|------|-------------------------------|-------------|
| 1 — DIY BYOK | Client, directly | Highest %, lowest Rs |
| 2 — Smart Pro | Split (client's Meta account, your shared AI key) | Middle |
| 3 — VIP Managed | You, fully (bundled into their fee) | Lowest %, highest Rs, most predictable |

**Adopt this as canonical.** Pricing table:

| Mode | Setup (Launch / after 20 clients) | Monthly (Launch / after 20 clients) |
|------|-----------------------------------|--------------------------------------|
| 1 — DIY BYOK | Rs 2,500 ($10) → Rs 3,500 ($12) | Rs 1,000 ($4) → Rs 1,500 ($5) |
| 2 — Smart Pro | Rs 4,500 ($15) → Rs 6,000 ($20) | Rs 2,200 ($8) → Rs 3,000 ($11) |
| 3 — VIP Managed | Rs 8,000 ($25) → Rs 12,000 ($40) | Rs 4,500 ($15) → Rs 7,000 ($25) |

**This required real code changes before it's true — status as of this session:**
1. ✅ **Done.** Added `mode` column (`client_mode`) to D1 `clients` table.
2. ✅ **Done.** Worker now reads `client.gemini_api_key` first, falling back to
   `env.GEMINI_API_KEY` only if the client hasn't supplied their own. `whatsapp_token`
   was already per-client. Mode 1 (BYOK) is now technically real for both APIs it needs.
3. ❌ **Still not built.** Mode 2's "1-Click Facebook OAuth Popup" onboarding doesn't
   exist — you'd still set up Mode 2 clients manually, identical to Mode 3 in practice.

**You can now honestly sell Mode 1 and Mode 3.** Sell Mode 2 only as "we handle setup
for you" — don't imply self-serve OAuth signup exists yet, because it doesn't.

---

## Final Call (v3) — owner-confirmed, replaces the v2 launch/growth numbers

Confirmed directly by Maqsood (Aug 2026 session). No launch/growth split this time —
one flat rate per mode. **This is what's actually wired into the worker and landing
pages now.**

| Mode | Setup Fee | Monthly | Gemini key | Meta/WhatsApp token |
|------|-----------|---------|------------|----------------------|
| 1 — DIY BYOK | Rs 3,500 (~$13) | Rs 1,500 (~$5) | Customer's own | Customer's own |
| 2 — Smart Pro | Rs 5,000 (~$18) | Rs 2,000 (~$7) | **Agency's own** | Customer's own |
| 3 — VIP Managed | Rs 8,000 (~$29) | Rs 3,000 (~$11) | Agency's own | Agency's own |

USD figures are approximate (PKR/USD ≈ 278 at time of writing) — shown to give
international/overseas-Pakistani prospects a sense of scale, not a fixed FX guarantee.
Update these if the rate moves significantly.

Note the correction from v2: Mode 2 is **not** "split" in the vague sense — it's
specifically *WhatsApp stays with the client, AI runs on the agency's Gemini key*.
Mode 3 is the only one where the agency also holds the client's WhatsApp/Meta access.

**Where this is implemented:**
- Landing pages (`pages/*.html`) — all 5 updated to these exact numbers
- `worker.js` — `POST /api/self-signup` (public, Mode 1 only) creates clients with
  `monthly_fee = 1500`, `client_mode = 1`, requires the customer's own `gemini_api_key`
  AND `whatsapp_token` — matches this table
- `POST /api/clients` (admin-only, for Mode 2/3) — you set `monthly_fee`/`client_mode`
  manually per client; no fee auto-default is hardcoded here yet, so double-check the
  number you type in against this table each time until that's automated

**Still open:** Mode 2 needs its own signup path eventually (client submits their
WhatsApp token but not a Gemini key — currently only Mode 1's fully-public signup and
Mode 2/3's fully-manual admin creation exist; nothing in between yet).
