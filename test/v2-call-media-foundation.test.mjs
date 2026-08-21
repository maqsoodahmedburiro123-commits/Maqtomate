import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../backend/migration-008-v2-call-media-foundation.sql', import.meta.url), 'utf8');

test('V2 call and media foundation is additive, client-isolated, and disabled-safe', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS whatsapp_call_sessions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS tenant_media_assets/);
  assert.match(migration, /client_id INTEGER NOT NULL/);
  assert.match(migration, /FOREIGN KEY \(client_id\) REFERENCES clients\(id\) ON DELETE CASCADE/);
  assert.match(migration, /permission_state/);
  assert.match(migration, /consent_recording_at/);
  assert.match(migration, /consent_transcription_at/);
  assert.match(migration, /retention_expires_at/);
  assert.match(migration, /deleted_at/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_call_sessions_client_created/);
  assert.doesNotMatch(migration, /CREATE TABLE[^;]+\btenants\b/i);
  assert.doesNotMatch(migration, /CREATE TABLE[^;]+\btenant_secrets\b/i);
  assert.doesNotMatch(migration, /\bwhatsapp_token\b/i);
  assert.doesNotMatch(migration, /\b03111232752\b/);
});
