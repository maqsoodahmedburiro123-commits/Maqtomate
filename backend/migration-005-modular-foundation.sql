-- Maqtomate SaaS Migration 005
-- Modular policy, provider metadata, and safe feature-control foundation.
-- Run AFTER migrations 002, 003, and 004. Migration 001 is legacy-only; see MIGRATION_MANIFEST.md.

PRAGMA foreign_keys = ON;

-- Provider metadata only. API keys remain solely in tenant_secret_envelopes.
CREATE TABLE IF NOT EXISTS tenant_ai_provider_settings (
    client_id INTEGER PRIMARY KEY,
    provider_name TEXT NOT NULL DEFAULT 'gemini',
    model_name TEXT NOT NULL DEFAULT 'gemini-1.5-flash',
    credential_mode TEXT NOT NULL DEFAULT 'platform_managed'
        CHECK (credential_mode IN ('tenant_byok', 'platform_managed')),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    validation_status TEXT NOT NULL DEFAULT 'unvalidated'
        CHECK (validation_status IN ('unvalidated', 'valid', 'invalid', 'error', 'disabled')),
    last_validated_at DATETIME,
    validation_error_count INTEGER NOT NULL DEFAULT 0 CHECK (validation_error_count >= 0),
    last_error_code TEXT,
    secret_key_version INTEGER NOT NULL DEFAULT 1 CHECK (secret_key_version >= 1),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

-- Per-tenant overrides may only narrow platform/plan access. Code must never treat an override as permission to bypass plan or global policy.
CREATE TABLE IF NOT EXISTS tenant_feature_overrides (
    client_id INTEGER NOT NULL,
    feature_key TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    reason TEXT,
    updated_by_user_id INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (client_id, feature_key),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Platform AI configuration deliberately contains no API key. The platform key is a Worker secret.
CREATE TABLE IF NOT EXISTS platform_ai_configuration (
    config_key TEXT PRIMARY KEY,
    provider_name TEXT NOT NULL DEFAULT 'gemini',
    model_name TEXT NOT NULL DEFAULT 'gemini-1.5-flash',
    active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
    updated_by_user_id INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_validation
    ON tenant_ai_provider_settings(validation_status, active);
CREATE INDEX IF NOT EXISTS idx_feature_overrides_client
    ON tenant_feature_overrides(client_id, feature_key);
