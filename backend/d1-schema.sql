-- Maqtomate AI — Cloudflare D1 Database Schema
-- Run this in Cloudflare D1 SQL Editor to create a FRESH database.
-- If you already have a live DB from an earlier version, run
-- migration-001-audit-mode1.sql INSTEAD — running both will error
-- on duplicate column names.

-- ════════════════════════════════════════════════════════════════
-- CLIENTS — one row per business
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_name TEXT NOT NULL,
    niche TEXT NOT NULL DEFAULT 'general',
    country TEXT NOT NULL DEFAULT 'PK',

    -- Legacy tier (kept for backward-compat; new code uses client_mode)
    plan TEXT NOT NULL DEFAULT 'standard',
    monthly_fee INTEGER NOT NULL DEFAULT 1500,

    -- Meta WhatsApp API credentials (per-client; client owns their Meta account)
    phone_number_id TEXT NOT NULL UNIQUE,
    whatsapp_token TEXT NOT NULL,
    verify_token TEXT NOT NULL UNIQUE,

    -- Business info (injected into AI system prompt)
    working_hours TEXT,
    location TEXT,
    services TEXT,
    pricing TEXT,
    contact_number TEXT,

    -- AI behavior config
    ai_name TEXT,
    system_prompt_extra TEXT,
    handoff_triggers TEXT DEFAULT 'human,manager,agent,bande se baat,insan,representative,support team,baat karo',
    unsupported_msg TEXT,
    fallback_msg TEXT,
    gemini_model TEXT DEFAULT 'gemini-1.5-flash',

    -- Mode 1 (BYOK) support: client's own Gemini key.
    -- NULL = use shared env.GEMINI_API_KEY (Mode 2/3 behavior).
    -- Set = your AI cost is zero for that client.
    gemini_api_key TEXT,

    -- Explicit mode flag (canonical pricing dimension).
    -- 1 = DIY BYOK       (client brings all keys; highest margin for you)
    -- 2 = Smart Pro      (client's Meta account + your shared AI key)
    -- 3 = VIP Managed    (you pay everything; bundled into their fee)
    -- Default 3 matches the original "we handle everything" behavior.
    client_mode INTEGER NOT NULL DEFAULT 3,

    -- Status
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ════════════════════════════════════════════════════════════════
-- LOGS — every conversation across every client
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    from_number TEXT NOT NULL,
    msg_type TEXT NOT NULL,
    query TEXT,
    response TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- ════════════════════════════════════════════════════════════════
-- AUDIT LOGS — admin actions on /api/clients
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL DEFAULT 'admin',   -- bearer-token holder; per-user once RBAC lands
    action TEXT NOT NULL,                  -- e.g. 'client.create', 'client.update', 'client.deactivate'
    client_id INTEGER,                     -- affected client, if any
    detail TEXT,                           -- JSON blob of what changed
    ip TEXT,                               -- request IP from CF-Connecting-IP (best-effort)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ════════════════════════════════════════════════════════════════
-- INDEXES
-- ════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_clients_phone    ON clients(phone_number_id);
CREATE INDEX IF NOT EXISTS idx_clients_active   ON clients(active);
CREATE INDEX IF NOT EXISTS idx_clients_niche    ON clients(niche);
CREATE INDEX IF NOT EXISTS idx_clients_country  ON clients(country);
CREATE INDEX IF NOT EXISTS idx_clients_mode     ON clients(client_mode);
CREATE INDEX IF NOT EXISTS idx_logs_client      ON logs(client_id);
CREATE INDEX IF NOT EXISTS idx_logs_created     ON logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_client     ON audit_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_audit_created    ON audit_logs(created_at);

-- Fresh production databases intentionally start with no tenant rows, no demo users, and no credential-like placeholders.
-- Create customers only through the authorized onboarding or owner-approved activation flow.
