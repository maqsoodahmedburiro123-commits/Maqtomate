/**
 * Maqtomate Portal Worker
 * Secure customer dashboard + owner control center.
 *
 * Required bindings:
 *   MAQVORA_DB — D1 control-plane database
 *   MAQVORA_KV — KV for rate limits and session revocation
 *
 * Required secrets:
 *   RESEND_API_KEY — sending-only key for passwordless magic-link emails
 *
 * Optional encrypted variables/secrets:
 *   EMAIL_FROM — e.g. "Maqtomate <login@auth.yourdomain.com>" after verifying a domain
 *   PORTAL_URL — canonical portal URL; defaults to current Worker origin
 *   TEST_MODE_OWNER_EMAIL — only this Resend-account email may receive test links without a verified domain
 *   TURNSTILE_SECRET — enable production bot verification once a Turnstile widget is configured
 */

import * as XLSX from 'xlsx';
import { hasFeature, FEATURE_KEYS } from './config/features.js';
import { getPlanEntitlement } from './config/plans.js';
import { getTenantUsageSummary } from './services/usage/usage-service.js';

const SESSION_TTL_SECONDS = 60 * 60 * 12;
const MAGIC_LINK_TTL_MINUTES = 15;
const MAX_PAGE_SIZE = 100;
const TEST_OWNER_EMAIL = 'maqsoodahmedburiro123@gmail.com';
const MAQTOMATE_TEST_WABA_ID = '2021200748859223';
const MAQTOMATE_TEST_PHONE_ID = '1195835330290417';
const MAQTOMATE_TEST_DISPLAY_NUMBER = '+1 (555) 661-6458';
const CUSTOMER_ROLES = new Set(['customer_admin', 'customer_member']);
const PLATFORM_ROLES = new Set(['owner', 'platform_admin', 'support']);

export default {
  async fetch(request, env, ctx) {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    const path = url.pathname;
    const headers = securityHeaders(request, env, requestId);

    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

      if (request.method === 'GET' && path === '/') return htmlResponse(loginHTML(env), 200, headers);
      if (request.method === 'GET' && path === '/dashboard') {
        const access = await requireSession(request, env);
        const overview = access.platformRole ? await ownerOverviewData(env) : null;
        return htmlResponse(dashboardHTML(access.user, overview, access.platformRole), 200, headers);
      }
      if (request.method === 'GET' && path === '/owner') return await ownerConsole(request, env, headers);
      if (request.method === 'POST' && path === '/owner/test-tenant/provision') return await provisionOwnerTestTenant(request, env, headers, requestId);
      if (request.method === 'POST' && path === '/owner/test-tenant/attach-maqtomate-test-sender') return await attachMaqtomateTestSender(request, env, headers, requestId);
      if (request.method === 'GET' && path === '/auth/verify') return await verifyMagicLink(request, env, headers, requestId);
      if (request.method === 'POST' && path === '/auth/request-link') return await requestMagicLink(request, env, headers, requestId);
      if (request.method === 'POST' && path === '/auth/logout') return await logout(request, env, headers, requestId);

      if (path === '/api/me' && request.method === 'GET') return await apiMe(request, env, headers);
      if (path === '/api/customer/overview' && request.method === 'GET') return await customerOverview(request, env, headers);
      if (path === '/api/customer/usage' && request.method === 'GET') return await customerUsage(request, env, headers);
      if (path === '/api/customer/automations' && request.method === 'GET') return await customerAutomations(request, env, headers);
      if (path === '/api/customer/conversations' && request.method === 'GET') return await customerConversations(request, env, headers);
      if (path === '/api/customer/voice-notes' && request.method === 'GET') return await customerVoiceNotes(request, env, headers);
      if (path === '/api/customer/follow-ups' && request.method === 'GET') return await customerFollowUps(request, env, headers);
      if (request.method === 'POST' && /^\/api\/customer\/follow-ups\/\d+$/.test(path)) return await customerUpdateFollowUp(request, env, headers, requestId);
      if (path === '/api/customer/leads' && request.method === 'GET') return await customerLeads(request, env, headers);
      if (path === '/api/customer/export' && request.method === 'GET') return await customerExport(request, env, headers, requestId);
      if (path === '/api/customer/settings' && request.method === 'GET') return await customerSettingsGet(request, env, headers);
      if (path === '/api/customer/settings' && request.method === 'PUT') return await customerSettingsPut(request, env, headers, requestId);

      if (path === '/api/owner/overview' && request.method === 'GET') return await ownerOverview(request, env, headers);
      if (path === '/api/owner/tenants' && request.method === 'GET') return await ownerTenants(request, env, headers, requestId);
      if (request.method === 'GET' && /^\/api\/owner\/tenants\/\d+$/.test(path)) return await ownerTenantDetail(request, env, headers, requestId);
      if (path === '/api/owner/invitations' && request.method === 'POST') return await createTenantInvitation(request, env, headers, requestId);
      if (path === '/api/owner/payments' && request.method === 'GET') return await ownerPaymentRequests(request, env, headers, requestId);
      if (request.method === 'POST' && /^\/api\/owner\/payments\/\d+\/(approve|reject)$/.test(path)) return await reviewPaymentRequest(request, env, headers, requestId);
      if (path === '/api/owner/audit' && request.method === 'GET') return await ownerAudit(request, env, headers);

      return json({ error: 'Not found', request_id: requestId }, 404, headers);
    } catch (error) {
      if (error instanceof AccessError) return json({ error: error.message, request_id: requestId }, error.status, headers);
      console.error(JSON.stringify({ request_id: requestId, path, error: String(error?.message || error) }));
      return json({ error: 'Internal server error', request_id: requestId }, 500, headers);
    }
  }
};

class AccessError extends Error {
  constructor(message, status = 403) { super(message); this.status = status; }
}

function securityHeaders(request, env, requestId) {
  const origin = request.headers.get('Origin');
  const allowedOrigins = new Set([
    new URL(request.url).origin,
    'https://maqtomate.pages.dev'
  ]);
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; img-src 'self' data:; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    'X-Request-ID': requestId
  });
  if (origin && allowedOrigins.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Vary', 'Origin');
  }
  return headers;
}

function json(payload, status, headers) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders });
}

function htmlResponse(content, status, headers) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(content, { status, headers: responseHeaders });
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new AccessError('Enter a valid email address.', 400);
  return email;
}

