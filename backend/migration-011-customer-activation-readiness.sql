-- Customer-safe activation readiness for payment-gated, pre-tenant onboarding.
-- Additive only: this does not create tenants, memberships, sender credentials, or provider access.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customer_activation_readiness (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    onboarding_request_id INTEGER NOT NULL UNIQUE,
    user_id INTEGER NOT NULL UNIQUE,
    service_summary TEXT NOT NULL,
    operating_hours TEXT NOT NULL,
    handoff_email TEXT NOT NULL,
    opt_in_acknowledged_at DATETIME NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'reviewed', 'accepted', 'changes_requested')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (onboarding_request_id) REFERENCES customer_onboarding_requests(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_activation_readiness_status
    ON customer_activation_readiness(status, updated_at DESC);
