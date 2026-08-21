-- Maqtomate V2 additive foundation.
-- This migration intentionally preserves the production `clients(id)` tenant model.
-- It creates metadata only: no calling, recording, transcription, R2 upload, or public URL is enabled by this schema.

CREATE TABLE IF NOT EXISTS whatsapp_call_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    meta_call_id TEXT NOT NULL UNIQUE,
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    status TEXT NOT NULL DEFAULT 'received'
        CHECK (status IN ('received', 'permission_required', 'permission_granted', 'pre_accepted', 'accepted', 'connected', 'terminated', 'rejected', 'failed')),
    permission_state TEXT NOT NULL DEFAULT 'unknown'
        CHECK (permission_state IN ('unknown', 'none', 'temporary', 'permanent', 'revoked', 'expired')),
    consent_recording_at DATETIME,
    consent_transcription_at DATETIME,
    recording_purpose TEXT,
    announcement_locale TEXT,
    media_asset_id INTEGER,
    transcript_status TEXT NOT NULL DEFAULT 'not_requested'
        CHECK (transcript_status IN ('not_requested', 'requested', 'received', 'failed', 'purged')),
    summary_status TEXT NOT NULL DEFAULT 'not_requested'
        CHECK (summary_status IN ('not_requested', 'pending', 'completed', 'failed', 'purged')),
    error_code TEXT,
    error_detail TEXT,
    started_at DATETIME,
    connected_at DATETIME,
    ended_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_call_sessions_client_created
    ON whatsapp_call_sessions(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_sessions_client_status
    ON whatsapp_call_sessions(client_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS tenant_media_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    asset_kind TEXT NOT NULL CHECK (asset_kind IN ('voice_note', 'call_recording', 'call_transcript', 'knowledge_document')),
    owner_reference TEXT NOT NULL,
    storage_provider TEXT NOT NULL DEFAULT 'r2' CHECK (storage_provider IN ('r2')),
    object_key TEXT NOT NULL UNIQUE,
    content_type TEXT,
    byte_size INTEGER CHECK (byte_size IS NULL OR byte_size >= 0),
    sha256_hex TEXT,
    retention_expires_at DATETIME,
    deletion_requested_at DATETIME,
    deleted_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_assets_client_kind_created
    ON tenant_media_assets(client_id, asset_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_assets_retention
    ON tenant_media_assets(retention_expires_at, deleted_at);