function cookieValue(request, name) {
  const raw = request.headers.get('Cookie') || '';
  const match = raw.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function sessionCookie(token) {
  return `mt_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

function clearSessionCookie() {
  return 'mt_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}

function base64Url(bytes) {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256(value) {
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(result)].map(v => v.toString(16).padStart(2, '0')).join('');
}

async function boundedRateLimit(env, key, max, seconds) {
  const existing = Number(await env.MAQVORA_KV.get(key) || '0');
  if (existing >= max) return false;
  await env.MAQVORA_KV.put(key, String(existing + 1), { expirationTtl: seconds });
  return true;
}

function assertSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return;
  const expected = new URL(request.url).origin;
  if (origin !== expected) throw new AccessError('Cross-site request blocked.', 403);
}

async function requireSession(request, env) {
  const rawToken = cookieValue(request, 'mt_session');
  if (!rawToken) throw new AccessError('Sign in required.', 401);
  const tokenHash = await sha256(rawToken);
  const session = await env.MAQVORA_DB.prepare(`
    SELECT s.id, s.user_id, u.email, u.display_name
    FROM user_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > datetime('now') AND u.status = 'active'
  `).bind(tokenHash).first();
  if (!session) throw new AccessError('Session expired. Please sign in again.', 401);

  const [platform, memberships] = await env.MAQVORA_DB.batch([
    env.MAQVORA_DB.prepare('SELECT role FROM platform_roles WHERE user_id = ? AND status = ?').bind(session.user_id, 'active'),
    env.MAQVORA_DB.prepare(`
      SELECT m.client_id, m.role, c.business_name, c.niche, c.active
      FROM tenant_memberships m JOIN clients c ON c.id = m.client_id
      WHERE m.user_id = ? AND m.status = 'active' AND c.active = 1
      ORDER BY c.business_name
    `).bind(session.user_id)
  ]);

  env.MAQVORA_DB.prepare('UPDATE user_sessions SET last_seen_at = datetime(\'now\') WHERE id = ?').bind(session.id).run().catch(() => {});
  return {
    session,
    user: { id: session.user_id, email: session.email, display_name: session.display_name },
    platformRole: platform.results?.[0]?.role || null,
    memberships: memberships.results || []
  };
}

function requirePlatform(access, allowed = ['owner', 'platform_admin']) {
  if (!access.platformRole || !allowed.includes(access.platformRole)) throw new AccessError('Owner or platform administrator access required.', 403);
}

function resolveTenant(access, url) {
  const requested = Number(url.searchParams.get('tenant') || 0);
  const membership = requested ? access.memberships.find(m => m.client_id === requested) : access.memberships[0];
  if (!membership) throw new AccessError('No active customer dashboard access is assigned to this account.', 403);
  return membership;
}

async function auditEvent(env, { actorUserId = null, actorRole = null, clientId = null, action, requestId, request, details = null }) {
  const ipHash = await sha256(request.headers.get('CF-Connecting-IP') || 'unknown');
  await env.MAQVORA_DB.prepare(`
    INSERT INTO dashboard_events (actor_user_id, client_id, actor_role, action, request_id, ip_hash, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(actorUserId, clientId, actorRole, action, requestId, ipHash, details ? JSON.stringify(details) : null).run();
}

async function requestMagicLink(request, env, headers, requestId) {
  assertSameOrigin(request);
  const body = await request.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const ipHash = await sha256(request.headers.get('CF-Connecting-IP') || 'unknown');
  const allowed = await boundedRateLimit(env, `auth:link:${ipHash}`, 5, 900);
  if (!allowed) throw new AccessError('Too many requests. Please wait before trying again.', 429);

  // A Turnstile secret turns this into the public production flow. Without a verified sender domain,
  // Resend only permits delivery to the account email, so test mode intentionally permits only the owner.
  const testOwner = (env.TEST_MODE_OWNER_EMAIL || TEST_OWNER_EMAIL).toLowerCase();
  const verifiedSenderConfigured = Boolean(env.EMAIL_FROM);
  const botProtectionEnabled = Boolean(env.TURNSTILE_SECRET);
  if (!verifiedSenderConfigured && email !== testOwner) {
    return json({ ok: true, message: 'If this account is eligible, a secure sign-in link will be sent.' }, 200, headers);
  }

  // The configured test-owner address is the single controlled bootstrap path while email delivery
  // remains limited to the Resend account owner. All other eligible logins remain Turnstile-protected.
  if (botProtectionEnabled && email !== testOwner) await verifyTurnstile(body.turnstile_token, request, env);
  const user = await env.MAQVORA_DB.prepare('SELECT id, email FROM users WHERE email = ? COLLATE NOCASE AND status = ?').bind(email, 'active').first();
  if (!user) return json({ ok: true, message: 'If this account is eligible, a secure sign-in link will be sent.' }, 200, headers);

  const token = randomToken();
  const tokenHash = await sha256(token);
  await env.MAQVORA_DB.prepare(`
    INSERT INTO magic_link_tokens (token_hash, email, purpose, expires_at)
    VALUES (?, ?, 'login', datetime('now', '+15 minutes'))
  `).bind(tokenHash, email).run();

  const portalUrl = env.PORTAL_URL || new URL(request.url).origin;
  const link = `${portalUrl}/auth/verify?token=${encodeURIComponent(token)}`;
  await sendMagicLinkEmail(env, email, link);
  await auditEvent(env, { actorUserId: user.id, action: 'auth.magic_link_requested', requestId, request });
  return json({ ok: true, message: 'If this account is eligible, a secure sign-in link will be sent.' }, 200, headers);
}

async function verifyMagicLink(request, env, headers, requestId) {
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!token || token.length < 32) throw new AccessError('This sign-in link is invalid or expired.', 400);
  const tokenHash = await sha256(token);
  const magic = await env.MAQVORA_DB.prepare(`
    SELECT id, email, purpose, client_id, role FROM magic_link_tokens
    WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
  `).bind(tokenHash).first();
  if (!magic) throw new AccessError('This sign-in link is invalid or has expired.', 400);

  const consumed = await env.MAQVORA_DB.prepare(`
    UPDATE magic_link_tokens SET used_at = datetime('now')
    WHERE id = ? AND used_at IS NULL
  `).bind(magic.id).run();
  if (!consumed.meta?.changes) throw new AccessError('This sign-in link has already been used.', 400);

  let user = await env.MAQVORA_DB.prepare('SELECT id, email FROM users WHERE email = ? COLLATE NOCASE').bind(magic.email).first();
  if (!user) {
    const created = await env.MAQVORA_DB.prepare(`INSERT INTO users (email, status, email_verified_at) VALUES (?, 'active', datetime('now'))`).bind(magic.email).run();
    user = { id: created.meta.last_row_id, email: magic.email };
  } else {
    await env.MAQVORA_DB.prepare(`UPDATE users SET status = 'active', email_verified_at = COALESCE(email_verified_at, datetime('now')), last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).bind(user.id).run();
  }

  if (magic.purpose === 'tenant_invite' && magic.client_id && CUSTOMER_ROLES.has(magic.role)) {
    await env.MAQVORA_DB.prepare(`
      INSERT INTO tenant_memberships (user_id, client_id, role, status)
      VALUES (?, ?, ?, 'active')
      ON CONFLICT(user_id, client_id) DO UPDATE SET role = excluded.role, status = 'active', updated_at = datetime('now')
    `).bind(user.id, magic.client_id, magic.role).run();
  }

  const sessionToken = randomToken(48);
  const sessionHash = await sha256(sessionToken);
  const ipHash = await sha256(request.headers.get('CF-Connecting-IP') || 'unknown');
  const uaHash = await sha256(request.headers.get('User-Agent') || 'unknown');
  await env.MAQVORA_DB.prepare(`
    INSERT INTO user_sessions (token_hash, user_id, expires_at, ip_hash, user_agent_hash)
    VALUES (?, ?, datetime('now', '+12 hours'), ?, ?)
  `).bind(sessionHash, user.id, ipHash, uaHash).run();

  await auditEvent(env, { actorUserId: user.id, action: 'auth.magic_link_login', requestId, request, clientId: magic.client_id || null });
  const platform = await env.MAQVORA_DB.prepare('SELECT role FROM platform_roles WHERE user_id = ? AND status = ?').bind(user.id, 'active').first();
  const redirectHeaders = new Headers(headers);
  redirectHeaders.set('Set-Cookie', sessionCookie(sessionToken));
  redirectHeaders.set('Location', platform?.role === 'owner' ? '/owner' : '/dashboard');
  return new Response(null, { status: 303, headers: redirectHeaders });
}

async function logout(request, env, headers, requestId) {
  assertSameOrigin(request);
  const raw = cookieValue(request, 'mt_session');
  if (raw) {
    const hash = await sha256(raw);
    const current = await env.MAQVORA_DB.prepare('SELECT user_id FROM user_sessions WHERE token_hash = ?').bind(hash).first();
    await env.MAQVORA_DB.prepare(`UPDATE user_sessions SET revoked_at = datetime('now') WHERE token_hash = ?`).bind(hash).run();
    if (current) await auditEvent(env, { actorUserId: current.user_id, action: 'auth.logout', requestId, request });
  }
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Set-Cookie', clearSessionCookie());
  return json({ ok: true }, 200, responseHeaders);
}

async function apiMe(request, env, headers) {
  const access = await requireSession(request, env);
  return json({ user: access.user, platform_role: access.platformRole, memberships: access.memberships }, 200, headers);
}

async function customerOverview(request, env, headers) {
  const access = await requireSession(request, env);
  const tenant = resolveTenant(access, new URL(request.url));
  const [client, today, latest, voiceToday] = await env.MAQVORA_DB.batch([
    env.MAQVORA_DB.prepare(`SELECT id, business_name, niche, country, plan, monthly_fee, client_mode, active, created_at FROM clients WHERE id = ?`).bind(tenant.client_id),
    env.MAQVORA_DB.prepare(`SELECT inbound_messages, outbound_messages, handoffs, errors, total_latency_ms FROM tenant_metrics_daily WHERE client_id = ? AND metric_date = date('now')`).bind(tenant.client_id),
    env.MAQVORA_DB.prepare(`SELECT COUNT(*) AS total_conversations, MAX(created_at) AS latest_message_at FROM logs WHERE client_id = ?`).bind(tenant.client_id),
    env.MAQVORA_DB.prepare(`SELECT voice_notes_received, voice_notes_transcribed, voice_note_failures, follow_ups_created, follow_ups_completed, qualified_leads FROM tenant_voice_metrics_daily WHERE client_id = ? AND metric_date = date('now')`).bind(tenant.client_id)
  ]);
  return json({
    tenant: client.results?.[0],
    plan: client.results?.[0] ? getPlanEntitlement(client.results[0]) : null,
    membership_role: tenant.role,
    today: today.results?.[0] || { inbound_messages: 0, outbound_messages: 0, handoffs: 0, errors: 0, total_latency_ms: 0 },
    voice_today: voiceToday.results?.[0] || { voice_notes_received: 0, voice_notes_transcribed: 0, voice_note_failures: 0, follow_ups_created: 0, follow_ups_completed: 0, qualified_leads: 0 },
    conversations: latest.results?.[0]
  }, 200, headers);
}

async function customerUsage(request, env, headers) {
  const access = await requireSession(request, env);
  const tenant = resolveTenant(access, new URL(request.url));
  const profile = await env.MAQVORA_DB.prepare('SELECT id, business_name, client_mode FROM clients WHERE id = ?').bind(tenant.client_id).first();
  if (!profile) throw new AccessError('Customer business not found.', 404);
  const entitlement = getPlanEntitlement(profile);
  const usage = await getTenantUsageSummary(env, profile);
  return json({ plan: { key: entitlement.key, label: entitlement.label, limits: entitlement.limits, features: entitlement.features }, usage }, 200, headers);
}

async function customerAutomations(request, env, headers) {
  const access = await requireSession(request, env);
  const tenant = resolveTenant(access, new URL(request.url));
  const profile = await env.MAQVORA_DB.prepare('SELECT id, client_mode FROM clients WHERE id = ?').bind(tenant.client_id).first();
  if (!profile) throw new AccessError('Customer business not found.', 404);
  if (!hasFeature(profile, FEATURE_KEYS.WORKFLOWS, env)) return json({ enabled: false, workflows: [], executions: [] }, 200, headers);
  const [workflows, executions] = await env.MAQVORA_DB.batch([
    env.MAQVORA_DB.prepare(`SELECT id, workflow_key, display_name, trigger_event, enabled, plan_required_feature, created_at, updated_at FROM automation_workflows WHERE client_id = ? ORDER BY id DESC LIMIT 100`).bind(tenant.client_id),
    env.MAQVORA_DB.prepare(`SELECT id, workflow_id, event_key, event_reference, status, error_category, started_at, finished_at FROM automation_executions WHERE client_id = ? ORDER BY id DESC LIMIT 100`).bind(tenant.client_id),
  ]);
  return json({ enabled: true, workflows: workflows.results || [], executions: executions.results || [] }, 200, headers);
}

async function customerConversations(request, env, headers) {
  const access = await requireSession(request, env);
  const url = new URL(request.url);
  const tenant = resolveTenant(access, url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), MAX_PAGE_SIZE);
  const before = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER);
  const rows = await env.MAQVORA_DB.prepare(`
    SELECT id, from_number, msg_type, query, response, created_at
    FROM logs WHERE client_id = ? AND id < ? ORDER BY id DESC LIMIT ?
  `).bind(tenant.client_id, before, limit).all();
  return json({ conversations: rows.results || [], next_before: rows.results?.length ? rows.results[rows.results.length - 1].id : null }, 200, headers);
}

async function customerVoiceNotes(request, env, headers) {
  const access = await requireSession(request, env);
  const url = new URL(request.url);
  const tenant = resolveTenant(access, url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), MAX_PAGE_SIZE);
  const before = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER);
  const rows = await env.MAQVORA_DB.prepare(`
    SELECT id, contact_phone_e164, mime_type, transcription_status, transcription_provider, transcript, ai_response,
           detected_language, received_at, transcribed_at, responded_at
    FROM voice_notes WHERE client_id = ? AND id < ? ORDER BY id DESC LIMIT ?
  `).bind(tenant.client_id, before, limit).all();
  return json({ voice_notes: rows.results || [], next_before: rows.results?.length ? rows.results[rows.results.length - 1].id : null }, 200, headers);
}

async function customerFollowUps(request, env, headers) {
  const access = await requireSession(request, env);
  const url = new URL(request.url);
  const tenant = resolveTenant(access, url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), MAX_PAGE_SIZE);
  const before = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER);
  const rows = await env.MAQVORA_DB.prepare(`
    SELECT f.id, f.lead_id, f.voice_note_id, f.task_type, f.task_status, f.priority, f.title, f.details,
           f.due_at, f.completed_at, f.created_at, l.contact_phone_e164, l.contact_name, l.lead_status
    FROM follow_up_tasks f LEFT JOIN lead_data l ON l.id = f.lead_id AND l.client_id = f.client_id
    WHERE f.client_id = ? AND f.id < ? ORDER BY CASE f.task_status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, f.priority DESC, f.id DESC LIMIT ?
  `).bind(tenant.client_id, before, limit).all();
  return json({ follow_ups: rows.results || [], next_before: rows.results?.length ? rows.results[rows.results.length - 1].id : null, membership_role: tenant.role }, 200, headers);
}

async function customerUpdateFollowUp(request, env, headers, requestId) {
  assertSameOrigin(request);
  const access = await requireSession(request, env);
  const tenant = resolveTenant(access, new URL(request.url));
  if (tenant.role !== 'customer_admin') throw new AccessError('Customer administrator access is required to update follow-up tasks.', 403);
  const taskId = Number(new URL(request.url).pathname.split('/').pop());
  if (!Number.isInteger(taskId) || taskId < 1) throw new AccessError('Invalid follow-up task identifier.', 400);
  const body = await request.json().catch(() => { throw new AccessError('Invalid JSON request.', 400); });
  const status = String(body.task_status || '').trim();
  if (!['open', 'in_progress', 'completed', 'dismissed'].includes(status)) throw new AccessError('Invalid follow-up status.', 400);
  const task = await env.MAQVORA_DB.prepare('SELECT id, task_status FROM follow_up_tasks WHERE id = ? AND client_id = ?').bind(taskId, tenant.client_id).first();
  if (!task) throw new AccessError('Follow-up task not found.', 404);
  const result = await env.MAQVORA_DB.prepare(`
    UPDATE follow_up_tasks SET task_status = ?, completed_at = CASE WHEN ? = 'completed' THEN datetime('now') ELSE NULL END,
      completed_by_user_id = CASE WHEN ? = 'completed' THEN ? ELSE NULL END, updated_at = datetime('now')
    WHERE id = ? AND client_id = ?
  `).bind(status, status, status, access.user.id, taskId, tenant.client_id).run();
  if (!result.meta?.changes) throw new AccessError('Follow-up task was not updated.', 409);
  if (status === 'completed' && task.task_status !== 'completed') await incrementTenantVoiceMetric(env, tenant.client_id, 'follow_ups_completed', 1);
  await auditEvent(env, { actorUserId: access.user.id, actorRole: tenant.role, clientId: tenant.client_id, action: 'customer.follow_up_updated', requestId, request, details: { task_id: taskId, task_status: status } });
  return json({ ok: true, task_status: status }, 200, headers);
}

async function incrementTenantVoiceMetric(env, clientId, metric, amount = 1) {
  const allowed = new Set(['follow_ups_completed']);
  if (!allowed.has(metric)) throw new AccessError('Unsupported metric.', 400);
  await env.MAQVORA_DB.prepare(`
    INSERT INTO tenant_voice_metrics_daily (client_id, metric_date, ${metric}, created_at, updated_at)
    VALUES (?, date('now'), ?, datetime('now'), datetime('now'))
    ON CONFLICT(client_id, metric_date) DO UPDATE SET ${metric} = ${metric} + excluded.${metric}, updated_at = datetime('now')
  `).bind(clientId, Math.max(0, Number(amount) || 0)).run();
}

async function customerLeads(request, env, headers) {
  const access = await requireSession(request, env);
  const url = new URL(request.url);
  const tenant = resolveTenant(access, url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), MAX_PAGE_SIZE);
  const before = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER);
  const rows = await env.MAQVORA_DB.prepare(`
    SELECT id, voice_note_id, source_type, contact_phone_e164, contact_name, contact_email,
           lead_status, interest_score, requested_service, preferred_contact_time,
           summary, consent_to_contact_at, do_not_contact_at, created_at, updated_at
    FROM lead_data WHERE client_id = ? AND id < ? ORDER BY id DESC LIMIT ?
  `).bind(tenant.client_id, before, limit).all();
  return json({ leads: rows.results || [], next_before: rows.results?.length ? rows.results[rows.results.length - 1].id : null }, 200, headers);
}

function safeExportDate(value, fieldName) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AccessError(`${fieldName} must be a valid date.`, 400);
  return date.toISOString();
}

function reportWorksheet(rows, headers, widths) {
  const shapedRows = rows.map(row => Object.fromEntries(headers.map(header => [header.key, row[header.key] ?? ''])));
  const worksheet = XLSX.utils.json_to_sheet(shapedRows, { header: headers.map(header => header.key) });
  XLSX.utils.sheet_add_aoa(worksheet, [headers.map(header => header.label)], { origin: 'A1' });
  worksheet['!cols'] = widths.map(width => ({ wch: width }));
  worksheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  return worksheet;
}

function safeFilename(value) {
  return String(value || 'maqtomate').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'maqtomate';
}

async function customerExport(request, env, headers, requestId) {
  const access = await requireSession(request, env);
  const url = new URL(request.url);
  const tenant = resolveTenant(access, url);
  const from = safeExportDate(url.searchParams.get('from'), 'from');
  const to = safeExportDate(url.searchParams.get('to'), 'to');
  if (from && to && Date.parse(from) > Date.parse(to)) throw new AccessError('from cannot be later than to.', 400);
  const filter = from || to ? ` AND created_at >= COALESCE(?, created_at) AND created_at <= COALESCE(?, created_at)` : '';
  const rangeParams = from || to ? [from, to] : [];
  const maxRows = 10000;
  const [tenantResult, voiceNotes, followUps, leads] = await env.MAQVORA_DB.batch([
    env.MAQVORA_DB.prepare('SELECT business_name, client_mode FROM clients WHERE id = ?').bind(tenant.client_id),
    env.MAQVORA_DB.prepare(`
      SELECT received_at, contact_phone_e164, mime_type, transcription_status, transcription_provider, transcript, ai_response, transcribed_at, responded_at
      FROM voice_notes WHERE client_id = ?${filter} ORDER BY id DESC LIMIT ?
    `).bind(tenant.client_id, ...rangeParams, maxRows),
    env.MAQVORA_DB.prepare(`
      SELECT f.created_at, f.task_type, f.task_status, f.priority, f.title, f.details, f.due_at, f.completed_at,
             l.contact_phone_e164, l.contact_name, l.lead_status
      FROM follow_up_tasks f LEFT JOIN lead_data l ON l.id = f.lead_id AND l.client_id = f.client_id
      WHERE f.client_id = ?${filter.replaceAll('created_at', 'f.created_at')} ORDER BY f.id DESC LIMIT ?
    `).bind(tenant.client_id, ...rangeParams, maxRows),
    env.MAQVORA_DB.prepare(`
      SELECT created_at, source_type, contact_phone_e164, contact_name, contact_email, lead_status, interest_score, requested_service,
             preferred_contact_time, summary, do_not_contact_at
      FROM lead_data WHERE client_id = ?${filter} ORDER BY id DESC LIMIT ?
    `).bind(tenant.client_id, ...rangeParams, maxRows)
  ]);
  const tenantProfile = tenantResult.results?.[0];
  if (!tenantProfile) throw new AccessError('Customer business not found.', 404);
  if (!hasFeature(tenantProfile, FEATURE_KEYS.EXCEL_EXPORT, env)) throw new AccessError('Excel export is not enabled for the current plan.', 403);
  const businessName = tenantProfile.business_name || 'Maqtomate Customer';
  const workbook = XLSX.utils.book_new();
  const summaryRows = [{
    business_name: businessName,
    exported_at_utc: new Date().toISOString(),
    range_from_utc: from || 'All retained records',
    range_to_utc: to || 'All retained records',
    voice_notes: voiceNotes.results?.length || 0,
    follow_up_tasks: followUps.results?.length || 0,
    leads: leads.results?.length || 0,
    note: 'Confidential tenant report. Do not share outside the authorized business team.'
  }];
  XLSX.utils.book_append_sheet(workbook, reportWorksheet(summaryRows, [
    { key: 'business_name', label: 'Business' }, { key: 'exported_at_utc', label: 'Exported (UTC)' }, { key: 'range_from_utc', label: 'From' }, { key: 'range_to_utc', label: 'To' },
    { key: 'voice_notes', label: 'Voice Notes' }, { key: 'follow_up_tasks', label: 'Follow-up Tasks' }, { key: 'leads', label: 'Leads' }, { key: 'note', label: 'Confidentiality Notice' }
  ], [28, 25, 25, 25, 14, 18, 12, 70]), 'Summary');
  XLSX.utils.book_append_sheet(workbook, reportWorksheet(voiceNotes.results || [], [
    { key: 'received_at', label: 'Received At' }, { key: 'contact_phone_e164', label: 'Contact Number' }, { key: 'mime_type', label: 'Audio Format' }, { key: 'transcription_status', label: 'Status' },
    { key: 'transcription_provider', label: 'Provider' }, { key: 'transcript', label: 'Transcript' }, { key: 'ai_response', label: 'AI Response' }, { key: 'transcribed_at', label: 'Transcribed At' }, { key: 'responded_at', label: 'Responded At' }
  ], [22, 18, 16, 16, 14, 65, 65, 22, 22]), 'Voice Notes');
  XLSX.utils.book_append_sheet(workbook, reportWorksheet(followUps.results || [], [
    { key: 'created_at', label: 'Created At' }, { key: 'task_type', label: 'Task Type' }, { key: 'task_status', label: 'Status' }, { key: 'priority', label: 'Priority' },
    { key: 'title', label: 'Task' }, { key: 'details', label: 'Details' }, { key: 'contact_phone_e164', label: 'Contact Number' }, { key: 'contact_name', label: 'Contact Name' },
    { key: 'lead_status', label: 'Lead Status' }, { key: 'due_at', label: 'Due At' }, { key: 'completed_at', label: 'Completed At' }
  ], [22, 20, 16, 14, 35, 70, 18, 22, 18, 22, 22]), 'Follow-up Tasks');
  XLSX.utils.book_append_sheet(workbook, reportWorksheet(leads.results || [], [
    { key: 'created_at', label: 'Created At' }, { key: 'source_type', label: 'Source' }, { key: 'contact_phone_e164', label: 'Contact Number' }, { key: 'contact_name', label: 'Contact Name' }, { key: 'contact_email', label: 'Email' },
    { key: 'lead_status', label: 'Lead Status' }, { key: 'interest_score', label: 'Interest Score' }, { key: 'requested_service', label: 'Requested Service' }, { key: 'preferred_contact_time', label: 'Preferred Contact Time' },
    { key: 'summary', label: 'Summary' }, { key: 'do_not_contact_at', label: 'Do Not Contact At' }
  ], [22, 18, 18, 22, 30, 18, 15, 32, 30, 65, 24]), 'Lead Data');
  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true });
  await auditEvent(env, { actorUserId: access.user.id, actorRole: tenant.role, clientId: tenant.client_id, action: 'customer.report_exported', requestId, request, details: { from: from || null, to: to || null, row_limit: maxRows } });
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  responseHeaders.set('Content-Disposition', `attachment; filename="${safeFilename(businessName)}-maqtomate-report.xlsx"`);
  responseHeaders.set('Cache-Control', 'no-store, private');
  return new Response(output, { status: 200, headers: responseHeaders });
}

async function customerSettingsGet(request, env, headers) {
  const access = await requireSession(request, env);
  const tenant = resolveTenant(access, new URL(request.url));
  const result = await env.MAQVORA_DB.prepare(`
    SELECT business_name, niche, country, working_hours, location, services, pricing, contact_number,
           ai_name, system_prompt_extra, handoff_triggers, unsupported_msg, fallback_msg, gemini_model
    FROM clients WHERE id = ?
  `).bind(tenant.client_id).first();
  return json({ settings: result, membership_role: tenant.role }, 200, headers);
}

async function customerSettingsPut(request, env, headers, requestId) {
  assertSameOrigin(request);
  const access = await requireSession(request, env);
  const tenant = resolveTenant(access, new URL(request.url));
  if (tenant.role !== 'customer_admin') throw new AccessError('Customer administrator access required.', 403);
  const body = await request.json().catch(() => { throw new AccessError('Invalid JSON request.', 400); });
  const allowed = ['business_name', 'working_hours', 'location', 'services', 'pricing', 'contact_number', 'ai_name', 'system_prompt_extra', 'handoff_triggers', 'unsupported_msg', 'fallback_msg', 'gemini_model'];
  const changes = Object.entries(body).filter(([key, value]) => allowed.includes(key) && typeof value === 'string' && value.length <= 20000);
  if (!changes.length) throw new AccessError('No permitted settings were provided.', 400);
  const sets = changes.map(([key]) => `${key} = ?`).join(', ');
  await env.MAQVORA_DB.prepare(`UPDATE clients SET ${sets}, updated_at = datetime('now') WHERE id = ?`).bind(...changes.map(([, value]) => value.trim()), tenant.client_id).run();
  await auditEvent(env, { actorUserId: access.user.id, actorRole: tenant.role, clientId: tenant.client_id, action: 'customer.settings_updated', requestId, request, details: { fields: changes.map(([key]) => key) } });
  return json({ ok: true }, 200, headers);
}

async function ownerOverviewData(env) {
  const [tenants, mrr, users, errors, voiceFleet, workflowFleet, usageFleet] = await env.MAQVORA_DB.batch([
    env.MAQVORA_DB.prepare(`SELECT COUNT(*) AS count FROM clients WHERE active = 1`),
    env.MAQVORA_DB.prepare(`SELECT COALESCE(SUM(monthly_fee), 0) AS amount FROM clients WHERE active = 1`),
    env.MAQVORA_DB.prepare(`SELECT COUNT(*) AS count FROM users WHERE status = 'active'`),
    env.MAQVORA_DB.prepare(`SELECT COALESCE(SUM(errors), 0) AS count FROM tenant_metrics_daily WHERE metric_date >= date('now', '-7 days')`),
    env.MAQVORA_DB.prepare(`SELECT COALESCE(SUM(voice_notes_received), 0) AS voice_notes_last_7_days, COALESCE(SUM(follow_ups_created), 0) AS follow_ups_created_last_7_days, COALESCE(SUM(qualified_leads), 0) AS qualified_leads_last_7_days FROM tenant_voice_metrics_daily WHERE metric_date >= date('now', '-7 days')`),
    env.MAQVORA_DB.prepare(`SELECT COUNT(*) AS enabled_workflows, COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_executions_last_7_days FROM automation_workflows w LEFT JOIN automation_executions e ON e.workflow_id = w.id AND e.started_at >= datetime('now', '-7 days') WHERE w.enabled = 1`),
    env.MAQVORA_DB.prepare(`SELECT COALESCE(SUM(quantity), 0) AS ai_requests_current_period FROM tenant_usage_periods WHERE metric_key = 'ai_requests' AND period_start = strftime('%Y-%m-01', 'now')`)
  ]);
  return {
    active_tenants: tenants.results?.[0]?.count || 0,
    monthly_recurring_revenue: mrr.results?.[0]?.amount || 0,
    active_users: users.results?.[0]?.count || 0,
    errors_last_7_days: errors.results?.[0]?.count || 0,
    voice_notes_last_7_days: voiceFleet.results?.[0]?.voice_notes_last_7_days || 0,
    follow_ups_created_last_7_days: voiceFleet.results?.[0]?.follow_ups_created_last_7_days || 0,
    qualified_leads_last_7_days: voiceFleet.results?.[0]?.qualified_leads_last_7_days || 0,
    enabled_workflows: workflowFleet.results?.[0]?.enabled_workflows || 0,
    failed_workflow_executions_last_7_days: workflowFleet.results?.[0]?.failed_executions_last_7_days || 0,
    ai_requests_current_period: usageFleet.results?.[0]?.ai_requests_current_period || 0
  };
}

async function ownerOverview(request, env, headers) {
  const access = await requireSession(request, env);
  requirePlatform(access);
  return json(await ownerOverviewData(env), 200, headers);
}

async function ownerTestTenantData(env) {
  return await env.MAQVORA_DB.prepare(`
    SELECT c.id, c.business_name, c.plan, c.monthly_fee, c.active, c.created_at,
           twc.connection_status, twc.webhook_status, twc.phone_status, twc.token_status, twc.last_test_at
    FROM clients c
    LEFT JOIN tenant_whatsapp_connections twc ON twc.client_id = c.id
    WHERE c.business_name = 'Maqtomate Owner Test Tenant'
    LIMIT 1
  `).first();
}

async function ownerConsole(request, env, headers) {
  const access = await requireSession(request, env);
  requirePlatform(access, ['owner']);
  const [overview, testTenant] = await Promise.all([ownerOverviewData(env), ownerTestTenantData(env)]);
  return htmlResponse(ownerConsoleHTML(access.user, overview, testTenant), 200, headers);
}

async function provisionOwnerTestTenant(request, env, headers, requestId) {
  assertSameOrigin(request);
  const access = await requireSession(request, env);
  requirePlatform(access, ['owner']);
  const existing = await ownerTestTenantData(env);
  if (existing) return redirectOwnerConsole(headers, 'already-provisioned');

  const marker = `owner-test-pending-${Date.now()}`;
  const created = await env.MAQVORA_DB.prepare(`
    INSERT INTO clients (business_name, niche, country, plan, monthly_fee, phone_number_id, whatsapp_token, verify_token, client_mode, active, ai_name, gemini_model)
    VALUES ('Maqtomate Owner Test Tenant', 'internal_owner_test', 'PK', 'owner_test', 0, ?, '', ?, 3, 1, 'Maqtomate AI Employee', 'gemini-3.6-flash')
  `).bind(marker, `${marker}-verify`).run();
  const clientId = created.meta?.last_row_id;
  if (!clientId) throw new Error('Owner Test Tenant could not be provisioned.');

  await env.MAQVORA_DB.batch([
    env.MAQVORA_DB.prepare(`
      INSERT INTO tenant_memberships (user_id, client_id, role, status)
      VALUES (?, ?, 'customer_admin', 'active')
    `).bind(access.user.id, clientId),
    env.MAQVORA_DB.prepare(`
      INSERT INTO tenant_whatsapp_connections (client_id, connection_status, webhook_status, phone_status, token_status)
      VALUES (?, 'ONBOARDING_STARTED', 'WEBHOOK_VERIFIED', 'NOT_FOUND', 'NOT_AVAILABLE')
    `).bind(clientId)
  ]);
  await auditEvent(env, {
    actorUserId: access.user.id,
    actorRole: access.platformRole,
    clientId,
    action: 'owner.test_tenant_provisioned_payment_exempt',
    requestId,
    request,
    details: { payment_exempt: true, credential_mode: 'metadata_only' }
  });
  return redirectOwnerConsole(headers, 'provisioned');
}

async function attachMaqtomateTestSender(request, env, headers, requestId) {
  assertSameOrigin(request);
  const access = await requireSession(request, env);
  requirePlatform(access, ['owner']);
  const testTenant = await ownerTestTenantData(env);
  if (!testTenant) throw new AccessError('Create the Owner Test Tenant before attaching the Maqtomate test sender.', 409);
  await env.MAQVORA_DB.batch([
    env.MAQVORA_DB.prepare(`UPDATE clients SET phone_number_id = ?, updated_at = datetime('now') WHERE id = ?`).bind(MAQTOMATE_TEST_PHONE_ID, testTenant.id),
    env.MAQVORA_DB.prepare(`
      INSERT INTO tenant_whatsapp_connections (client_id, waba_id, phone_number_id, display_phone_number, display_name, connection_status, webhook_status, phone_status, token_status, updated_at)
      VALUES (?, ?, ?, ?, 'Maqtomate Meta Test Sender', 'PHONE_FOUND', 'WEBHOOK_VERIFIED', 'FOUND', 'NOT_AVAILABLE', datetime('now'))
      ON CONFLICT(client_id) DO UPDATE SET
        waba_id = excluded.waba_id, phone_number_id = excluded.phone_number_id,
        display_phone_number = excluded.display_phone_number, display_name = excluded.display_name,
        connection_status = 'PHONE_FOUND', webhook_status = 'WEBHOOK_VERIFIED',
        phone_status = 'FOUND', token_status = CASE WHEN tenant_whatsapp_connections.token_status = 'VALID' THEN 'VALID' ELSE 'NOT_AVAILABLE' END,
        updated_at = datetime('now')
    `).bind(testTenant.id, MAQTOMATE_TEST_WABA_ID, MAQTOMATE_TEST_PHONE_ID, MAQTOMATE_TEST_DISPLAY_NUMBER)
  ]);
  await auditEvent(env, {
    actorUserId: access.user.id,
    actorRole: access.platformRole,
    clientId: testTenant.id,
    action: 'owner.test_tenant.maqtomate_test_sender_attached',
    requestId,
    request,
    details: { sender_type: 'maqtomate_owned_meta_test_asset', credential_stored: false }
  });
  return redirectOwnerConsole(headers, 'test-sender-attached');
}

function redirectOwnerConsole(headers, status) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Location', `/owner?test-tenant=${encodeURIComponent(status)}`);
  return new Response(null, { status: 303, headers: responseHeaders });
}

async function ownerTenants(request, env, headers, requestId) {
  const access = await requireSession(request, env);
  requirePlatform(access);
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), MAX_PAGE_SIZE);
  const cursor = Math.max(Number(url.searchParams.get('cursor') || 0), 0);
  const search = String(url.searchParams.get('search') || '').trim().toLowerCase().slice(0, 100);
  const status = String(url.searchParams.get('status') || 'all');
  const mode = String(url.searchParams.get('mode') || 'all');
  const filters = ['c.id > ?'];
  const params = [cursor];
  if (search) {
    filters.push('(LOWER(c.business_name) LIKE ? OR LOWER(c.niche) LIKE ? OR LOWER(c.country) LIKE ?)');
    const needle = `%${search}%`;
    params.push(needle, needle, needle);
  }
  if (status === 'active') filters.push('c.active = 1');
  if (status === 'inactive') filters.push('c.active = 0');
  if (['1', '2', '3'].includes(mode)) {
    filters.push('c.client_mode = ?');
    params.push(Number(mode));
  }
  params.push(limit);
  const rows = await env.MAQVORA_DB.prepare(`
    SELECT c.id, c.business_name, c.niche, c.country, c.plan, c.monthly_fee, c.client_mode, c.active, c.created_at, c.updated_at,
           (SELECT COUNT(*) FROM tenant_memberships tm WHERE tm.client_id = c.id AND tm.status = 'active') AS team_members,
           (SELECT COUNT(*) FROM magic_link_tokens ml WHERE ml.client_id = c.id AND ml.purpose = 'tenant_invite' AND ml.used_at IS NULL AND ml.expires_at > datetime('now')) AS pending_invites,
           (SELECT MAX(l.created_at) FROM logs l WHERE l.client_id = c.id) AS last_message_at,
           (SELECT COALESCE(SUM(m.errors), 0) FROM tenant_metrics_daily m WHERE m.client_id = c.id AND m.metric_date >= date('now', '-7 days')) AS errors_last_7_days
    FROM clients c WHERE ${filters.join(' AND ')} ORDER BY c.id ASC LIMIT ?
  `).bind(...params).all();
  const results = rows.results || [];
  await auditEvent(env, { actorUserId: access.user.id, actorRole: access.platformRole, action: 'owner.customer_directory_viewed', requestId, request, details: { search: Boolean(search), status, mode } });
  return json({ tenants: results, next_cursor: results.length ? results[results.length - 1].id : null }, 200, headers);
}

async function ownerTenantDetail(request, env, headers, requestId) {
  const access = await requireSession(request, env);
  requirePlatform(access);
  const id = Number(new URL(request.url).pathname.split('/').pop());
  if (!Number.isInteger(id) || id < 1) throw new AccessError('Invalid customer identifier.', 400);
  const [tenant, team, metrics, voiceMetrics, recentEvents, recentConversations, recentCalls] = await env.MAQVORA_DB.batch([
    env.MAQVORA_DB.prepare(`
      SELECT id, business_name, niche, country, plan, monthly_fee, client_mode, active, created_at, updated_at,
             working_hours, services, pricing, ai_name, system_prompt_extra,
             handoff_triggers, unsupported_msg, fallback_msg, gemini_model
      FROM clients WHERE id = ?
    `).bind(id),
    env.MAQVORA_DB.prepare(`
      SELECT u.email, u.display_name, u.status AS user_status, u.last_login_at, tm.role, tm.status AS membership_status, tm.created_at
      FROM tenant_memberships tm JOIN users u ON u.id = tm.user_id
      WHERE tm.client_id = ? ORDER BY tm.created_at DESC
    `).bind(id),
    env.MAQVORA_DB.prepare(`
      SELECT COALESCE(SUM(inbound_messages), 0) AS inbound_30d,
             COALESCE(SUM(outbound_messages), 0) AS outbound_30d,
             COALESCE(SUM(handoffs), 0) AS handoffs_30d,
             COALESCE(SUM(errors), 0) AS errors_30d,
             COALESCE(SUM(total_latency_ms), 0) AS total_latency_ms_30d
      FROM tenant_metrics_daily WHERE client_id = ? AND metric_date >= date('now', '-30 days')
    `).bind(id),
    env.MAQVORA_DB.prepare(`
      SELECT COALESCE(SUM(voice_notes_received), 0) AS voice_notes_30d,
             COALESCE(SUM(voice_notes_transcribed), 0) AS voice_notes_transcribed_30d,
             COALESCE(SUM(follow_ups_created), 0) AS follow_ups_created_30d,
             COALESCE(SUM(follow_ups_completed), 0) AS follow_ups_completed_30d,
             COALESCE(SUM(qualified_leads), 0) AS qualified_leads_30d
      FROM tenant_voice_metrics_daily WHERE client_id = ? AND metric_date >= date('now', '-30 days')
    `).bind(id),
    env.MAQVORA_DB.prepare(`
      SELECT action, actor_role, created_at FROM dashboard_events
      WHERE client_id = ? ORDER BY id DESC LIMIT 20
    `).bind(id),
    env.MAQVORA_DB.prepare(`
      SELECT id, from_number, msg_type, query, response, created_at
      FROM logs WHERE client_id = ? ORDER BY id DESC LIMIT 20
    `).bind(id),
    env.MAQVORA_DB.prepare(`
      SELECT f.id, f.task_type, f.task_status, f.priority, f.title, f.due_at, f.created_at,
             l.contact_phone_e164, l.contact_name, l.lead_status
      FROM follow_up_tasks f LEFT JOIN lead_data l ON l.id = f.lead_id AND l.client_id = f.client_id
      WHERE f.client_id = ? ORDER BY f.id DESC LIMIT 20
    `).bind(id)
  ]);
  const customer = tenant.results?.[0];
  if (!customer) throw new AccessError('Customer not found.', 404);
  await auditEvent(env, { actorUserId: access.user.id, actorRole: access.platformRole, clientId: id, action: 'owner.customer_detail_viewed', requestId, request });
  return json({
    tenant: customer,
    team: team.results || [],
    metrics_30d: metrics.results?.[0] || {},
    voice_metrics_30d: voiceMetrics.results?.[0] || {},
    recent_events: recentEvents.results || [],
    recent_conversations: recentConversations.results || [],
    recent_follow_ups: recentCalls.results || []
  }, 200, headers);
}


async function ownerPaymentRequests(request, env, headers, requestId) {
  const access = await requireSession(request, env);
  requirePlatform(access, ['owner']);
  const status = String(new URL(request.url).searchParams.get('status') || 'pending_review');
  const allowed = new Set(['pending_review', 'approved', 'rejected', 'cancelled', 'all']);
  if (!allowed.has(status)) throw new AccessError('Invalid payment status.', 400);
  const filter = status === 'all' ? '' : 'WHERE p.status = ?';
  const query = `SELECT p.id, p.client_id, p.dashboard_email, p.payer_name, p.payment_method, p.payment_reference,
                       p.expected_amount, p.currency, p.status, p.submitted_at, p.reviewed_at, p.review_note,
                       c.business_name, c.client_mode, c.active
                FROM tenant_payment_requests p JOIN clients c ON c.id = p.client_id
                ${filter} ORDER BY CASE p.status WHEN 'pending_review' THEN 0 ELSE 1 END, p.submitted_at DESC LIMIT 100`;
  const rows = await env.MAQVORA_DB.prepare(query).bind(...(status === 'all' ? [] : [status])).all();
  await auditEvent(env, { actorUserId: access.user.id, actorRole: access.platformRole, action: 'owner.payment_queue_viewed', requestId, request, details: { status } });
  return json({ payments: rows.results || [] }, 200, headers);
}

async function reviewPaymentRequest(request, env, headers, requestId) {
  assertSameOrigin(request);
  const access = await requireSession(request, env);
  requirePlatform(access, ['owner']);
  const url = new URL(request.url);
  const segments = url.pathname.split('/');
  const paymentId = Number(segments[4]);
  const decision = segments[5];
  if (!Number.isInteger(paymentId) || paymentId < 1 || !['approve', 'reject'].includes(decision)) throw new AccessError('Invalid payment review request.', 400);
  const body = await request.json().catch(() => ({}));
  const note = String(body.note || '').trim().slice(0, 1000);
  const payment = await env.MAQVORA_DB.prepare(`
    SELECT id, client_id, dashboard_email, status FROM tenant_payment_requests WHERE id = ?
  `).bind(paymentId).first();
  if (!payment) throw new AccessError('Payment request not found.', 404);
  if (payment.status !== 'pending_review') throw new AccessError('This payment request has already been reviewed.', 409);

  if (decision === 'reject') {
    const changed = await env.MAQVORA_DB.prepare(`
      UPDATE tenant_payment_requests
      SET status = 'rejected', reviewed_at = datetime('now'), reviewed_by_user_id = ?, review_note = ?, updated_at = datetime('now')
      WHERE id = ? AND status = 'pending_review'
    `).bind(access.user.id, note || 'Payment could not be verified.', paymentId).run();
    if (!changed.meta?.changes) throw new AccessError('This payment request has already been reviewed.', 409);
    await auditEvent(env, { actorUserId: access.user.id, actorRole: access.platformRole, clientId: payment.client_id, action: 'owner.payment_rejected', requestId, request, details: { payment_id: paymentId } });
    return json({ ok: true, status: 'rejected' }, 200, headers);
  }

  const token = randomToken(48);
  const tokenHash = await sha256(token);
  const approval = await env.MAQVORA_DB.prepare(`
    UPDATE tenant_payment_requests
    SET status = 'approved', reviewed_at = datetime('now'), reviewed_by_user_id = ?, review_note = ?, activation_issued_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND status = 'pending_review'
  `).bind(access.user.id, note || 'Payment verified by Owner.', paymentId).run();
  if (!approval.meta?.changes) throw new AccessError('This payment request has already been reviewed.', 409);
  try {
    await env.MAQVORA_DB.batch([
      env.MAQVORA_DB.prepare(`UPDATE clients SET active = 1, updated_at = datetime('now') WHERE id = ?`).bind(payment.client_id),
      env.MAQVORA_DB.prepare(`
        INSERT INTO magic_link_tokens (token_hash, email, purpose, client_id, role, invited_by_user_id, expires_at)
        VALUES (?, ?, 'tenant_invite', ?, 'customer_admin', ?, datetime('now', '+72 hours'))
      `).bind(tokenHash, payment.dashboard_email, payment.client_id, access.user.id)
    ]);
  } catch (error) {
    await env.MAQVORA_DB.prepare(`
      UPDATE tenant_payment_requests
      SET status = 'pending_review', reviewed_at = NULL, reviewed_by_user_id = NULL, review_note = NULL, activation_issued_at = NULL, updated_at = datetime('now')
      WHERE id = ? AND status = 'approved'
    `).bind(paymentId).run();
    await env.MAQVORA_DB.prepare(`UPDATE clients SET active = 0, updated_at = datetime('now') WHERE id = ?`).bind(payment.client_id).run();
    throw error;
  }
  const portalUrl = env.PORTAL_URL || new URL(request.url).origin;
  const activationUrl = `${portalUrl}/auth/verify?token=${encodeURIComponent(token)}`;
  await auditEvent(env, { actorUserId: access.user.id, actorRole: access.platformRole, clientId: payment.client_id, action: 'owner.payment_approved_access_issued', requestId, request, details: { payment_id: paymentId } });
  return json({ ok: true, status: 'approved', activation_url: activationUrl, expires_in_hours: 72, customer_email: payment.dashboard_email }, 200, headers);
}

async function createTenantInvitation(request, env, headers, requestId) {
  assertSameOrigin(request);
  const access = await requireSession(request, env);
  requirePlatform(access, ['owner', 'platform_admin']);
  const body = await request.json().catch(() => { throw new AccessError('Invalid JSON request.', 400); });
  const email = normalizeEmail(body.email);
  const clientId = Number(body.client_id);
  const role = String(body.role || 'customer_admin');
  if (!Number.isInteger(clientId) || clientId < 1 || !CUSTOMER_ROLES.has(role)) throw new AccessError('Invalid tenant invitation.', 400);
  const client = await env.MAQVORA_DB.prepare('SELECT id FROM clients WHERE id = ? AND active = 1').bind(clientId).first();
  if (!client) throw new AccessError('Active tenant not found.', 404);

  const testOwner = (env.TEST_MODE_OWNER_EMAIL || TEST_OWNER_EMAIL).toLowerCase();
  const token = randomToken();
  const hash = await sha256(token);
  await env.MAQVORA_DB.prepare(`
    INSERT INTO magic_link_tokens (token_hash, email, purpose, client_id, role, invited_by_user_id, expires_at)
    VALUES (?, ?, 'tenant_invite', ?, ?, ?, datetime('now', '+72 hours'))
  `).bind(hash, email, clientId, role, access.user.id).run();

  const portalUrl = env.PORTAL_URL || new URL(request.url).origin;
  const activationUrl = `${portalUrl}/auth/verify?token=${encodeURIComponent(token)}`;
  let delivery = 'manual';
  // With no verified sender domain, Resend permits test delivery only to the account owner.
  // The owner receives a one-time URL that can be shared privately via the business's verified channel.
  if (env.EMAIL_FROM || email === testOwner) {
    await sendMagicLinkEmail(env, email, activationUrl, 'You are invited to Maqtomate');
    delivery = 'email';
  }
  await auditEvent(env, { actorUserId: access.user.id, actorRole: access.platformRole, clientId, action: 'owner.tenant_invited', requestId, request, details: { email, role, delivery } });
  return json({ ok: true, delivery, activation_url: delivery === 'manual' ? activationUrl : null, expires_in_hours: 72 }, 201, headers);
}

async function ownerAudit(request, env, headers) {
  const access = await requireSession(request, env);
  requirePlatform(access, ['owner']);
  const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get('limit') || 50), 1), MAX_PAGE_SIZE);
  const rows = await env.MAQVORA_DB.prepare(`
    SELECT e.id, e.action, e.actor_role, e.client_id, e.request_id, e.created_at, u.email AS actor_email
    FROM dashboard_events e LEFT JOIN users u ON u.id = e.actor_user_id
    ORDER BY e.id DESC LIMIT ?
  `).bind(limit).all();
  return json({ events: rows.results || [] }, 200, headers);
}

async function verifyTurnstile(token, request, env) {
  if (!token) throw new AccessError('Bot verification is required.', 400);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: request.headers.get('CF-Connecting-IP') || undefined })
  });
  const result = await response.json();
  if (!result.success) throw new AccessError('Bot verification failed. Please try again.', 400);
}

async function sendMagicLinkEmail(env, email, link, customSubject = 'Your secure Maqtomate sign-in link') {
  if (!env.RESEND_API_KEY) throw new Error('Email service is not configured.');
  const from = env.EMAIL_FROM || 'Maqtomate <onboarding@resend.dev>';
  const subject = customSubject;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px;color:#111827"><h1 style="font-size:24px">Maqtomate secure sign-in</h1><p>Use the button below to sign in securely. This link expires in ${MAGIC_LINK_TTL_MINUTES} minutes and can be used only once.</p><p style="margin:28px 0"><a href="${escapeHtml(link)}" style="background:#059669;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:700">Sign in to Maqtomate</a></p><p style="font-size:13px;color:#6b7280">If you did not request this link, you can safely ignore this email.</p></div>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [email], subject, html })
  });
  if (!response.ok) throw new Error(`Email delivery failed with status ${response.status}.`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
}

function loginHTML(env) {
  const siteKey = String(env.TURNSTILE_SITEKEY || '');
  const turnstileScript = siteKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>' : '';
  const turnstileWidget = siteKey ? '<div id="turnstile" style="margin:12px 0"></div>' : '';
  const useTurnstile = siteKey ? 'true' : 'false';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maqtomate Portal</title>${turnstileScript}<style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:#071a16;color:#eef8f4;display:grid;min-height:100vh;place-items:center}.card{max-width:440px;padding:34px;border:1px solid #24594b;border-radius:20px;background:#0d2922;box-shadow:0 24px 70px #0007}h1{margin:0 0 8px}p{color:#b7d0c8;line-height:1.55}input{box-sizing:border-box;width:100%;padding:14px;margin:14px 0;border:1px solid #3e7667;border-radius:10px;background:#06130f;color:#fff;font-size:16px}button{width:100%;padding:14px;border:0;border-radius:10px;background:#17a673;color:white;font-weight:700;font-size:16px;cursor:pointer}button:disabled{opacity:.6}#note{min-height:24px;font-size:14px;margin-top:14px}</style></head><body><main class="card"><div style="font-size:13px;color:#62e8b8;font-weight:700;letter-spacing:.08em">MAQTOMATE PORTAL</div><h1>Secure dashboard access</h1><p>Enter your approved email address. We will send a one-time sign-in link. No password is stored.</p><form id="form"><input id="email" type="email" autocomplete="email" required placeholder="you@business.com">${turnstileWidget}<button id="submit">Send secure sign-in link</button><div id="note" aria-live="polite"></div></form></main><script>let turnstileToken='';const f=document.querySelector('#form'),n=document.querySelector('#note'),b=document.querySelector('#submit');function initTurnstile(){if(${useTurnstile}&&window.turnstile){window.turnstile.render('#turnstile',{sitekey:'${siteKey}',callback:t=>{turnstileToken=t},'expired-callback':()=>{turnstileToken=''}})}else if(${useTurnstile}){setTimeout(initTurnstile,100)}}initTurnstile();f.addEventListener('submit',async e=>{e.preventDefault();b.disabled=true;n.textContent='Requesting secure link…';try{const r=await fetch('/auth/request-link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.querySelector('#email').value,turnstile_token:turnstileToken})});const d=await r.json();n.textContent=d.message||'If eligible, a link is on its way.'}catch(e){n.textContent='Unable to request a link. Please try again.'}finally{b.disabled=false}});</script></body></html>`;
}

function ownerConsoleHTML(user, overview, testTenant) {
  const safeName = escapeHtml(user.display_name || user.email);
  const metric = value => Number(value || 0).toLocaleString('en-PK');
  const attachAction = testTenant && testTenant.phone_status !== 'FOUND'
    ? `<form method="post" action="/owner/test-tenant/attach-maqtomate-test-sender"><button type="submit">Attach Maqtomate-owned test sender</button></form>`
    : '';
  const tenantStatus = testTenant
    ? `<section class="card"><div class="eyebrow">OWNER TEST TENANT</div><h2>${escapeHtml(testTenant.business_name)}</h2><p class="success">Payment exempt · Active · Customer-equivalent test workspace</p><dl><div><dt>Connection</dt><dd>${escapeHtml(testTenant.connection_status || 'NOT_CONNECTED')}</dd></div><div><dt>Webhook</dt><dd>${escapeHtml(testTenant.webhook_status || 'NOT_CONFIGURED')}</dd></div><div><dt>Sender phone</dt><dd>${escapeHtml(testTenant.phone_status || 'NOT_FOUND')}</dd></div><div><dt>Token state</dt><dd>${escapeHtml(testTenant.token_status || 'NOT_AVAILABLE')}</dd></div></dl><p class="muted">No personal WhatsApp number, token, or secret is stored in this tenant. Sender metadata may be attached only after explicit owner approval. A Meta System User token remains required through the encrypted server-side handoff before any message can be sent.</p>${attachAction}</section>`
    : `<section class="card"><div class="eyebrow">OWNER TEST TENANT</div><h2>Run Maqtomate like your first customer</h2><p>Create one payment-exempt internal tenant. It follows the customer onboarding model but never creates a billing request, uses no customer credential, and never touches your personal WhatsApp number.</p><form method="post" action="/owner/test-tenant/provision"><button type="submit">Create payment-exempt Owner Test Tenant</button></form></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maqtomate Owner Console</title><style>:root{--deep:#062f24;--brand:#10a86f;--soft:#f3f8f6;--ink:#102720;--muted:#547067;--line:#d8e8e1}*{box-sizing:border-box}body{margin:0;background:var(--soft);color:var(--ink);font-family:Inter,system-ui,sans-serif}.bar{padding:16px max(18px,calc((100vw - 1080px)/2));color:#fff;background:linear-gradient(115deg,#063c2c,#0b674b);display:flex;justify-content:space-between;gap:14px;align-items:center}.brand{font-weight:850}.sub{font-size:13px;opacity:.82;margin-left:8px}.out,button{border:0;border-radius:9px;padding:10px 14px;font:inherit;font-weight:760;cursor:pointer}.out{background:#e3f7ee;color:#075e43}.wrap{max-width:1080px;margin:30px auto;padding:0 18px}.hero{margin-bottom:20px}.hero h1{margin:0 0 8px;font-size:clamp(28px,5vw,42px);letter-spacing:-.045em}.hero p,.muted{color:var(--muted);line-height:1.55}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:18px 0}.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px;box-shadow:0 10px 26px #164b3810}.label,.eyebrow{font-size:12px;font-weight:800;color:var(--muted);letter-spacing:.06em}.eyebrow{color:#087950}.value{font-size:28px;font-weight:850;margin-top:7px;letter-spacing:-.04em}h2{margin:8px 0;font-size:22px}button{background:var(--brand);color:#fff;margin-top:8px}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:18px 0}dl div{padding:12px;border:1px solid var(--line);border-radius:10px;background:#fbfdfc}dt{font-size:12px;color:var(--muted)}dd{margin:5px 0 0;font-weight:780;overflow-wrap:anywhere}.success{color:#087950;font-weight:720}@media(max-width:720px){.wrap{margin:20px auto;padding:0 14px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.sub{display:none}dl{grid-template-columns:1fr}}@media(max-width:380px){.grid{grid-template-columns:1fr}}</style></head><body><header class="bar"><div><span class="brand">Maqtomate</span><span class="sub">Owner Console</span></div><form method="post" action="/auth/logout"><button class="out" type="submit">Sign out</button></form></header><main class="wrap"><section class="hero"><div class="eyebrow">OWNER-ONLY CONTROL SURFACE</div><h1>Welcome, ${safeName}</h1><p>This console is server-rendered for reliable mobile access. It shows live fleet data without relying on browser-side dashboard initialization.</p></section><section class="grid"><article class="card"><div class="label">Active customers</div><div class="value">${metric(overview.active_tenants)}</div></article><article class="card"><div class="label">Platform users</div><div class="value">${metric(overview.active_users)}</div></article><article class="card"><div class="label">Monthly revenue</div><div class="value">Rs ${metric(overview.monthly_recurring_revenue)}</div></article><article class="card"><div class="label">Errors — 7 days</div><div class="value">${metric(overview.errors_last_7_days)}</div></article></section>${tenantStatus}</main></body></html>`;
}

function dashboardHTML(user, initialOwnerOverview = null, platformRole = null) {
  const safeName = escapeHtml(user.display_name || user.email);
  const overview = initialOwnerOverview || {};
  const metric = value => Number(value || 0).toLocaleString('en-PK');
  const ownerClass = platformRole ? '' : 'hidden';
  const loadingClass = platformRole ? 'hidden' : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maqtomate Control Center</title>
<style>
:root{--ink:#0d211a;--muted:#55736a;--deep:#063c2c;--brand:#0d9362;--soft:#f4f8f6;--line:#dbe9e3;--card:#fff;--danger:#b42318}*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:var(--soft);color:var(--ink)}button,input,select{font:inherit}.bar{background:linear-gradient(115deg,#063c2c,#0b5740);color:#fff;padding:15px max(18px,calc((100vw - 1240px)/2));display:flex;align-items:center;justify-content:space-between;gap:14px;position:sticky;top:0;z-index:5}.brand{font-weight:800;letter-spacing:-.02em}.sub{opacity:.76;margin-left:8px;font-size:14px}.who{font-size:14px;opacity:.9;margin-right:9px}.out{border:0;background:#dff4eb;color:#075d41;border-radius:8px;padding:9px 12px;font-weight:750;cursor:pointer}.wrap{max-width:1240px;margin:28px auto;padding:0 18px}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 24px}.tab{padding:10px 14px;border:1px solid var(--line);border-radius:9px;background:#fff;color:#315b4d;font-weight:700;cursor:pointer}.tab.active{color:#fff;background:var(--deep);border-color:var(--deep)}.panel{display:none}.panel.active{display:block}.intro{margin:0 0 20px}.intro h1{font-size:28px;margin:0 0 5px;letter-spacing:-.035em}.intro p{margin:0;color:var(--muted);line-height:1.5}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.card,.directory,.detail{background:var(--card);border:1px solid var(--line);border-radius:15px;box-shadow:0 8px 22px #164b3810}.card{padding:18px}.label{color:var(--muted);font-size:13px}.value{font-size:26px;font-weight:800;margin-top:6px;letter-spacing:-.03em}.directory{overflow:hidden}.directory-top{padding:18px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}.directory-title{font-size:18px;font-weight:800}.filters{display:flex;gap:8px;flex-wrap:wrap}.filters input,.filters select{padding:9px 10px;border:1px solid #bfd5cc;border-radius:8px;background:white;color:var(--ink)}.primary{border:0;padding:10px 13px;background:var(--brand);color:#fff;border-radius:8px;font-weight:750;cursor:pointer}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;min-width:800px}th{text-align:left;font-size:12px;letter-spacing:.03em;text-transform:uppercase;color:var(--muted);background:#f8fbfa;padding:12px 16px}td{padding:13px 16px;border-top:1px solid #edf3f0;font-size:14px}.name{font-weight:760}.chip{display:inline-block;padding:4px 8px;border-radius:999px;background:#e8f6ef;color:#075d41;font-size:12px;font-weight:700}.chip.off{background:#fce9e7;color:var(--danger)}.link{color:#087a52;background:none;border:0;padding:0;font-weight:750;cursor:pointer}.detail{margin-top:18px;padding:20px}.detail h2{margin:0 0 4px}.detail h3{margin:22px 0 9px;font-size:15px}.detail-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.info{border:1px solid #e3eee9;border-radius:10px;padding:12px;background:#fbfdfc}.info b{display:block;margin-top:4px;overflow-wrap:anywhere}.list{margin:0;padding-left:19px;color:#34594d}.list li{margin:5px 0}.notice{padding:12px;border-radius:9px;background:#f6fbf8;color:#315b4d;border:1px solid #dcece5}.modal{position:fixed;inset:0;background:#061710aa;z-index:10;display:grid;place-items:center;padding:16px}.modal-box{width:min(520px,100%);background:#fff;border-radius:16px;padding:22px;box-shadow:0 24px 80px #0008}.modal-box h2{margin:0 0 7px}.modal-box p{color:var(--muted);line-height:1.5}.modal-box input,.modal-box select{width:100%;padding:11px;border:1px solid #bfd5cc;border-radius:8px;margin:7px 0 14px;background:#fff}.modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}.secondary{border:1px solid #bfd5cc;background:#fff;color:#315b4d;border-radius:8px;padding:10px 13px;font-weight:700;cursor:pointer}.hidden{display:none}@media(max-width:800px){.bar{padding:13px 14px}.sub{display:none}.who{display:none}.wrap{margin:20px auto;padding:0 14px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.detail-grid{grid-template-columns:1fr}.intro h1{font-size:25px}.directory-top{align-items:stretch}.filters{width:100%}.filters input{width:100%}}@media(max-width:420px){.grid{grid-template-columns:1fr}.value{font-size:24px}}
</style></head><body>
<header class="bar"><div><span class="brand">Maqtomate</span><span class="sub">Secure Control Center</span></div><div><span class="who" id="who">${safeName}</span><button class="out" onclick="logout()">Sign out</button></div></header>
<main class="wrap"><div id="loading" class="notice ${loadingClass}">Loading your secure dashboard…</div>
<section id="owner-app" class="${ownerClass}"><nav class="tabs" aria-label="Owner dashboard sections"><button class="tab active" data-panel="overview" onclick="showPanel('overview')">Overview</button><button class="tab" data-panel="customers" onclick="showPanel('customers')">Customers</button><button class="tab" data-panel="payments" onclick="showPanel('payments')">Payment reviews</button><button class="tab" data-panel="security" onclick="showPanel('security')">Security</button></nav>
<section id="overview" class="panel active"><div class="intro"><h1>Owner control center</h1><p>Fleet-wide values are visible only to approved platform roles. Customer credentials are never displayed here.</p></div><div class="notice" id="interactive-status">Live overview rendered securely by the server. Interactive controls load when browser scripts are available.</div><div class="grid"><div class="card"><div class="label">Active customers</div><div class="value" id="tenants">${metric(overview.active_tenants)}</div></div><div class="card"><div class="label">Platform & dashboard users</div><div class="value" id="users">${metric(overview.active_users)}</div></div><div class="card"><div class="label">Monthly recurring revenue</div><div class="value" id="mrr">Rs ${metric(overview.monthly_recurring_revenue)}</div></div><div class="card"><div class="label">Errors — 7 days</div><div class="value" id="ownererrors">${metric(overview.errors_last_7_days)}</div></div><div class="card"><div class="label">Voice notes — 7 days</div><div class="value" id="ownervoice">${metric(overview.voice_notes_last_7_days)}</div></div><div class="card"><div class="label">Follow-ups — 7 days</div><div class="value" id="ownerfollowups">${metric(overview.follow_ups_created_last_7_days)}</div></div><div class="card"><div class="label">Qualified leads — 7 days</div><div class="value" id="ownerleads">${metric(overview.qualified_leads_last_7_days)}</div></div><div class="card"><div class="label">Enabled workflows</div><div class="value" id="ownerworkflows">${metric(overview.enabled_workflows)}</div></div><div class="card"><div class="label">Workflow failures — 7 days</div><div class="value" id="ownerworkflowfailures">${metric(overview.failed_workflow_executions_last_7_days)}</div></div><div class="card"><div class="label">AI requests — current period</div><div class="value" id="ownerairequests">${metric(overview.ai_requests_current_period)}</div></div></div></section>
<section id="customers" class="panel"><div class="intro"><h1>Customer directory</h1><p>Search every business, review plan and activity, then open a secure detail view. Raw WhatsApp and AI keys remain encrypted and hidden.</p></div><div class="directory"><div class="directory-top"><div class="directory-title">All customers <span id="customer-count" class="label"></span></div><div class="filters"><input id="customer-search" placeholder="Search business, niche, country" oninput="debouncedLoad()"><select id="customer-status" onchange="loadCustomers()"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select><select id="customer-mode" onchange="loadCustomers()"><option value="all">All plans</option><option value="1">DIY</option><option value="2">Smart Pro</option><option value="3">VIP Managed</option></select><button class="primary" onclick="loadCustomers()">Search</button><button class="secondary" onclick="openInvite()">Invite customer</button></div></div><div class="table-wrap"><table><thead><tr><th>Customer</th><th>Plan</th><th>Revenue</th><th>Team</th><th>Last activity</th><th>Health</th><th></th></tr></thead><tbody id="customer-rows"><tr><td colspan="7" class="label">Loading customers…</td></tr></tbody></table></div></div><section id="tenant-detail" class="detail hidden" aria-live="polite"></section></section>
<section id="payments" class="panel"><div class="intro"><h1>Payment review queue</h1><p>Only the Primary Owner can approve a payment. Approval activates the exact customer tenant and creates one one-time dashboard link.</p></div><div class="directory"><div class="directory-top"><div class="directory-title">Pending payment verification <span id="payment-count" class="label"></span></div><div class="filters"><select id="payment-status" onchange="loadPayments()"><option value="pending_review">Pending review</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="all">All payment records</option></select><button class="primary" onclick="loadPayments()">Refresh</button></div></div><div class="table-wrap"><table><thead><tr><th>Customer</th><th>Dashboard email</th><th>Reference</th><th>Expected</th><th>Status</th><th>Submitted</th><th></th></tr></thead><tbody id="payment-rows"><tr><td colspan="7" class="label">Open Payment reviews to load the queue.</td></tr></tbody></table></div></div><section id="payment-result" class="detail hidden" aria-live="polite"></section></section>
<div id="invite-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="invite-title"><div class="modal-box"><h2 id="invite-title">Invite a customer to their dashboard</h2><p>They will receive a one-time, expiring sign-in link and will see only their own business. Their password is never stored.</p><label class="label" for="invite-tenant">Customer business</label><select id="invite-tenant"></select><label class="label" for="invite-email">Customer email</label><input id="invite-email" type="email" autocomplete="email" placeholder="owner@customer-business.com"><label class="label" for="invite-role">Dashboard role</label><select id="invite-role"><option value="customer_admin">Customer Admin — can manage business settings and team</option><option value="customer_member">Customer Member — view permitted business data</option></select><div id="invite-note" class="label"></div><div class="modal-actions"><button class="secondary" onclick="closeInvite()">Cancel</button><button id="invite-send" class="primary" onclick="sendInvite()">Send secure invitation</button></div></div></div>
<section id="security" class="panel"><div class="intro"><h1>Security and audit</h1><p>Owner access, customer-directory views, customer invitations, and settings changes are audited. Support access should always be time-limited and reason-required.</p></div><div class="notice"><strong>Current protection:</strong> passwordless sign-in, secure HTTP-only sessions, role-based APIs, server-enforced tenant isolation, request IDs, rate limits, and encrypted-server-side credentials. Customer keys are never sent to this dashboard.</div></section>
</section>
<section id="customer-app" class="hidden"><div class="intro"><h1>Your business dashboard</h1><p id="business" class="label"></p></div><nav class="tabs" aria-label="Customer dashboard sections"><button class="tab active" data-customer-panel="customer-overview" onclick="showCustomerPanel('customer-overview')">Overview</button><button class="tab" data-customer-panel="customer-voice" onclick="showCustomerPanel('customer-voice')">Voice notes</button><button class="tab" data-customer-panel="customer-followups" onclick="showCustomerPanel('customer-followups')">Follow-ups</button><button class="tab" data-customer-panel="customer-leads" onclick="showCustomerPanel('customer-leads')">Lead data</button><button class="tab" data-customer-panel="customer-plan" onclick="showCustomerPanel('customer-plan')">Plan & usage</button><button class="tab" data-customer-panel="customer-automations" onclick="showCustomerPanel('customer-automations')">Automations</button><button class="secondary" onclick="downloadExcelReport()">Download Excel report</button></nav><section id="customer-overview" class="panel active"><div class="grid"><div class="card"><div class="label">Inbound today</div><div class="value" id="inbound">0</div></div><div class="card"><div class="label">Outbound today</div><div class="value" id="outbound">0</div></div><div class="card"><div class="label">Voice notes today</div><div class="value" id="voice-notes-today">0</div></div><div class="card"><div class="label">Follow-ups created today</div><div class="value" id="followups-today">0</div></div><div class="card"><div class="label">Qualified leads today</div><div class="value" id="leads-today">0</div></div><div class="card"><div class="label">Handoffs today</div><div class="value" id="handoffs">0</div></div><div class="card"><div class="label">Errors today</div><div class="value" id="errors">0</div></div><div class="card"><div class="label">Current plan</div><div class="value" id="plan-name">—</div></div></div><div class="notice" style="margin-top:16px">Voice processing is currently paused by platform policy. Voice data structures remain secure and ready for future owner-approved activation. Lead records, follow-up tasks, and reports are isolated to this business.</div></section><section id="customer-voice" class="panel"><div class="directory"><div class="directory-top"><div><div class="directory-title">WhatsApp voice notes</div><div class="label">Transcripts and AI responses for this business only.</div></div><button class="secondary" onclick="loadVoiceNotes()">Refresh</button></div><div class="table-wrap"><table><thead><tr><th>Received</th><th>Contact</th><th>Status</th><th>Transcript</th><th>AI response</th></tr></thead><tbody id="voice-note-rows"><tr><td colspan="5" class="label">Open Voice notes to load secure records.</td></tr></tbody></table></div></div></section><section id="customer-followups" class="panel"><div class="directory"><div class="directory-top"><div><div class="directory-title">WhatsApp follow-up tasks</div><div class="label">Review and complete lead actions created from your authorized WhatsApp conversations.</div></div><button class="secondary" onclick="loadFollowUps()">Refresh</button></div><div class="table-wrap"><table><thead><tr><th>Created</th><th>Contact</th><th>Task</th><th>Priority</th><th>Status</th><th>Due</th><th></th></tr></thead><tbody id="follow-up-rows"><tr><td colspan="7" class="label">Open Follow-ups to load your private task records.</td></tr></tbody></table></div></div></section><section id="customer-leads" class="panel"><div class="directory"><div class="directory-top"><div><div class="directory-title">Lead data</div><div class="label">Structured follow-up information extracted from your approved interactions.</div></div><button class="secondary" onclick="loadLeads()">Refresh</button></div><div class="table-wrap"><table><thead><tr><th>Created</th><th>Contact</th><th>Status</th><th>Score</th><th>Source</th><th>Summary</th></tr></thead><tbody id="lead-rows"><tr><td colspan="6" class="label">Open Lead data to load secure records.</td></tr></tbody></table></div></div></section><section id="customer-plan" class="panel"><div class="directory"><div class="directory-top"><div><div class="directory-title">Plan and usage</div><div class="label">Usage is tenant-scoped. Limits are enforced before automation runs.</div></div><button class="secondary" onclick="loadCustomerUsage()">Refresh</button></div><div id="usage-summary" class="detail"><div class="notice">Open Plan & usage to load your current policy and usage.</div></div></div></section><section id="customer-automations" class="panel"><div class="directory"><div class="directory-top"><div><div class="directory-title">Automation status</div><div class="label">Only owner-approved and plan-entitled workflows can run.</div></div><button class="secondary" onclick="loadCustomerAutomations()">Refresh</button></div><div id="automation-summary" class="detail"><div class="notice">Open Automations to load the tenant workflow status.</div></div></div></section></section>
</main>
<script>
let timer,inviteTenants=[];function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]))}async function api(url){const r=await fetch(url),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed');return d}async function post(url,payload){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed');return d}function mode(v){return ({1:'DIY',2:'Smart Pro',3:'VIP Managed'})[v]||'Standard'}function stamp(v){return v?new Date(v.replace(' ','T')+'Z').toLocaleString():'No activity'}function showPanel(id){document.querySelectorAll('.panel').forEach(e=>e.classList.toggle('active',e.id===id));document.querySelectorAll('.tab').forEach(e=>e.classList.toggle('active',e.dataset.panel===id));if(id==='customers')loadCustomers();if(id==='payments')loadPayments()}function debouncedLoad(){clearTimeout(timer);timer=setTimeout(loadCustomers,250)}async function loadCustomers(){const body=document.querySelector('#customer-rows');body.innerHTML='<tr><td colspan="7" class="label">Loading customers…</td></tr>';const q=encodeURIComponent(document.querySelector('#customer-search').value);const s=document.querySelector('#customer-status').value,m=document.querySelector('#customer-mode').value;try{const d=await api('/api/owner/tenants?limit=100&search='+q+'&status='+s+'&mode='+m);document.querySelector('#customer-count').textContent='('+d.tenants.length+' shown)';body.innerHTML=d.tenants.length?d.tenants.map(t=>'<tr><td><div class="name">'+esc(t.business_name)+'</div><div class="label">'+esc(t.niche)+' · '+esc(t.country)+'</div></td><td>'+esc(mode(t.client_mode))+'</td><td>Rs '+Number(t.monthly_fee||0).toLocaleString()+'</td><td>'+Number(t.team_members||0)+' member(s)</td><td>'+esc(stamp(t.last_message_at))+'</td><td><span class="chip '+(t.active?'':'off')+'">'+(t.active?'Active':'Inactive')+'</span>'+(Number(t.errors_last_7_days||0)?'<div class="label">'+Number(t.errors_last_7_days)+' error(s)</div>':'')+'</td><td><button class="link" onclick="viewCustomer('+Number(t.id)+')">View</button></td></tr>').join(''):'<tr><td colspan="7" class="label">No customers match these filters.</td></tr>'}catch(e){body.innerHTML='<tr><td colspan="7">Unable to load customers.</td></tr>'}}async function loadPayments(){const body=document.querySelector('#payment-rows'),status=document.querySelector('#payment-status').value;body.innerHTML='<tr><td colspan="7" class="label">Loading payment reviews…</td></tr>';try{const d=await api('/api/owner/payments?status='+encodeURIComponent(status));document.querySelector('#payment-count').textContent='('+d.payments.length+' shown)';body.innerHTML=d.payments.length?d.payments.map(p=>'<tr><td><div class="name">'+esc(p.business_name)+'</div><div class="label">'+esc(mode(p.client_mode))+'</div></td><td>'+esc(p.dashboard_email)+'</td><td>'+esc(p.payment_reference||'Not provided')+'</td><td>'+esc(p.currency)+' '+Number(p.expected_amount||0).toLocaleString()+'</td><td><span class="chip '+(p.status==='approved'?'':p.status==='pending_review'?'':'off')+'">'+esc(p.status.replace('_',' '))+'</span></td><td>'+esc(stamp(p.submitted_at))+'</td><td>'+((p.status==='pending_review')?'<button class="primary" onclick="reviewPayment('+Number(p.id)+',\'approve\')">Approve & issue link</button> <button class="secondary" onclick="reviewPayment('+Number(p.id)+',\'reject\')">Reject</button>':'')+'</td></tr>').join(''):'<tr><td colspan="7" class="label">No payment records match this filter.</td></tr>'}catch(e){body.innerHTML='<tr><td colspan="7">Unable to load payment requests.</td></tr>'}}async function reviewPayment(id,decision){const label=decision==='approve'?'approve this verified payment, activate the tenant, and create its one-time dashboard link':'reject this payment request';if(!confirm('Are you sure you want to '+label+'?'))return;const note=prompt(decision==='approve'?'Optional approval note:':'Reason for rejection (optional):')||'';const result=document.querySelector('#payment-result');result.classList.remove('hidden');result.innerHTML='<div class="notice">Processing payment review securely…</div>';try{const d=await post('/api/owner/payments/'+Number(id)+'/'+decision,{note});if(d.activation_url){result.innerHTML='<h2>Payment approved</h2><p class="label">Send this one-time dashboard activation link only to '+esc(d.customer_email)+'. It expires in '+Number(d.expires_in_hours||72)+' hours.</p><input id="payment-activation-link" readonly value="'+esc(d.activation_url)+'"><button class="secondary" onclick="copyPaymentActivationLink()">Copy activation link</button>'}else{result.innerHTML='<div class="notice">Payment request '+esc(d.status)+'.</div>'}loadPayments()}catch(e){result.innerHTML='<div class="notice">'+esc(e.message)+'</div>'}}async function copyPaymentActivationLink(){const field=document.querySelector('#payment-activation-link');if(!field)return;try{await navigator.clipboard.writeText(field.value)}catch(e){field.select();document.execCommand('copy')}}async function openInvite(){const modal=document.querySelector('#invite-modal'),sel=document.querySelector('#invite-tenant'),note=document.querySelector('#invite-note');note.textContent='Loading active customers…';modal.classList.remove('hidden');try{const d=await api('/api/owner/tenants?limit=100&status=active');inviteTenants=d.tenants;sel.innerHTML=d.tenants.length?d.tenants.map(t=>'<option value="'+Number(t.id)+'">'+esc(t.business_name)+' · '+esc(mode(t.client_mode))+'</option>').join(''):'<option value="">No active customers yet</option>';note.textContent=d.tenants.length?'Secure invitation links expire in 72 hours.':'Create or onboard a customer business first.'}catch(e){note.textContent='Unable to load customers.'}}function closeInvite(){document.querySelector('#invite-modal').classList.add('hidden');document.querySelector('#invite-email').value='';document.querySelector('#invite-note').textContent=''}async function copyActivationLink(){const field=document.querySelector('#manual-activation-link');if(!field)return;try{await navigator.clipboard.writeText(field.value);document.querySelector('#invite-note').insertAdjacentHTML('beforeend','<div class="label">Activation link copied. Send it only to the approved customer.</div>')}catch(e){field.select();document.execCommand('copy')}}async function sendInvite(){const tenant=Number(document.querySelector('#invite-tenant').value),email=document.querySelector('#invite-email').value,role=document.querySelector('#invite-role').value,note=document.querySelector('#invite-note'),send=document.querySelector('#invite-send');if(!tenant||!email){note.textContent='Choose a customer and enter a valid email.';return}send.disabled=true;note.textContent='Sending secure invitation…';try{const result=await post('/api/owner/invitations',{client_id:tenant,email,role});if(result.delivery==='manual'&&result.activation_url){note.innerHTML='No sending domain is configured yet. Copy this one-time activation link and send it privately to the customer via WhatsApp. It expires in '+Number(result.expires_in_hours||72)+' hours:<input id="manual-activation-link" readonly value="'+esc(result.activation_url)+'"><button class="secondary" type="button" onclick="copyActivationLink()">Copy activation link</button>'}else{note.textContent='Secure invitation email sent successfully.';setTimeout(closeInvite,900)}loadCustomers()}catch(e){note.textContent=e.message}finally{send.disabled=false}}async function viewCustomer(id){const box=document.querySelector('#tenant-detail');box.classList.remove('hidden');box.innerHTML='<div class="notice">Loading secure customer details…</div>';try{const d=await api('/api/owner/tenants/'+id),t=d.tenant,ms=d.metrics_30d||{},vs=d.voice_metrics_30d||{};const team=d.team.length?'<ul class="list">'+d.team.map(x=>'<li><strong>'+esc(x.display_name||x.email)+'</strong> · '+esc(x.role)+' · '+esc(x.membership_status)+'<br><span class="label">Last login: '+esc(stamp(x.last_login_at))+'</span></li>').join('')+'</ul>':'<p class="label">No customer team members have been invited yet.</p>';const events=d.recent_events.length?'<ul class="list">'+d.recent_events.map(x=>'<li>'+esc(x.action)+' · '+esc(stamp(x.created_at))+'</li>').join('')+'</ul>':'<p class="label">No recent dashboard events.</p>';box.innerHTML='<h2>'+esc(t.business_name)+'</h2><p class="label">Customer #'+t.id+' · '+esc(t.niche)+' · '+esc(t.country)+' · '+(t.active?'Active':'Inactive')+'</p><div class="detail-grid"><div class="info"><span class="label">Plan</span><b>'+esc(mode(t.client_mode))+'</b></div><div class="info"><span class="label">Monthly fee</span><b>Rs '+Number(t.monthly_fee||0).toLocaleString()+'</b></div><div class="info"><span class="label">AI assistant</span><b>'+esc(t.ai_name||'Not configured')+'</b></div><div class="info"><span class="label">Business hours</span><b>'+esc(t.working_hours||'Not provided')+'</b></div></div><h3>30-day performance</h3><div class="detail-grid"><div class="info"><span class="label">Inbound messages</span><b>'+Number(ms.inbound_30d||0).toLocaleString()+'</b></div><div class="info"><span class="label">Outbound messages</span><b>'+Number(ms.outbound_30d||0).toLocaleString()+'</b></div><div class="info"><span class="label">Handoffs / errors</span><b>'+Number(ms.handoffs_30d||0)+' / '+Number(ms.errors_30d||0)+'</b></div><div class="info"><span class="label">Voice notes / follow-ups</span><b>'+Number(vs.voice_notes_30d||0)+' / '+Number(vs.follow_ups_created_30d||0)+'</b></div><div class="info"><span class="label">Qualified leads</span><b>'+Number(vs.qualified_leads_30d||0)+'</b></div></div><h3>Customer team</h3>'+team+'<h3>Recent tenant activity</h3>'+events+'<h3>Business setup</h3><div class="detail-grid"><div class="info"><span class="label">Services</span><b>'+esc(t.services||'Not provided')+'</b></div><div class="info"><span class="label">Pricing</span><b>'+esc(t.pricing||'Not provided')+'</b></div><div class="info"><span class="label">Handoff triggers</span><b>'+esc(t.handoff_triggers||'Not provided')+'</b></div></div><p class="label" style="margin-top:18px">Sensitive WhatsApp, verification, and AI credentials remain encrypted and are intentionally not available in this control center.</p>'}catch(e){box.innerHTML='<div class="notice">Unable to load customer details.</div>'}}function shortText(v,n){const s=String(v||'').trim();return esc(s.length>n?s.slice(0,n-1)+'…':s||'—')}function showCustomerPanel(id){document.querySelectorAll('#customer-app .panel').forEach(e=>e.classList.toggle('active',e.id===id));document.querySelectorAll('[data-customer-panel]').forEach(e=>e.classList.toggle('active',e.dataset.customerPanel===id));if(id==='customer-voice')loadVoiceNotes();if(id==='customer-followups')loadFollowUps();if(id==='customer-leads')loadLeads();if(id==='customer-plan')loadCustomerUsage();if(id==='customer-automations')loadCustomerAutomations()}async function loadVoiceNotes(){const body=document.querySelector('#voice-note-rows');body.innerHTML='<tr><td colspan="5" class="label">Loading voice notes…</td></tr>';try{const d=await api('/api/customer/voice-notes?limit=50');body.innerHTML=d.voice_notes.length?d.voice_notes.map(v=>'<tr><td>'+esc(stamp(v.received_at))+'</td><td>'+esc(v.contact_phone_e164)+'</td><td><span class="chip '+(v.transcription_status==='completed'?'':v.transcription_status==='failed'?'off':'')+'">'+esc(v.transcription_status)+'</span></td><td>'+shortText(v.transcript,220)+'</td><td>'+shortText(v.ai_response,220)+'</td></tr>').join(''):'<tr><td colspan="5" class="label">No voice notes have been processed yet.</td></tr>'}catch(e){body.innerHTML='<tr><td colspan="5">Unable to load voice notes.</td></tr>'}}async function updateFollowUp(id,status){try{await post('/api/customer/follow-ups/'+Number(id),{task_status:status});loadFollowUps()}catch(e){alert(e.message||'Unable to update follow-up task.')}}async function loadFollowUps(){const body=document.querySelector('#follow-up-rows');body.innerHTML='<tr><td colspan="7" class="label">Loading follow-up tasks…</td></tr>';try{const d=await api('/api/customer/follow-ups?limit=50');body.innerHTML=d.follow_ups.length?d.follow_ups.map(f=>'<tr><td>'+esc(stamp(f.created_at))+'</td><td><div class="name">'+esc(f.contact_name||f.contact_phone_e164||'Unknown contact')+'</div><div class="label">'+esc(f.contact_phone_e164||'—')+'</div></td><td><div class="name">'+shortText(f.title,110)+'</div><div class="label">'+shortText(f.details,160)+'</div></td><td><span class="chip '+(f.priority==='urgent'||f.priority==='high'?'off':'')+'">'+esc(f.priority)+'</span></td><td><span class="chip '+(f.task_status==='completed'||f.task_status==='dismissed'?'off':'')+'">'+esc(f.task_status)+'</span></td><td>'+esc(stamp(f.due_at))+'</td><td>'+((f.task_status==='open'||f.task_status==='in_progress')?'<button class="secondary" onclick="updateFollowUp('+Number(f.id)+',\'completed\')">Complete</button>':'')+'</td></tr>').join(''):'<tr><td colspan="7" class="label">No follow-up tasks have been created yet.</td></tr>'}catch(e){body.innerHTML='<tr><td colspan="7">Unable to load follow-up tasks.</td></tr>'}}async function loadLeads(){const body=document.querySelector('#lead-rows');body.innerHTML='<tr><td colspan="6" class="label">Loading lead data…</td></tr>';try{const d=await api('/api/customer/leads?limit=50');body.innerHTML=d.leads.length?d.leads.map(l=>'<tr><td>'+esc(stamp(l.created_at))+'</td><td><div class="name">'+esc(l.contact_name||l.contact_phone_e164||'Unknown contact')+'</div><div class="label">'+esc(l.contact_phone_e164||l.contact_email||'—')+'</div></td><td><span class="chip">'+esc(l.lead_status)+'</span></td><td>'+esc(l.interest_score==null?'—':l.interest_score)+'</td><td>'+esc(l.source_type)+'</td><td>'+shortText(l.summary,220)+'</td></tr>').join(''):'<tr><td colspan="6" class="label">No lead data has been extracted yet.</td></tr>'}catch(e){body.innerHTML='<tr><td colspan="6">Unable to load lead data.</td></tr>'}}async function loadCustomerUsage(){const box=document.querySelector('#usage-summary');box.innerHTML='<div class="notice">Loading plan and usage…</div>';try{const d=await api('/api/customer/usage');const rows=d.usage.length?d.usage.map(x=>'<tr><td>'+esc(x.metric_key)+'</td><td>'+Number(x.quantity||0).toLocaleString()+'</td><td>'+esc(x.limit==null?'Unlimited':Number(x.limit).toLocaleString())+'</td><td>'+esc(x.warning_80_sent_at?'Warning sent':'Within policy')+'</td></tr>').join(''):'<tr><td colspan="4" class="label">No tracked usage this period.</td></tr>';box.innerHTML='<h2>'+esc(d.plan.label)+'</h2><p class="label">Your permitted features and limits are applied securely on the server before automation runs.</p><div class="detail-grid"><div class="info"><span class="label">Message limit</span><b>'+esc(d.plan.limits.monthly_messages==null?'Unlimited':d.plan.limits.monthly_messages)+'</b></div><div class="info"><span class="label">AI request limit</span><b>'+esc(d.plan.limits.monthly_ai_requests==null?'Unlimited':d.plan.limits.monthly_ai_requests)+'</b></div><div class="info"><span class="label">Team limit</span><b>'+esc(d.plan.limits.team_members==null?'Unlimited':d.plan.limits.team_members)+'</b></div></div><div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>Metric</th><th>Used</th><th>Limit</th><th>Status</th></tr></thead><tbody>'+rows+'</tbody></table></div>'}catch(e){box.innerHTML='<div class="notice">Unable to load plan and usage.</div>'}}async function loadCustomerAutomations(){const box=document.querySelector('#automation-summary');box.innerHTML='<div class="notice">Loading automation status…</div>';try{const d=await api('/api/customer/automations');if(!d.enabled){box.innerHTML='<div class="notice">Automations are not enabled for this plan or are paused by platform policy.</div>';return}const workflows=d.workflows.length?d.workflows.map(w=>'<li><strong>'+esc(w.display_name)+'</strong> · '+esc(w.trigger_event)+' · '+(w.enabled?'Enabled':'Disabled')+'</li>').join(''):'<li>No tenant workflows are configured yet.</li>';const executions=d.executions.length?d.executions.map(e=>'<li>'+esc(e.event_key)+' · '+esc(e.status)+' · '+esc(stamp(e.started_at))+'</li>').join(''):'<li>No workflow activity yet.</li>';box.innerHTML='<h2>Automation status</h2><h3>Configured workflows</h3><ul class="list">'+workflows+'</ul><h3>Recent activity</h3><ul class="list">'+executions+'</ul>'}catch(e){box.innerHTML='<div class="notice">Unable to load automation status.</div>'}}async function downloadExcelReport(){try{const r=await fetch('/api/customer/export');if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error||'Report download failed')}const b=await r.blob(),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download='maqtomate-report.xlsx';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(u)}catch(e){alert(e.message||'Unable to download report.')}}async function logout(){await fetch('/auth/logout',{method:'POST'});location.href='/'}async function init(){try{const me=await api('/api/me');document.querySelector('#who').textContent=me.user.display_name||me.user.email;if(me.platform_role){document.querySelector('#owner-app').classList.remove('hidden');const d=await api('/api/owner/overview');document.querySelector('#tenants').textContent=d.active_tenants;document.querySelector('#users').textContent=d.active_users;document.querySelector('#mrr').textContent='Rs '+Number(d.monthly_recurring_revenue).toLocaleString();document.querySelector('#ownererrors').textContent=d.errors_last_7_days;document.querySelector('#ownervoice').textContent=d.voice_notes_last_7_days;document.querySelector('#ownerfollowups').textContent=d.follow_ups_created_last_7_days;document.querySelector('#ownerleads').textContent=d.qualified_leads_last_7_days;document.querySelector('#ownerworkflows').textContent=d.enabled_workflows;document.querySelector('#ownerworkflowfailures').textContent=d.failed_workflow_executions_last_7_days;document.querySelector('#ownerairequests').textContent=d.ai_requests_current_period}if(me.memberships.length){document.querySelector('#customer-app').classList.remove('hidden');const d=await api('/api/customer/overview');document.querySelector('#business').textContent=d.tenant.business_name+' · '+d.membership_role;document.querySelector('#inbound').textContent=d.today.inbound_messages;document.querySelector('#outbound').textContent=d.today.outbound_messages;document.querySelector('#voice-notes-today').textContent=d.voice_today.voice_notes_received;document.querySelector('#followups-today').textContent=d.voice_today.follow_ups_created;document.querySelector('#leads-today').textContent=d.voice_today.qualified_leads;document.querySelector('#handoffs').textContent=d.today.handoffs;document.querySelector('#errors').textContent=d.today.errors;document.querySelector('#plan-name').textContent=(d.plan&&d.plan.label)||'—'}document.querySelector('#loading').remove()}catch(e){location.href='/'}}init();

</script></body></html>`;
}
