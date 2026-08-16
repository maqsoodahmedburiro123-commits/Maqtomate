-- Maqtomate SaaS Migration 002
-- Secure multi-tenant identity, dashboard roles, sessions, invites, secrets, and metrics.
-- Run AFTER the existing schema/migration-001 on the live D1 database.
-- This migration is additive: it does not remove legacy client data or interrupt WhatsApp routing.

PRAGMA foreign_keys = ON;

-- One person may belong to one or more customer tenants and may also hold a platform role.
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending')),
    email_verified_at DATETIME,
    last_login_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Customer-scoped roles. A user gains tenant visibility only through an active membership.
CREATE TABLE IF NOT EXISTS tenant_memberships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    client_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('customer_admin', 'customer_member')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, client_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

-- Platform roles are deliberately separate from customer memberships.
CREATE TABLE IF NOT EXISTS platform_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'platform_admin', 'support')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Opaque browser sessions. Only SHA-256 token hashes are stored, never session tokens.
CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME,
    ip_hash TEXT,
    user_agent_hash TEXT,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- One-time tokens for passwordless login and invitations. Only a SHA-256 hash is stored.
CREATE TABLE IF NOT EXISTS magic_link_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL COLLATE NOCASE,
    purpose TEXT NOT NULL CHECK (purpose IN ('login', 'tenant_invite', 'owner_bootstrap')),
    client_id INTEGER,
    role TEXT,
    invited_by_user_id INTEGER,
    expires_at DATETIME NOT NULL,
    used_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- AES-GCM encrypted credentials and key versioning. New writes must use this table.
-- The encryption key remains in the Worker secret TENANT_DATA_ENCRYPTION_KEY.
CREATE TABLE IF NOT EXISTS tenant_secret_envelopes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    secret_name TEXT NOT NULL CHECK (secret_name IN ('whatsapp_token', 'gemini_api_key', 'verify_token')),
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    key_version INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (client_id, secret_name),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

-- Append-only security and dashboard event trail. Details must not contain raw credentials.
CREATE TABLE IF NOT EXISTS dashboard_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER,
    client_id INTEGER,
    actor_role TEXT,
    action TEXT NOT NULL,
    request_id TEXT,
    ip_hash TEXT,
    details TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
);

-- Pre-aggregated operational metrics used by tenant and owner dashboards.
CREATE TABLE IF NOT EXISTS tenant_metrics_daily (
    client_id INTEGER NOT NULL,
    metric_date TEXT NOT NULL,
    inbound_messages INTEGER NOT NULL DEFAULT 0,
    outbound_messages INTEGER NOT NULL DEFAULT 0,
    handoffs INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    total_latency_ms INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (client_id, metric_date),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

-- Support access is time-limited and must record the reason for every cross-tenant support action.
CREATE TABLE IF NOT EXISTS support_access_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_user_id INTEGER NOT NULL,
    client_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    access_level TEXT NOT NULL DEFAULT 'read' CHECK (access_level IN ('read', 'write')),
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (staff_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memberships_user_active
    ON tenant_memberships(user_id, status, client_id);
CREATE INDEX IF NOT EXISTS idx_memberships_client_active
    ON tenant_memberships(client_id, status, user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_active
    ON user_sessions(user_id, expires_at, revoked_at);
CREATE INDEX IF NOT EXISTS idx_magic_links_email_purpose
    ON magic_link_tokens(email, purpose, expires_at, used_at);
CREATE INDEX IF NOT EXISTS idx_dashboard_events_client_created
    ON dashboard_events(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dashboard_events_actor_created
    ON dashboard_events(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_date
    ON tenant_metrics_daily(metric_date, client_id);
CREATE INDEX IF NOT EXISTS idx_support_grants_staff_client
    ON support_access_grants(staff_user_id, client_id, expires_at, revoked_at);

-- SECURITY NOTE:
-- Existing clients.whatsapp_token, clients.gemini_api_key, and clients.verify_token values
-- are legacy plaintext fields. Encrypt and migrate their values through a controlled Worker
-- process before enabling customer dashboards. Do not expose these columns from any dashboard API.
