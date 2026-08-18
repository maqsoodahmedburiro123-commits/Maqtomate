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
const migration007 = await readFile(new URL('../backend/migration-007-whatsapp-connection-state.sql', import.meta.url), 'utf8');

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
  assert.match(migration007, /CREATE TABLE IF NOT EXISTS tenant_whatsapp_connections/);
  assert.match(migration007, /TEST_MESSAGE_SUCCESS/);
  assert.match(migration007, /FOREIGN KEY \(client_id\) REFERENCES clients\(id\) ON DELETE CASCADE/);
  assert.doesNotMatch(migration007, /access_token|whatsapp_token|gemini_api_key/i);
});

test('connection state is metadata-only and the Worker has a protected read route', () => {
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS tenant_whatsapp_connections/);
  assert.match(workerSource, /path === '\/api\/whatsapp-connections'/);
  assert.match(workerSource, /Never returns access tokens or secret envelope values/);
  const routeSource = workerSource.match(/path === '\/api\/whatsapp-connections'[\s\S]{0,2200}/)?.[0] || '';
  assert.doesNotMatch(routeSource, /tenant_secret_envelopes|last_error_detail/);
});

test('owner tenant list exposes safe AI readiness metadata without tenant credential fields', () => {
  const clientsRoute = workerSource.match(/if \(request\.method === 'GET' && path === '\/api\/clients'\)[\s\S]*?return jsonResponse\(\{ clients: clients\.results \}, 200, corsHeaders\);/)?.[0] || '';
  assert.match(clientsRoute, /ai_provider_name/);
  assert.match(clientsRoute, /ai_credential_mode/);
  assert.match(clientsRoute, /AS ai_status/);
  assert.doesNotMatch(clientsRoute, /whatsapp_token|gemini_api_key|tenant_secret_envelopes/);
});

test('permanent System User token route validates before encryption and never returns the token', () => {
  const start = workerSource.indexOf('// POST /api/clients/:id/system-user-token');
  const end = workerSource.indexOf('// POST /api/clients — create', start);
  const tokenRoute = start === -1 || end === -1 ? '' : workerSource.slice(start, end);
  assert.match(tokenRoute, /graph\.facebook\.com\/v23\.0/);
  assert.match(tokenRoute, /await putTenantSecret\(env, id, 'whatsapp_token', token\)/);
  assert.match(tokenRoute, /tenant\.system_user_token\.saved/);
  assert.doesNotMatch(tokenRoute, /jsonResponse\(\{[^}]*\btoken\s*:/);
});

test('WhatsApp connection metadata route accepts identifiers but keeps token handling on the encrypted route', () => {
  const start = workerSource.indexOf('// PUT /api/clients/:id/whatsapp-connection');
  const end = workerSource.indexOf('// POST /api/clients — create', start);
  const connectionRoute = start === -1 || end === -1 ? '' : workerSource.slice(start, end);
  assert.match(connectionRoute, /waba_id/);
  assert.match(connectionRoute, /phone_number_id/);
  assert.match(connectionRoute, /tenant\.whatsapp_connection\.metadata_saved/);
  assert.doesNotMatch(connectionRoute, /putTenantSecret|access_token|whatsapp_token/);
});

test('owner health route provides component states without disclosing secret values', () => {
  const healthRoute = workerSource.match(/path === '\/api\/health'[\s\S]{0,1800}/)?.[0] || '';
  assert.match(healthRoute, /worker: 'healthy'/);
  assert.match(healthRoute, /meta_webhook_security/);
  assert.doesNotMatch(healthRoute, /GEMINI_API_KEY:|APP_SECRET:|ADMIN_API_KEY:/);
});

test('owner audit route supports bounded offset pagination', () => {
  const auditRoute = workerSource.match(/path === '\/api\/audit'[\s\S]{0,1600}/)?.[0] || '';
  assert.match(auditRoute, /searchParams\.get\('offset'\)/);
  assert.match(auditRoute, /LIMIT \? OFFSET \?/);
  assert.match(auditRoute, /next_offset/);
});

test('fresh schema does not insert a demo tenant or credential-like placeholder', () => {
  assert.doesNotMatch(schemaSource, /INSERT INTO clients/i);
  assert.doesNotMatch(schemaSource, /YOUR_TEST_PHONE_NUMBER_ID|demo_verify_token/i);
});

test('manual payment approval routes remain present and tenant activation cannot be removed by the modular layer', () => {
  assert.match(portalSource, /\/api\/owner\/payments/);
  assert.match(portalSource, /\(approve\|reject\)/);
});
