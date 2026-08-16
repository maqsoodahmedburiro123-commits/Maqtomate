-- Maqtomate SaaS Migration 004
-- WhatsApp Voice Employee: tenant-isolated voice notes, leads, follow-up tasks, and metrics.
-- This migration intentionally contains NO paid PSTN or telephone-call tables.
-- Run AFTER migrations 001, 002, and 003 on the live D1 database.

PRAGMA foreign_keys = ON;

-- Per-tenant operating settings for the WhatsApp-first Voice Employee.
CREATE TABLE IF NOT EXISTS tenant_voice_settings (
    client_id INTEGER PRIMARY KEY,
    voice_notes_enabled INTEGER NOT NULL DEFAULT 0 CHECK (voice_notes_enabled IN (0, 1)),
    follow_ups_enabled INTEGER NOT NULL DEFAULT 0 CHECK (follow_ups_enabled IN (0, 1)),
    follow_up_mode TEXT NOT NULL DEFAULT 'whatsapp_service'
        CHECK (follow_up_mode IN ('whatsapp_service', 'human_task_only')),
    lead_capture_enabled INTEGER NOT NULL DEFAULT 1 CHECK (lead_capture_enabled IN (0, 1)),
    follow_up_instructions TEXT,
    default_locale TEXT NOT NULL DEFAULT 'en-US',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

-- One row per received WhatsApp voice note. Raw audio and public media URLs are never retained.
CREATE TABLE IF NOT EXISTS voice_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    whatsapp_message_id TEXT NOT NULL UNIQUE,
    contact_phone_e164 TEXT NOT NULL,
    media_id TEXT NOT NULL,
    mime_type TEXT,
    media_size_bytes INTEGER,
    transcription_status TEXT NOT NULL DEFAULT 'received'
        CHECK (transcription_status IN ('received', 'downloading', 'transcribing', 'completed', 'failed', 'skipped')),
    transcription_provider TEXT,
    transcript TEXT,
    detected_language TEXT,
    ai_response TEXT,
    whatsapp_response_message_id TEXT,
    processing_error_code TEXT,
    processing_error_detail TEXT,
    retention_expires_at DATETIME,
    received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    transcribed_at DATETIME,
    responded_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

-- Normalized customer/lead information extracted only from a tenant's authorized WhatsApp interactions.
CREATE TABLE IF NOT EXISTS lead_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    voice_note_id INTEGER,
    source_type TEXT NOT NULL CHECK (source_type IN ('whatsapp_voice_note', 'whatsapp_text', 'manual')),
    contact_phone_e164 TEXT,
    contact_name TEXT,
    contact_email TEXT,
    lead_status TEXT NOT NULL DEFAULT 'new'
        CHECK (lead_status IN ('new', 'qualified', 'interested', 'appointment_requested', 'follow_up', 'not_interested', 'do_not_contact', 'converted', 'unknown')),
    interest_score INTEGER CHECK (interest_score IS NULL OR (interest_score >= 0 AND interest_score <= 100)),
    requested_service TEXT,
    preferred_contact_time TEXT,
    summary TEXT,
    extra_data_json TEXT,
    consent_to_contact_at DATETIME,
    do_not_contact_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (voice_note_id) REFERENCES voice_notes(id) ON DELETE SET NULL
);

-- Actionable tenant task. A human can call manually if desired, but Maqtomate does not place paid PSTN calls.
CREATE TABLE IF NOT EXISTS follow_up_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    lead_id INTEGER,
    voice_note_id INTEGER,
    task_type TEXT NOT NULL DEFAULT 'whatsapp_service'
        CHECK (task_type IN ('whatsapp_service', 'human_follow_up', 'appointment_review', 'manual')),
    task_status TEXT NOT NULL DEFAULT 'open'
        CHECK (task_status IN ('open', 'in_progress', 'completed', 'dismissed')),
    priority TEXT NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    title TEXT NOT NULL,
    details TEXT,
    due_at DATETIME,
    completed_at DATETIME,
    completed_by_user_id INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (lead_id) REFERENCES lead_data(id) ON DELETE SET NULL,
    FOREIGN KEY (voice_note_id) REFERENCES voice_notes(id) ON DELETE SET NULL,
    FOREIGN KEY (completed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Tenant-only daily operational metrics. No shared customer data is exposed through this table.
CREATE TABLE IF NOT EXISTS tenant_voice_metrics_daily (
    client_id INTEGER NOT NULL,
    metric_date TEXT NOT NULL,
    voice_notes_received INTEGER NOT NULL DEFAULT 0,
    voice_notes_transcribed INTEGER NOT NULL DEFAULT 0,
    voice_note_failures INTEGER NOT NULL DEFAULT 0,
    follow_ups_created INTEGER NOT NULL DEFAULT 0,
    follow_ups_completed INTEGER NOT NULL DEFAULT 0,
    qualified_leads INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (client_id, metric_date),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_voice_notes_client_received
    ON voice_notes(client_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_notes_client_status
    ON voice_notes(client_id, transcription_status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_notes_contact
    ON voice_notes(client_id, contact_phone_e164, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_data_client_created
    ON lead_data(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_data_client_status
    ON lead_data(client_id, lead_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_client_status
    ON follow_up_tasks(client_id, task_status, due_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_lead
    ON follow_up_tasks(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_metrics_date
    ON tenant_voice_metrics_daily(metric_date, client_id);

-- SECURITY NOTES:
-- 1. Raw WhatsApp audio is never stored. The Meta media reference is used only during controlled processing.
-- 2. Every customer dashboard query must authorize the session and bind client_id.
-- 3. Do not use a follow-up task to send marketing or template messages. The zero-cost product path is service follow-up in a valid customer-initiated WhatsApp window.
-- 4. Tenant Gemini credentials remain AES-GCM encrypted in tenant_secret_envelopes.
