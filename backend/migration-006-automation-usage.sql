-- Maqtomate SaaS Migration 006
-- Reusable workflow and tenant usage-control foundation.
-- Run AFTER migration-005-modular-foundation.sql.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS automation_workflows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    workflow_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    trigger_event TEXT NOT NULL,
    conditions_json TEXT NOT NULL DEFAULT '{}',
    actions_json TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    plan_required_feature TEXT,
    created_by_user_id INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_id, workflow_key),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS automation_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    workflow_id INTEGER,
    event_key TEXT NOT NULL,
    event_reference TEXT,
    status TEXT NOT NULL DEFAULT 'received'
        CHECK (status IN ('received', 'skipped', 'completed', 'failed', 'requires_review')),
    outcome_json TEXT,
    error_category TEXT,
    request_id TEXT,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_id) REFERENCES automation_workflows(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tenant_usage_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    metric_key TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    warning_80_sent_at DATETIME,
    limit_reached_at DATETIME,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_id, period_start, metric_key),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

-- Additive operational enrichment. SQLite has no IF NOT EXISTS for ADD COLUMN, so only run once through the migration manifest.
ALTER TABLE lead_data ADD COLUMN urgency TEXT NOT NULL DEFAULT 'normal'
    CHECK (urgency IN ('low', 'normal', 'high', 'urgent'));
ALTER TABLE lead_data ADD COLUMN assigned_user_id INTEGER;
ALTER TABLE lead_data ADD COLUMN conversion_state TEXT NOT NULL DEFAULT 'open'
    CHECK (conversion_state IN ('open', 'converted', 'lost'));
ALTER TABLE lead_data ADD COLUMN internal_notes TEXT;
ALTER TABLE follow_up_tasks ADD COLUMN assigned_user_id INTEGER;
ALTER TABLE follow_up_tasks ADD COLUMN source_event TEXT;
ALTER TABLE follow_up_tasks ADD COLUMN workflow_id INTEGER;
ALTER TABLE follow_up_tasks ADD COLUMN internal_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_workflows_client_event
    ON automation_workflows(client_id, trigger_event, enabled);
CREATE INDEX IF NOT EXISTS idx_execution_client_status
    ON automation_executions(client_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_client_period
    ON tenant_usage_periods(client_id, period_start, metric_key);
CREATE INDEX IF NOT EXISTS idx_lead_assigned_status
    ON lead_data(client_id, assigned_user_id, lead_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follow_up_assigned_status
    ON follow_up_tasks(client_id, assigned_user_id, task_status, due_at, created_at DESC);
