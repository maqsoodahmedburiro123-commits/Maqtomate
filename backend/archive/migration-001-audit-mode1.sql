-- Migration 001: Audit logging + Mode 1 (BYOK) support
--
-- ONLY run this if you already have a live D1 database (i.e. you ran
-- the older d1-schema.sql before this update). If you're setting up a
-- fresh database, just run d1-schema.sql and skip this file entirely.
-- Running both against a fresh DB will error on the ALTER TABLE lines.

-- Governance doc claimed an audit_logs table existed. It didn't. This
-- adds it, and the worker writes to it on every admin mutation.
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL DEFAULT 'admin',
    action TEXT NOT NULL,
    client_id INTEGER,
    detail TEXT,
    ip TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_client  ON audit_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- Mode 1 (DIY BYOK): client brings their own Gemini key so YOUR AI
-- costs are zero for that client. NULL = use shared env.GEMINI_API_KEY
-- (Mode 2/3 behavior) — keeps every existing client working unchanged.
ALTER TABLE clients ADD COLUMN gemini_api_key TEXT;

-- Explicit mode flag so billing/reporting can distinguish the three
-- modes instead of inferring it from whether gemini_api_key is set.
-- 1 = DIY BYOK, 2 = Smart Pro, 3 = VIP Managed (default).
ALTER TABLE clients ADD COLUMN client_mode INTEGER NOT NULL DEFAULT 3;

-- Helpful index for future "list all BYOK clients" queries.
CREATE INDEX IF NOT EXISTS idx_clients_mode ON clients(client_mode);

-- NOTE on `actor`: the current admin API has one shared bearer token,
-- so `actor` will always read 'admin' until real per-user tokens (RBAC)
-- are implemented. The table is ready for that later — for now it
-- records WHAT changed and WHEN, just not WHO precisely.
