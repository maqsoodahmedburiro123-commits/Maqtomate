-- Secure customer email/password accounts and payment-gated pre-tenant onboarding.
-- Additive only: it does not alter existing active tenant memberships, sessions, credentials, or owner roles.

PRAGMA foreign_keys = ON;

-- Password verifiers are deliberately separate from opaque user sessions.
-- Passwords are PBKDF2-SHA-256 derived server-side; plaintext values are never stored.
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN password_iterations INTEGER;
ALTER TABLE users ADD COLUMN password_set_at DATETIME;

-- Email verification and password-reset actions cannot reuse the restricted legacy magic-link purpose enum.
CREATE TABLE IF NOT EXISTS account_action_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('email_verify', 'password_reset')),
    expires_at DATETIME NOT NULL,
    used_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- A prospect/customer account is distinct from a live WhatsApp tenant.
-- This preserves the rule that no fake sender credentials or placeholders are created at signup.
CREATE TABLE IF NOT EXISTS customer_onboarding_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    business_name TEXT NOT NULL,
    country TEXT NOT NULL,
    requested_offer TEXT NOT NULL CHECK (requested_offer IN ('managed_launch', 'custom_rollout')),
    requested_ai_mode TEXT NOT NULL CHECK (requested_ai_mode IN ('customer_byok', 'managed_ai')),
    status TEXT NOT NULL DEFAULT 'email_verification_required' CHECK (status IN (
        'email_verification_required', 'payment_pending', 'payment_submitted',
        'connection_pending', 'connection_ready', 'active', 'rejected', 'cancelled'
    )),
    expected_setup_amount INTEGER NOT NULL DEFAULT 0 CHECK (expected_setup_amount >= 0),
    currency TEXT NOT NULL DEFAULT 'PKR',
    payment_reference TEXT,
    payment_submitted_at DATETIME,
    reviewed_at DATETIME,
    reviewed_by_user_id INTEGER,
    review_note TEXT,
    tenant_client_id INTEGER UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (tenant_client_id) REFERENCES clients(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_account_action_tokens_user_purpose
    ON account_action_tokens(user_id, purpose, expires_at, used_at);
CREATE INDEX IF NOT EXISTS idx_customer_onboarding_status
    ON customer_onboarding_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_onboarding_reviewer
    ON customer_onboarding_requests(reviewed_by_user_id, reviewed_at DESC);
