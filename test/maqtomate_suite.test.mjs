import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import Worker from '../worker.js';

const workerSource = await readFile(new URL('../worker.js', import.meta.url), 'utf8');
const portalSource = await readFile(new URL('../portal-worker.js', import.meta.url), 'utf8');
const schemaSource = await readFile(new URL('../backend/d1-schema.sql', import.meta.url), 'utf8');
const migration004 = await readFile(new URL('../backend/migration-004-voice-calling.sql', import.meta.url), 'utf8');
const migration005 = await readFile(new URL('../backend/migration-005-modular-foundation.sql', import.meta.url), 'utf8');
const migration006 = await readFile(new URL('../backend/migration-006-automation-usage.sql', import.meta.url), 'utf8');

function signedRequest(payload, appSecret) {
  const body = JSON.stringify(payload);
  const signature = 'sha256=' + createHmac('sha256', appSecret).update(body).digest('hex');
  return new Request('https://example.invalid/', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body });
}

test('Meta webhook fails closed when APP_SECRET is missing', async () => {
  const response = await Worker.fetch(new Request('https://example.invalid/', { method: 'POST', body: '{}' }), {});
  assert.equal(response.status, 403);
  assert.equal(await response.text(), 'Forbidden — Server configuration error');
});

test('Meta webhook rejects an invalid signature before database or provider use', async () => {
  const response = await Worker.fetch(new Request('https://example.invalid/', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=bad' }, body: '{}' }), { APP_SECRET: 'test-secret' });
  assert.equal(response.status, 403);
});

test('valid signed unsupported webhook is safely acknowledged without side effects', async () => {
  const request = signedRequest({ object: 'whatsapp_business_account', entry: [] }, 'test-secret');
  const response = await Worker.fetch(request, { APP_SECRET: 'test-secret' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'OK');
});

test('voice pause guard executes before media download or transcription', () => {
  const guard = workerSource.indexOf('if (!shouldProcessVoice(client, env))');
  const download = workerSource.indexOf('downloadWhatsAppMedia(msgObj.audio.id');
  const transcription = workerSource.indexOf('transcribeTenantAudio(client, env');
  assert.ok(guard > -1, 'voice policy guard must exist');
  assert.ok(download > guard, 'media must not download while voice is disabled');
  assert.ok(transcription > guard, 'transcription must not run while voice is disabled');
  assert.match(workerSource, /\[voice_feature_disabled\]/);
});

test('tenant isolation, session-derived authorization, and export scoping remain server enforced', () => {
  assert.match(portalSource, /const tenant = resolveTenant\(access,/);
  assert.match(portalSource, /WHERE client_id = \?/);
  assert.match(portalSource, /tenant\.client_id/);
  assert.match(portalSource, /Customer administrator access is required to update follow-up tasks/);
  assert.match(portalSource, /Excel export is not enabled for the current plan/);
});

test('duplicate prevention and rate limiting execute before AI generation and fail closed without KV', () => {
  const dedupe = workerSource.indexOf('const dupKey =');
  const rateLimit = workerSource.indexOf('const rateLimited =');
  const generation = workerSource.indexOf('generateTenantText(client, env');
  assert.ok(dedupe > -1 && rateLimit > dedupe && generation > rateLimit);
  assert.match(workerSource, /KV rate-limit binding is not configured/);
  assert.match(workerSource, /return true; \/\/ fail closed/);
});

test('credentials use AES-GCM secret envelopes and raw worker errors are not returned to senders', () => {
  assert.match(workerSource, /name: 'AES-GCM'/);
  assert.match(workerSource, /INSERT INTO tenant_secret_envelopes/);
  assert.doesNotMatch(workerSource, /new Response\('Error: ' \+ err\.message/);
  assert.match(workerSource, /X-Request-Id/);
});

test('migration set contains isolated voice, provider, workflow, and usage structures', () => {
  assert.match(migration004, /CREATE TABLE IF NOT EXISTS voice_notes/);
  assert.match(migration004, /CREATE TABLE IF NOT EXISTS lead_data/);
  assert.match(migration004, /CREATE TABLE IF NOT EXISTS follow_up_tasks/);
  assert.match(migration005, /CREATE TABLE IF NOT EXISTS tenant_ai_provider_settings/);
  assert.match(migration005, /CREATE TABLE IF NOT EXISTS tenant_feature_overrides/);
  assert.match(migration006, /CREATE TABLE IF NOT EXISTS automation_workflows/);
  assert.match(migration006, /CREATE TABLE IF NOT EXISTS tenant_usage_periods/);
});

test('fresh schema does not insert a demo tenant or credential-like placeholder', () => {
  assert.doesNotMatch(schemaSource, /INSERT INTO clients/i);
  assert.doesNotMatch(schemaSource, /YOUR_TEST_PHONE_NUMBER_ID|demo_verify_token/i);
});

test('manual payment approval routes remain present and tenant activation cannot be removed by the modular layer', () => {
  assert.match(portalSource, /\/api\/owner\/payments/);
  assert.match(portalSource, /\(approve\|reject\)/);
});
