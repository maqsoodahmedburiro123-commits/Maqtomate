-- Tenant WhatsApp connection metadata. Sensitive tokens remain exclusively in tenant_secret_envelopes.
-- Apply only after verifying the existing production schema and taking a D1 backup/checkpoint.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenant_whatsapp_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL UNIQUE,
    waba_id TEXT,
    meta_business_id TEXT,
    phone_number_id TEXT,
    display_phone_number TEXT,
    display_name TEXT,
    connection_status TEXT NOT NULL DEFAULT 'NOT_CONNECTED'
        CHECK (connection_status IN (
            'NOT_CONNECTED', 'ONBOARDING_STARTED', 'META_AUTHORIZED', 'WABA_FOUND',
            'PHONE_FOUND', 'PHONE_REGISTERED', 'WABA_SUBSCRIBED', 'WEBHOOK_VERIFIED',
            'TEST_MESSAGE_SUCCESS', 'ACTIVE', 'META_AUTH_FAILED', 'WABA_ACCESS_FAILED',
            'PHONE_REGISTRATION_FAILED', 'TOKEN_FAILED', 'WEBHOOK_FAILED', 'TEST_MESSAGE_FAILED'
        )),
    webhook_status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED'
        CHECK (webhook_status IN ('NOT_CONFIGURED', 'PENDING', 'VERIFIED', 'FAILED')),
    phone_status TEXT NOT NULL DEFAULT 'NOT_FOUND'
        CHECK (phone_status IN ('NOT_FOUND', 'FOUND', 'REGISTERED', 'FAILED')),
    token_status TEXT NOT NULL DEFAULT 'NOT_AVAILABLE'
        CHECK (token_status IN ('NOT_AVAILABLE', 'PENDING', 'VALID', 'INVALID', 'EXPIRED', 'FAILED')),
    last_error_code TEXT,
    last_error_detail TEXT,
    connected_at DATETIME,
    last_verified_at DATETIME,
    last_test_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_connections_status
    ON tenant_whatsapp_connections(connection_status, updated_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_connections_waba
    ON tenant_whatsapp_connections(waba_id);
