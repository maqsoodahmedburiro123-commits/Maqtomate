-- Public marketing-site rollout intake. No WhatsApp number, Meta credential, token, or password is collected here.
CREATE TABLE IF NOT EXISTS public_rollout_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_name TEXT NOT NULL,
  business_email TEXT NOT NULL,
  website TEXT,
  country TEXT NOT NULL,
  use_case TEXT NOT NULL CHECK (use_case IN ('sales','support','appointments','ecommerce','education','real_estate','other')),
  monthly_message_band TEXT NOT NULL CHECK (monthly_message_band IN ('under_500','500_2000','2000_10000','10000_plus','unsure')),
  details TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  source_path TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewing','contacted','qualified','closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_public_rollout_requests_status_created ON public_rollout_requests(status, created_at DESC);
