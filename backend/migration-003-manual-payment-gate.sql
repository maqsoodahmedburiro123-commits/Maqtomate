-- Maqtomate SaaS Migration 003
-- Manual payment verification gate for tenant activation and private dashboard access.
-- Run after migration-002-tenant-dashboard-auth.sql.

PRAGMA foreign_keys = ON;

-- One payment-review record per customer tenant before activation.
-- A customer may submit a payment reference, but only an Owner/Platform Admin may approve it.
CREATE TABLE IF NOT EXISTS tenant_payment_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL UNIQUE,
    dashboard_email TEXT NOT NULL COLLATE NOCASE,
    payer_name TEXT,
    payment_method TEXT NOT NULL DEFAULT 'manual',
    payment_reference TEXT,
    expected_amount INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'PKR',
    status TEXT NOT NULL DEFAULT 'pending_review'
        CHECK (status IN ('pending_review', 'approved', 'rejected', 'cancelled')),
    submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at DATETIME,
    reviewed_by_user_id INTEGER,
    review_note TEXT,
    activation_issued_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_status_submitted
    ON tenant_payment_requests(status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_requests_email
    ON tenant_payment_requests(dashboard_email, status);
CREATE INDEX IF NOT EXISTS idx_payment_requests_reviewer
    ON tenant_payment_requests(reviewed_by_user_id, reviewed_at DESC);

-- Invariant enforced in application code:
-- a tenant stays clients.active = 0 while its request is pending/rejected/cancelled;
-- only a successful owner approval changes the request to approved, activates the tenant,
-- and creates the one-time tenant invitation token.
