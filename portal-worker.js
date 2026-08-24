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
const ACCOUNT_ACTION_TTL_MINUTES = 30;
const PASSWORD_PBKDF2_ITERATIONS = 310000;
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

      if (request.method === 'GET' && path === '/') return htmlResponse(marketingSiteHTML('/'), 200, headers);
      if (request.method === 'GET' && path === '/login') return htmlResponse(loginHTML(env), 200, headers);
      if (request.method === 'GET' && path === '/signup') return await customerSignupPage(request, env, headers);
      if (request.method === 'GET' && path === '/onboarding') return await customerOnboardingPage(request, env, headers);
      if (request.method === 'GET' && path === '/onboarding/setup') return await customerOnboardingSetupPage(request, env, headers);
      if (request.method === 'GET' && path === '/connect') return htmlResponse(connectIntakeHTML(), 200, headers);
      if (request.method === 'GET' && isMarketingPath(path)) return htmlResponse(marketingSiteHTML(path), 200, headers);
      if (request.method === 'GET' && path === '/robots.txt') return new Response('User-agent: *\nAllow: /\nDisallow: /owner\nDisallow: /dashboard\nDisallow: /api/\n', { status: 200, headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }) });
      if (request.method === 'GET' && path === '/sitemap.xml') return new Response(marketingSitemap(request, env), { status: 200, headers: new Headers({ 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }) });
      if (request.method === 'POST' && path === '/api/public/rollout-requests') return await createPublicRolloutRequest(request, env, headers, requestId);
      if (path.startsWith('/api/owner/') && !(await hasOwnerGate(request, env))) throw new AccessError('Owner password verification required.', 401);
      if (path.startsWith('/owner/') && path !== '/owner/gate' && !(await hasOwnerGate(request, env))) return redirectToOwnerGate(headers);
      if (request.method === 'GET' && path === '/owner/gate') return htmlResponse(ownerGateHTML(), 200, headers);
      if (request.method === 'POST' && path === '/owner/gate') return await completeOwnerGate(request, env, headers, requestId);
      if (request.method === 'GET' && path === '/dashboard') {
        const access = await requireSession(request, env);
        if (access.platformRole && !(await hasOwnerGate(request, env))) return redirectToOwnerGate(headers);
        const overview = access.platformRole ? await ownerOverviewData(env) : null;
        return htmlResponse(access.platformRole ? dashboardHTML(access.user, overview, access.platformRole) : customerWorkspaceHTML(access.user, access.memberships), 200, headers);
      }
      if (request.method === 'GET' && path === '/owner') return await ownerConsoleOrLogin(request, env, headers);
      if (request.method === 'POST' && path === '/owner/test-tenant/provision') return await provisionOwnerTestTenant(request, env, headers, requestId);
      if (request.method === 'POST' && path === '/owner/test-tenant/attach-maqtomate-test-sender') return await attachMaqtomateTestSender(request, env, headers, requestId);
      if (request.method === 'POST' && path === '/owner/test-tenant/validate-saved-credential') return await validateOwnerTestCredential(request, env, headers, requestId);
      if (request.method === 'POST' && path === '/owner/test-tenant/renew-meta-token') return await renewOwnerTestCredential(request, env, headers, requestId);
      if (request.method === 'POST' && path === '/owner/test-tenant/send-controlled-test') return await sendOwnerControlledTest(request, env, headers, requestId);
      if (request.method === 'GET' && path === '/auth/google') return await beginOwnerGoogleLogin(request, env, headers);
      if (request.method === 'GET' && path === '/auth/google/callback') return await completeGoogleLogin(request, env, headers, requestId);
      if (request.method === 'GET' && path === '/auth/customer/google') return await beginCustomerGoogleLogin(request, env, headers);
      if (request.method === 'GET' && path === '/auth/customer/google/callback') return await completeCustomerGoogleLogin(request, env, headers, requestId);
      if (request.method === 'GET' && path === '/auth/verify') return await verifyMagicLink(request, env, headers, requestId);
      if (request.method === 'GET' && path === '/auth/account/verify') return await verifyCustomerAccountEmail(request, env, headers, requestId);
      if (request.method === 'GET' && path === '/auth/password-reset') return await passwordResetPage(request, env, headers);
      if (request.method === 'POST' && path === '/auth/password-reset') return await completePasswordReset(request, env, headers, requestId);
      if (request.method === 'POST' && path === '/auth/register') return await registerCustomerAccount(request, env, headers, requestId);
      if (request.method === 'POST' && path === '/auth/password-login') return await passwordLogin(request, env, headers, requestId);
      if (request.method === 'POST' && path === '/auth/password-forgot') return await requestPasswordReset(request, env, headers, requestId);
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
      if (path === '/api/customer/onboarding' && request.method === 'GET') return await customerOnboardingStatus(request, env, headers);
      if (path === '/api/customer/onboarding/setup' && request.method === 'POST') return await completeCustomerOnboardingSetup(request, env, headers, requestId);
      if (path === '/api/customer/onboarding/readiness' && request.method === 'POST') return await saveCustomerActivationReadiness(request, env, headers, requestId);
      if (path === '/api/customer/onboarding/payment' && request.method === 'POST') return await submitCustomerOnboardingPayment(request, env, headers, requestId);

      if (path === '/api/owner/overview' && request.method === 'GET') return await ownerOverview(request, env, headers);
      if (path === '/api/owner/tenants' && request.method === 'GET') return await ownerTenants(request, env, headers, requestId);
      if (request.method === 'GET' && /^\/api\/owner\/tenants\/\d+$/.test(path)) return await ownerTenantDetail(request, env, headers, requestId);
      if (path === '/api/owner/invitations' && request.method === 'POST') return await createTenantInvitation(request, env, headers, requestId);
      if (path === '/api/owner/payments' && request.method === 'GET') return await ownerPaymentRequests(request, env, headers, requestId);
      if (request.method === 'POST' && /^\/api\/owner\/payments\/\d+\/(approve|reject)$/.test(path)) return await reviewPaymentRequest(request, env, headers, requestId);
      if (path === '/api/owner/customer-onboarding' && request.method === 'GET') return await ownerCustomerOnboardingRequests(request, env, headers, requestId);
      if (request.method === 'POST' && /^\/api\/owner\/customer-onboarding\/\d+\/(approve|reject|activate)$/.test(path)) return await reviewCustomerOnboardingRequest(request, env, headers, requestId);
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

function ownerGateCookie(token) {
  return `mt_owner_gate=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

function clearOwnerGateCookie() {
  return 'mt_owner_gate=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}

function oauthTransientCookie(name, value, seconds = 600) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
}

function clearOAuthTransientCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function portalBaseUrl(request, env) {
  return (env.PORTAL_URL || new URL(request.url).origin).replace(/\/$/, '');
}

function googleCallbackUrl(request, env) {
  return `${portalBaseUrl(request, env)}/auth/google/callback`;
}

function customerGoogleCallbackUrl(request, env) {
  return `${portalBaseUrl(request, env)}/auth/customer/google/callback`;
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

function bytesFromBase64Url(value) {
  const padded = String(value || '').replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(value || '').length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function validPassword(value) {
  const password = String(value || '');
  if (password.length < 7 || password.length > 256) throw new AccessError('Use a password between 7 and 256 characters.', 400);
  return password;
}

async function derivePasswordHash(password, salt = null, iterations = PASSWORD_PBKDF2_ITERATIONS) {
  const saltBytes = salt ? bytesFromBase64Url(salt) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations }, key, 256);
  return { hash: base64Url(new Uint8Array(bits)), salt: base64Url(saltBytes), iterations };
}

async function passwordMatches(password, storedHash, storedSalt, storedIterations) {
  if (!storedHash || !storedSalt || !Number.isInteger(Number(storedIterations))) return false;
  const derived = await derivePasswordHash(password, storedSalt, Number(storedIterations));
  return safeHashEquals(derived.hash, storedHash);
}

async function issueSession(userId, request, env) {
  const sessionToken = randomToken(48);
  const [sessionHash, ipHash, uaHash] = await Promise.all([
    sha256(sessionToken),
    sha256(request.headers.get('CF-Connecting-IP') || 'unknown'),
    sha256(request.headers.get('User-Agent') || 'unknown')
  ]);
  await env.MAQVORA_DB.prepare(`
    INSERT INTO user_sessions (token_hash, user_id, expires_at, ip_hash, user_agent_hash)
    VALUES (?, ?, datetime('now', '+12 hours'), ?, ?)
  `).bind(sessionHash, userId, ipHash, uaHash).run();
  return sessionToken;
}

async function createAccountAction(env, userId, purpose, minutes = ACCOUNT_ACTION_TTL_MINUTES) {
  const token = randomToken(48);
  const tokenHash = await sha256(token);
  await env.MAQVORA_DB.batch([
    env.MAQVORA_DB.prepare(`UPDATE account_action_tokens SET expires_at = datetime('now') WHERE user_id = ? AND purpose = ? AND used_at IS NULL AND expires_at > datetime('now')`).bind(userId, purpose),
    env.MAQVORA_DB.prepare(`INSERT INTO account_action_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, datetime('now', ?))`).bind(tokenHash, userId, purpose, `+${minutes} minutes`)
  ]);
  return token;
}

function customerEmailReady(env) {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
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

async function optionalSession(request, env) {
  try {
    return await requireSession(request, env);
  } catch (error) {
    if (error instanceof AccessError && error.status === 401) return null;
    throw error;
  }
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

  // A new request always supersedes any earlier unused login link for the same address.
  // This eliminates stale-link confusion on mobile without weakening the 15-minute TTL.
  await env.MAQVORA_DB.prepare(`
    UPDATE magic_link_tokens SET expires_at = datetime('now')
    WHERE email = ? AND purpose = 'login' AND used_at IS NULL AND expires_at > datetime('now')
  `).bind(email).run();

  const token = randomToken();
  const tokenHash = await sha256(token);
  await env.MAQVORA_DB.prepare(`
    INSERT INTO magic_link_tokens (token_hash, email, purpose, expires_at)
    VALUES (?, ?, 'login', datetime('now', '+15 minutes'))
  `).bind(tokenHash, email).run();

  const portalUrl = env.PORTAL_URL || new URL(request.url).origin;
  const link = `${portalUrl}/auth/verify?token=${encodeURIComponent(token)}`;
  try {
    await sendMagicLinkEmail(env, email, link);
    await auditEvent(env, {
      actorUserId: user.id,
      action: 'auth.magic_link_requested',
      requestId,
      request,
      details: { provider: 'resend', delivery_accepted: true }
    });
  } catch (error) {
    // Do not leave a valid token behind when the provider rejects or cannot accept delivery.
    // The browser receives the same generic response in order to prevent account enumeration.
    await env.MAQVORA_DB.prepare(`
      UPDATE magic_link_tokens SET expires_at = datetime('now')
      WHERE token_hash = ? AND used_at IS NULL
    `).bind(tokenHash).run().catch(() => {});
    await auditEvent(env, {
      actorUserId: user.id,
      action: 'auth.magic_link_delivery_failed',
      requestId,
      request,
      details: { provider: 'resend', delivery_accepted: false }
    }).catch(() => {});
  }
  return json({ ok: true, message: 'If this account is eligible, a secure sign-in link will be sent.' }, 200, headers);
}

function onboardingOffer(value) {
  const offer = String(value || '').trim();
  if (!['managed_launch', 'custom_rollout'].includes(offer)) throw new AccessError('Choose a valid Maqtomate offer.', 400);
  return offer;
}

function onboardingAiMode(value) {
  const mode = String(value || '').trim();
  if (!['customer_byok', 'managed_ai'].includes(mode)) throw new AccessError('Choose a valid Gemini mode.', 400);
  return mode;
}

function onboardingAmount(offer) {
  return offer === 'managed_launch' ? 5000 : 0;
}

async function sendAccountActionEmail(env, email, actionUrl, purpose) {
  const subject = purpose === 'email_verify' ? 'Verify your Maqtomate account' : 'Reset your Maqtomate password';
  const heading = purpose === 'email_verify' ? 'Verify your email' : 'Reset your password';
  const intro = purpose === 'email_verify'
    ? 'Use the secure button below to verify your Maqtomate account before payment or onboarding can begin.'
    : 'Use the secure button below to choose a new Maqtomate password.';
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px;color:#111827"><h1 style="font-size:24px">${heading}</h1><p>${intro}</p><p style="margin:28px 0"><a href="${escapeHtml(actionUrl)}" style="background:#059669;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:700">Continue securely</a></p><p style="font-size:13px;color:#6b7280">This link expires in ${ACCOUNT_ACTION_TTL_MINUTES} minutes and can be used only once. If you did not request it, you can safely ignore this email.</p></div>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [email], subject, html })
  });
  if (!response.ok) throw new Error(`Account email delivery failed with status ${response.status}.`);
}

async function registerCustomerAccount(request, env, headers, requestId) {
  assertSameOrigin(request);
  const body = await request.json().catch(() => { throw new AccessError('Invalid registration request.', 400); });
  const ipHash = await sha256(request.headers.get('CF-Connecting-IP') || 'unknown');
  if (!(await boundedRateLimit(env, `auth:register:${ipHash}`, 5, 900))) throw new AccessError('Too many registration attempts. Please wait before trying again.', 429);
  if (!customerEmailReady(env)) throw new AccessError('Customer email verification is not configured yet. Please request a managed rollout review instead.', 503);
  const email = normalizeEmail(body.email);
  const password = validPassword(body.password);
  if (password !== String(body.confirm_password || '')) throw new AccessError('Passwords do not match.', 400);
  const businessName = publicText(body.business_name, 'Business name', 2, 120);
  const country = publicText(body.country, 'Country or region', 2, 80);
  const requestedOffer = onboardingOffer(body.requested_offer);
  const requestedAiMode = onboardingAiMode(body.requested_ai_mode);
  const existing = await env.MAQVORA_DB.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').bind(email).first();
  if (existing) return json({ ok: true, message: 'If this email can be used for an account, a verification message will be sent.' }, 202, headers);
  const verifier = await derivePasswordHash(password);
  const created = await env.MAQVORA_DB.prepare(`
    INSERT INTO users (email, display_name, status, password_hash, password_salt, password_iterations, password_set_at)
    VALUES (?, ?, 'pending', ?, ?, ?, datetime('now'))
  `).bind(email, businessName, verifier.hash, verifier.salt, verifier.iterations).run();
  const userId = Number(created.meta?.last_row_id);
  try {
    await env.MAQVORA_DB.prepare(`
      INSERT INTO customer_onboarding_requests (user_id, business_name, country, requested_offer, requested_ai_mode, expected_setup_amount)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(userId, businessName, country, requestedOffer, requestedAiMode, onboardingAmount(requestedOffer)).run();
    const token = await createAccountAction(env, userId, 'email_verify');
    const verifyUrl = `${portalBaseUrl(request, env)}/auth/account/verify?token=${encodeURIComponent(token)}`;
    await sendAccountActionEmail(env, email, verifyUrl, 'email_verify');
  } catch (error) {
    await env.MAQVORA_DB.prepare('DELETE FROM users WHERE id = ? AND status = ?').bind(userId, 'pending').run().catch(() => {});
    throw new AccessError('Account verification email could not be sent. Please try again later.', 503);
  }
  await auditEvent(env, { actorUserId: userId, action: 'customer.account_registered', requestId, request, details: { requested_offer: requestedOffer, requested_ai_mode: requestedAiMode } });
  return json({ ok: true, message: 'Check your email to verify your account before payment and onboarding.' }, 201, headers);
}

async function verifyCustomerAccountEmail(request, env, headers, requestId) {
  const token = new URL(request.url).searchParams.get('token') || '';
  if (token.length < 32) throw new AccessError('This verification link is invalid or expired.', 400);
  const tokenHash = await sha256(token);
  const action = await env.MAQVORA_DB.prepare(`
    SELECT id, user_id FROM account_action_tokens
    WHERE token_hash = ? AND purpose = 'email_verify' AND used_at IS NULL AND expires_at > datetime('now')
  `).bind(tokenHash).first();
  if (!action) throw new AccessError('This verification link is invalid or expired.', 400);
  const used = await env.MAQVORA_DB.prepare('UPDATE account_action_tokens SET used_at = datetime(\'now\') WHERE id = ? AND used_at IS NULL').bind(action.id).run();
  if (!used.meta?.changes) throw new AccessError('This verification link has already been used.', 400);
  await env.MAQVORA_DB.batch([
    env.MAQVORA_DB.prepare(`UPDATE users SET status = 'active', email_verified_at = datetime('now'), last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).bind(action.user_id),
    env.MAQVORA_DB.prepare(`UPDATE customer_onboarding_requests SET status = 'payment_pending', updated_at = datetime('now') WHERE user_id = ? AND status = 'email_verification_required'`).bind(action.user_id)
  ]);
  const sessionToken = await issueSession(action.user_id, request, env);
  await auditEvent(env, { actorUserId: action.user_id, action: 'customer.email_verified', requestId, request });
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Location', '/onboarding');
  responseHeaders.append('Set-Cookie', sessionCookie(sessionToken));
  return new Response(null, { status: 303, headers: responseHeaders });
}

async function passwordLogin(request, env, headers, requestId) {
  assertSameOrigin(request);
  const body = await request.json().catch(() => ({}));
  const ipHash = await sha256(request.headers.get('CF-Connecting-IP') || 'unknown');
  if (!(await boundedRateLimit(env, `auth:password:${ipHash}`, 8, 900))) throw new AccessError('Too many sign-in attempts. Please wait before trying again.', 429);
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const user = await env.MAQVORA_DB.prepare(`SELECT id, status, password_hash, password_salt, password_iterations FROM users WHERE email = ? COLLATE NOCASE`).bind(email).first();
  if (!user || user.status !== 'active' || !(await passwordMatches(password, user.password_hash, user.password_salt, user.password_iterations))) {
    await auditEvent(env, { action: 'customer.password_login_denied', requestId, request, details: { reason: 'invalid_credentials' } }).catch(() => {});
    throw new AccessError('Email or password was not accepted.', 401);
  }
  const sessionToken = await issueSession(user.id, request, env);
  await env.MAQVORA_DB.prepare(`UPDATE users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).bind(user.id).run();
  await auditEvent(env, { actorUserId: user.id, action: 'customer.password_login', requestId, request });
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Set-Cookie', sessionCookie(sessionToken));
  return json({ ok: true, redirect: '/dashboard' }, 200, responseHeaders);
}

async function requestPasswordReset(request, env, headers, requestId) {
  assertSameOrigin(request);
  const body = await request.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const ipHash = await sha256(request.headers.get('CF-Connecting-IP') || 'unknown');
  if (!(await boundedRateLimit(env, `auth:password-reset:${ipHash}`, 5, 900))) throw new AccessError('Too many requests. Please wait before trying again.', 429);
  const user = await env.MAQVORA_DB.prepare(`SELECT id FROM users WHERE email = ? COLLATE NOCASE AND status = 'active'`).bind(email).first();
  if (user && customerEmailReady(env)) {
    try {
      const token = await createAccountAction(env, user.id, 'password_reset');
      await sendAccountActionEmail(env, email, `${portalBaseUrl(request, env)}/auth/password-reset?token=${encodeURIComponent(token)}`, 'password_reset');
      await auditEvent(env, { actorUserId: user.id, action: 'customer.password_reset_requested', requestId, request });
    } catch (_) {
      await auditEvent(env, { actorUserId: user.id, action: 'customer.password_reset_delivery_failed', requestId, request }).catch(() => {});
    }
  }
  return json({ ok: true, message: 'If this account is eligible, password reset instructions will be sent.' }, 200, headers);
}

async function passwordResetPage(request, env, headers) {
  const token = new URL(request.url).searchParams.get('token') || '';
  if (token.length < 32) throw new AccessError('This password reset link is invalid or expired.', 400);
  return htmlResponse(passwordResetHTML(token), 200, headers);
}

async function completePasswordReset(request, env, headers, requestId) {
  assertSameOrigin(request);
  const body = await request.json().catch(() => { throw new AccessError('Invalid password reset request.', 400); });
  const token = String(body.token || '');
  const password = validPassword(body.password);
  if (password !== String(body.confirm_password || '')) throw new AccessError('Passwords do not match.', 400);
  const action = await env.MAQVORA_DB.prepare(`
    SELECT id, user_id FROM account_action_tokens WHERE token_hash = ? AND purpose = 'password_reset' AND used_at IS NULL AND expires_at > datetime('now')
  `).bind(await sha256(token)).first();
  if (!action) throw new AccessError('This password reset link is invalid or expired.', 400);
  const verifier = await derivePasswordHash(password);
  const changed = await env.MAQVORA_DB.prepare(`UPDATE account_action_tokens SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL`).bind(action.id).run();
  if (!changed.meta?.changes) throw new AccessError('This password reset link has already been used.', 400);
  await env.MAQVORA_DB.batch([
    env.MAQVORA_DB.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, password_set_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).bind(verifier.hash, verifier.salt, verifier.iterations, action.user_id),
    env.MAQVORA_DB.prepare(`UPDATE user_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`).bind(action.user_id)
  ]);
  await auditEvent(env, { actorUserId: action.user_id, action: 'customer.password_reset_completed', requestId, request });
  return json({ ok: true, message: 'Password updated. You can now sign in.' }, 200, headers);
}

function publicText(value, field, min, max) {
  const text = String(value || '').trim();
  if (text.length < min || text.length > max) throw new AccessError(`${field} must be between ${min} and ${max} characters.`, 400);
  return text;
}

function publicOptionalUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.length > 2048) throw new AccessError('Website URL is too long.', 400);
  let url;
  try { url = new URL(raw); } catch { throw new AccessError('Enter a valid website URL.', 400); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new AccessError('Website URL must use http or https.', 400);
  return url.toString();
}

async function createPublicRolloutRequest(request, env, headers, requestId) {
  assertSameOrigin(request);
  const ipHash = await sha256(request.headers.get('CF-Connecting-IP') || 'unknown');
  const allowed = await boundedRateLimit(env, `public-rollout:${ipHash}`, 3, 3600);
  if (!allowed) throw new AccessError('Please wait before submitting another rollout request.', 429);
  const body = await request.json().catch(() => { throw new AccessError('Invalid request.', 400); });
  const useCase = String(body.use_case || '').trim();
  const monthlyBand = String(body.monthly_message_band || '').trim();
  const allowedUseCases = new Set(['sales', 'support', 'appointments', 'ecommerce', 'education', 'real_estate', 'other']);
  const allowedBands = new Set(['under_500', '500_2000', '2000_10000', '10000_plus', 'unsure']);
  if (!allowedUseCases.has(useCase) || !allowedBands.has(monthlyBand)) throw new AccessError('Choose a valid rollout profile.', 400);
  if (body.consent !== true) throw new AccessError('Consent is required to request a rollout plan.', 400);
  const businessName = publicText(body.business_name, 'Business name', 2, 120);
  const email = normalizeEmail(body.email);
  const country = publicText(body.country, 'Country or region', 2, 80);
  const details = publicText(body.details, 'Workflow summary', 10, 1600);
  const website = publicOptionalUrl(body.website);
  await env.MAQVORA_DB.prepare(`
    INSERT INTO public_rollout_requests (business_name, business_email, website, country, use_case, monthly_message_band, details, consent_at, source_path, ip_hash, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), '/connect', ?, 'new')
  `).bind(businessName, email, website, country, useCase, monthlyBand, details, ipHash).run();
  return json({ ok: true, message: 'Your rollout request has been received. A Maqtomate specialist will review the workflow before any connection step.' }, 202, headers);
}

async function beginGoogleLogin(request, env, headers) {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new AccessError('Google sign-in is not configured yet.', 503);
  }
  const state = randomToken(32);
  const nonce = randomToken(32);
  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizationUrl.searchParams.set('client_id', env.GOOGLE_OAUTH_CLIENT_ID);
  authorizationUrl.searchParams.set('redirect_uri', googleCallbackUrl(request, env));
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('scope', 'openid email profile');
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('nonce', nonce);
  authorizationUrl.searchParams.set('prompt', 'select_account');
  authorizationUrl.searchParams.set('access_type', 'online');

  const redirectHeaders = new Headers(headers);
  redirectHeaders.set('Location', authorizationUrl.toString());
  redirectHeaders.append('Set-Cookie', oauthTransientCookie('mt_google_state', state));
  redirectHeaders.append('Set-Cookie', oauthTransientCookie('mt_google_nonce', nonce));
  return new Response(null, { status: 302, headers: redirectHeaders });
}

async function beginCustomerGoogleLogin(request, env, headers) {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) throw new AccessError('Customer Google sign-in is not configured yet.', 503);
  const state = randomToken(32);
  const nonce = randomToken(32);
  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizationUrl.searchParams.set('client_id', env.GOOGLE_OAUTH_CLIENT_ID);
  authorizationUrl.searchParams.set('redirect_uri', customerGoogleCallbackUrl(request, env));
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('scope', 'openid email profile');
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('nonce', nonce);
  authorizationUrl.searchParams.set('prompt', 'select_account');
  authorizationUrl.searchParams.set('access_type', 'online');
  const redirectHeaders = new Headers(headers);
  redirectHeaders.set('Location', authorizationUrl.toString());
  redirectHeaders.append('Set-Cookie', oauthTransientCookie('mt_customer_google_state', state));
  redirectHeaders.append('Set-Cookie', oauthTransientCookie('mt_customer_google_nonce', nonce));
  return new Response(null, { status: 302, headers: redirectHeaders });
}

async function completeCustomerGoogleLogin(request, env, headers, requestId) {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) throw new AccessError('Customer Google sign-in is not configured yet.', 503);
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const expectedState = cookieValue(request, 'mt_customer_google_state') || '';
  const nonce = cookieValue(request, 'mt_customer_google_nonce') || '';
  if (!state || !code || !expectedState || !nonce || !(await safeHashEquals(state, expectedState))) throw new AccessError('Google sign-in verification failed. Please start again.', 400);
  const exchange = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_OAUTH_CLIENT_ID, client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET, redirect_uri: customerGoogleCallbackUrl(request, env), grant_type: 'authorization_code' }).toString()
  });
  if (!exchange.ok) throw new AccessError('Google sign-in could not be completed. Please start again.', 502);
  const tokenSet = await exchange.json().catch(() => ({}));
  const claims = await verifyGoogleIdToken(tokenSet.id_token, env.GOOGLE_OAUTH_CLIENT_ID, nonce);
  let user = await env.MAQVORA_DB.prepare(`SELECT id, password_hash FROM users WHERE email = ? COLLATE NOCASE`).bind(claims.email).first();
  if (!user) {
    const created = await env.MAQVORA_DB.prepare(`INSERT INTO users (email, display_name, status, email_verified_at, last_login_at) VALUES (?, ?, 'active', datetime('now'), datetime('now'))`).bind(claims.email, claims.email).run();
    user = { id: Number(created.meta?.last_row_id), password_hash: null };
  } else {
    await env.MAQVORA_DB.prepare(`UPDATE users SET status = 'active', email_verified_at = COALESCE(email_verified_at, datetime('now')), last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).bind(user.id).run();
  }
  const onboarding = await env.MAQVORA_DB.prepare(`SELECT id, status FROM customer_onboarding_requests WHERE user_id = ?`).bind(user.id).first();
  const membership = await env.MAQVORA_DB.prepare(`SELECT client_id FROM tenant_memberships WHERE user_id = ? AND status = 'active' LIMIT 1`).bind(user.id).first();
  const sessionToken = await issueSession(user.id, request, env);
  await auditEvent(env, { actorUserId: user.id, action: 'customer.google_identity_verified', requestId, request, details: { onboarding_state: onboarding?.status || 'new' } });
  const destination = !user.password_hash || !onboarding ? '/onboarding/setup' : membership ? '/dashboard' : '/onboarding';
  const redirectHeaders = new Headers(headers);
  redirectHeaders.set('Location', destination);
  redirectHeaders.append('Set-Cookie', sessionCookie(sessionToken));
  redirectHeaders.append('Set-Cookie', clearOAuthTransientCookie('mt_customer_google_state'));
  redirectHeaders.append('Set-Cookie', clearOAuthTransientCookie('mt_customer_google_nonce'));
  return new Response(null, { status: 303, headers: redirectHeaders });
}

async function hasOwnerGate(request, env) {
  const rawToken = cookieValue(request, 'mt_owner_gate');
  if (!rawToken || rawToken.length < 32 || !env.MAQVORA_KV) return false;
  try {
    return (await env.MAQVORA_KV.get(`owner-gate:${await sha256(rawToken)}`)) === 'verified';
  } catch (_) {
    return false;
  }
}

function redirectToOwnerGate(headers) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Location', '/owner/gate');
  return new Response(null, { status: 303, headers: responseHeaders });
}

function ownerGateHTML(message = '') {
  const notice = message ? `<p class="notice" role="status">${escapeHtml(message)}</p>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Protected access</title><style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:#071a16;color:#eef8f4;display:grid;min-height:100vh;place-items:center}.card{width:min(440px,calc(100vw - 32px));padding:34px;border:1px solid #24594b;border-radius:20px;background:#0d2922;box-shadow:0 24px 70px #0007}h1{margin:0 0 8px}p{color:#b7d0c8;line-height:1.55}label{display:grid;gap:8px;font-size:14px;font-weight:700}input{box-sizing:border-box;width:100%;padding:14px;border:1px solid #3e7667;border-radius:10px;background:#06130f;color:#fff;font-size:16px}button{box-sizing:border-box;display:block;width:100%;margin-top:18px;padding:14px;border:0;border-radius:10px;background:#17a673;color:#fff;font-weight:700;font-size:16px;cursor:pointer}.notice{min-height:22px;color:#fcd34d;font-size:14px}</style></head><body><main class="card"><div style="font-size:13px;color:#62e8b8;font-weight:700;letter-spacing:.08em">PROTECTED ACCESS</div><h1>Enter owner password</h1><p>This private gateway is required before the separate Google owner verification step. It is not part of customer sign-in.</p><form method="post" action="/owner/gate"><label>Owner password<input name="password" type="password" autocomplete="current-password" maxlength="512" required autofocus></label><button type="submit">Continue securely</button>${notice}</form></main></body></html>`;
}

async function completeOwnerGate(request, env, headers, requestId) {
  assertSameOrigin(request);
  if (!env.OWNER_GATE_PASSWORD) throw new AccessError('Owner password protection is not configured.', 503);
  const ipHash = await sha256(request.headers.get('CF-Connecting-IP') || 'unknown');
  const allowed = await boundedRateLimit(env, `owner-gate:attempt:${ipHash}`, 5, 900);
  if (!allowed) return htmlResponse(ownerGateHTML('Too many attempts. Please wait 15 minutes before trying again.'), 429, headers);
  const form = await request.formData().catch(() => null);
  const password = String(form?.get('password') || '');
  if (password.length < 1 || password.length > 512 || !(await safeHashEquals(password, String(env.OWNER_GATE_PASSWORD)))) {
    await auditEvent(env, { action: 'owner.password_gate_denied', requestId, request, details: { reason: 'invalid_password' } });
    return htmlResponse(ownerGateHTML('Password was not accepted. Please try again.'), 401, headers);
  }
  const gateToken = randomToken(48);
  await env.MAQVORA_KV.put(`owner-gate:${await sha256(gateToken)}`, 'verified', { expirationTtl: SESSION_TTL_SECONDS });
  await auditEvent(env, { action: 'owner.password_gate_verified', requestId, request });
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Location', '/owner');
  responseHeaders.append('Set-Cookie', ownerGateCookie(gateToken));
  return new Response(null, { status: 303, headers: responseHeaders });
}

async function beginOwnerGoogleLogin(request, env, headers) {
  if (!(await hasOwnerGate(request, env))) return redirectToOwnerGate(headers);
  return await beginGoogleLogin(request, env, headers);
}

async function completeGoogleLogin(request, env, headers, requestId) {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new AccessError('Google sign-in is not configured yet.', 503);
  }
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const expectedState = cookieValue(request, 'mt_google_state') || '';
  const nonce = cookieValue(request, 'mt_google_nonce') || '';
  if (!state || !code || !expectedState || !nonce || !(await safeHashEquals(state, expectedState))) {
    throw new AccessError('Google sign-in verification failed. Please start again.', 400);
  }

  const exchange = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: googleCallbackUrl(request, env),
      grant_type: 'authorization_code'
    }).toString()
  });
  if (!exchange.ok) throw new AccessError('Google sign-in could not be completed. Please start again.', 502);
  const tokenSet = await exchange.json().catch(() => ({}));
  const claims = await verifyGoogleIdToken(tokenSet.id_token, env.GOOGLE_OAUTH_CLIENT_ID, nonce);
  const user = await env.MAQVORA_DB.prepare(`
    SELECT u.id, u.email, u.display_name, pr.role
    FROM users u JOIN platform_roles pr ON pr.user_id = u.id
    WHERE u.email = ? COLLATE NOCASE AND u.status = 'active' AND pr.status = 'active'
      AND pr.role IN ('owner', 'platform_admin')
    LIMIT 1
  `).bind(claims.email).first();
  if (!user) {
    await auditEvent(env, { action: 'auth.google_login_denied', requestId, request, details: { reason: 'not_allowlisted' } });
    throw new AccessError('This Google account is not approved for Maqtomate owner access.', 403);
  }

  const sessionToken = randomToken(48);
  const sessionHash = await sha256(sessionToken);
  const ipHash = await sha256(request.headers.get('CF-Connecting-IP') || 'unknown');
  const uaHash = await sha256(request.headers.get('User-Agent') || 'unknown');
  await env.MAQVORA_DB.batch([
    env.MAQVORA_DB.prepare(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, datetime('now')), last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).bind(user.id),
    env.MAQVORA_DB.prepare(`INSERT INTO user_sessions (token_hash, user_id, expires_at, ip_hash, user_agent_hash) VALUES (?, ?, datetime('now', '+12 hours'), ?, ?)`).bind(sessionHash, user.id, ipHash, uaHash)
  ]);
  await auditEvent(env, { actorUserId: user.id, actorRole: user.role, action: 'auth.google_login', requestId, request });

  const redirectHeaders = new Headers(headers);
  redirectHeaders.set('Set-Cookie', sessionCookie(sessionToken));
  redirectHeaders.append('Set-Cookie', clearOAuthTransientCookie('mt_google_state'));
  redirectHeaders.append('Set-Cookie', clearOAuthTransientCookie('mt_google_nonce'));
  redirectHeaders.set('Location', user.role === 'owner' ? '/owner' : '/dashboard');
  return new Response(null, { status: 303, headers: redirectHeaders });
}

async function safeHashEquals(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return (await sha256(left)) === (await sha256(right));
}

function decodeJwtSegment(segment) {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
  return JSON.parse(atob(padded));
}

function decodeJwtBytes(segment) {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function verifyGoogleIdToken(idToken, clientId, expectedNonce) {
  if (typeof idToken !== 'string') throw new AccessError('Google did not return an identity token.', 502);
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new AccessError('Google identity token was malformed.', 502);
  const [headerSegment, payloadSegment, signatureSegment] = parts;
  const header = decodeJwtSegment(headerSegment);
  const claims = decodeJwtSegment(payloadSegment);
  if (header.alg !== 'RS256' || !header.kid) throw new AccessError('Google identity token algorithm was not accepted.', 502);
  const keyResponse = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!keyResponse.ok) throw new AccessError('Google identity keys were unavailable. Please try again.', 503);
  const keySet = await keyResponse.json().catch(() => ({}));
  const jwk = (keySet.keys || []).find(key => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk) throw new AccessError('Google identity key could not be verified. Please start again.', 502);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const validSignature = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    decodeJwtBytes(signatureSegment),
    new TextEncoder().encode(`${headerSegment}.${payloadSegment}`)
  );
  const now = Math.floor(Date.now() / 1000);
  const acceptedIssuer = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  const audienceMatches = Array.isArray(claims.aud) ? claims.aud.includes(clientId) : claims.aud === clientId;
  const authorizedPartyMatches = !Array.isArray(claims.aud) || !claims.azp || claims.azp === clientId;
  if (!validSignature || !acceptedIssuer || !audienceMatches || !authorizedPartyMatches || !claims.exp || Number(claims.exp) <= now || !claims.nonce || !(await safeHashEquals(claims.nonce, expectedNonce)) || claims.email_verified !== true) {
    throw new AccessError('Google identity verification failed. Please start again.', 401);
  }
  return { email: normalizeEmail(claims.email), subject: String(claims.sub || '') };
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
  responseHeaders.append('Set-Cookie', clearOwnerGateCookie());
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
  const [overview, testTenant, runtimeDiagnostics] = await Promise.all([ownerOverviewData(env), ownerTestTenantData(env), ownerRuntimeCredentialDiagnostics(env)]);
  return htmlResponse(ownerConsoleHTML(access.user, overview, testTenant, runtimeDiagnostics), 200, headers);
}

async function ownerConsoleOrLogin(request, env, headers) {
  if (!(await hasOwnerGate(request, env))) return htmlResponse(ownerGateHTML(), 200, headers);
  try {
    return await ownerConsole(request, env, headers);
  } catch (error) {
    if (error instanceof AccessError && error.status === 401) return await beginOwnerGoogleLogin(request, env, headers);
    throw error;
  }
}

async function ownerRuntimeCredentialDiagnostics(env) {
  try {
    const bridge = env.OWNER_TEST_BRIDGE;
    if (!bridge?.runtimeDiagnostics) return { available: false, checks: {} };
    const response = await bridge.runtimeDiagnostics();
    if (Number(response?.http_status) !== 200 || !response?.payload?.checks) return { available: false, checks: {} };
    return { available: true, checks: response.payload.checks };
  } catch (_) {
    return { available: false, checks: {} };
  }
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
      VALUES (?, 'ONBOARDING_STARTED', 'VERIFIED', 'NOT_FOUND', 'NOT_AVAILABLE')
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

  // The first manual setup stored the Maqtomate test sender and encrypted test credentials on a
  // legacy record. The current owner-visible workspace is the named Owner Test Tenant, so this
  // controlled, owner-only handoff makes that record canonical. Ciphertext is moved directly in
  // D1; the Portal Worker never reads, decrypts, logs, or returns any credential value.
  const legacySenderOwner = await env.MAQVORA_DB.prepare(`
    SELECT id, business_name FROM clients
    WHERE phone_number_id = ? AND id != ?
    LIMIT 1
  `).bind(MAQTOMATE_TEST_PHONE_ID, testTenant.id).first();
  if (legacySenderOwner && legacySenderOwner.business_name !== 'Maqtomate Owner Test') {
    throw new AccessError('The Maqtomate test sender is assigned to an unexpected tenant. No changes were made.', 409);
  }

  const statements = [];
  if (legacySenderOwner) {
    const retiredPhoneMarker = `owner-test-retired-${legacySenderOwner.id}-${Date.now()}`;
    statements.push(
      env.MAQVORA_DB.prepare(`
        INSERT INTO tenant_secret_envelopes (client_id, secret_name, ciphertext, iv, key_version, created_at, updated_at)
        SELECT ?, secret_name, ciphertext, iv, key_version, created_at, datetime('now')
        FROM tenant_secret_envelopes
        WHERE client_id = ? AND secret_name IN ('whatsapp_token', 'gemini_api_key', 'verify_token')
        ON CONFLICT(client_id, secret_name) DO UPDATE SET
          ciphertext = excluded.ciphertext, iv = excluded.iv, key_version = excluded.key_version, updated_at = excluded.updated_at
      `).bind(testTenant.id, legacySenderOwner.id),
      env.MAQVORA_DB.prepare(`
        DELETE FROM tenant_secret_envelopes
        WHERE client_id = ? AND secret_name IN ('whatsapp_token', 'gemini_api_key', 'verify_token')
      `).bind(legacySenderOwner.id),
      env.MAQVORA_DB.prepare(`
        UPDATE clients
        SET phone_number_id = ?, active = 0, updated_at = datetime('now')
        WHERE id = ?
      `).bind(retiredPhoneMarker, legacySenderOwner.id)
    );
  }

  statements.push(
    env.MAQVORA_DB.prepare(`
      UPDATE clients SET phone_number_id = ?, active = 1, updated_at = datetime('now') WHERE id = ?
    `).bind(MAQTOMATE_TEST_PHONE_ID, testTenant.id),
    env.MAQVORA_DB.prepare(`
      INSERT INTO tenant_whatsapp_connections (client_id, waba_id, phone_number_id, display_phone_number, display_name, connection_status, webhook_status, phone_status, token_status, updated_at)
      VALUES (?, ?, ?, ?, 'Maqtomate Meta Test Sender', 'PHONE_FOUND', 'VERIFIED', 'FOUND', 'NOT_AVAILABLE', datetime('now'))
      ON CONFLICT(client_id) DO UPDATE SET
        waba_id = excluded.waba_id, phone_number_id = excluded.phone_number_id,
        display_phone_number = excluded.display_phone_number, display_name = excluded.display_name,
        connection_status = 'PHONE_FOUND', webhook_status = 'VERIFIED',
        phone_status = 'FOUND', token_status = CASE WHEN tenant_whatsapp_connections.token_status = 'VALID' THEN 'VALID' ELSE 'NOT_AVAILABLE' END,
        updated_at = datetime('now')
    `).bind(testTenant.id, MAQTOMATE_TEST_WABA_ID, MAQTOMATE_TEST_PHONE_ID, MAQTOMATE_TEST_DISPLAY_NUMBER)
  );
  // A customer-admin membership is required for the Owner to use this exact tenant through the
  // same customer dashboard paths that future customers will receive.
  statements.push(env.MAQVORA_DB.prepare(`
    INSERT INTO tenant_memberships (user_id, client_id, role, status)
    VALUES (?, ?, 'customer_admin', 'active')
    ON CONFLICT(user_id, client_id) DO UPDATE SET role = 'customer_admin', status = 'active', updated_at = datetime('now')
  `).bind(access.user.id, testTenant.id));
  await env.MAQVORA_DB.batch(statements);
  await auditEvent(env, {
    actorUserId: access.user.id,
    actorRole: access.platformRole,
    clientId: testTenant.id,
    action: 'owner.test_tenant.maqtomate_test_sender_attached',
    requestId,
    request,
    details: {
      sender_type: 'maqtomate_owned_meta_test_asset',
      legacy_owner_test_retired: Boolean(legacySenderOwner),
      encrypted_credential_handoff: Boolean(legacySenderOwner),
      credential_plaintext_accessed: false
    }
  });
  return redirectOwnerConsole(headers, 'test-sender-attached');
}

async function validateOwnerTestCredential(request, env, headers, requestId) {
  assertSameOrigin(request);
  const access = await requireSession(request, env);
  requirePlatform(access, ['owner']);
  const testTenant = await ownerTestTenantData(env);
  if (!testTenant || testTenant.phone_status !== 'FOUND') {
    throw new AccessError('Attach the Maqtomate-owned test sender before checking its credential.', 409);
  }
  const bridge = env.OWNER_TEST_BRIDGE;
  if (!bridge) throw new AccessError('The secure activation bridge is not configured.', 503);
  let result = null;
  let bridgeHttpStatus = null;
  let bridgeResponseClass = 'not_called';
  try {
    const response = await bridge.credentialHealth();
    bridgeHttpStatus = Number(response?.http_status) || null;
    result = response?.payload || null;
    bridgeResponseClass = result?.token_status ? 'contract_json' : 'non_contract_response';
    if (bridgeHttpStatus !== 200 || !result?.token_status) throw new Error('Credential health response unavailable.');
  } catch (_) {
    await auditEvent(env, {
      actorUserId: access.user.id,
      actorRole: access.platformRole,
      clientId: testTenant.id,
      action: 'owner.test_tenant.saved_credential_bridge_failed',
      requestId,
      request,
      details: {
        bridge_http_status: bridgeHttpStatus,
        bridge_response_class: bridgeResponseClass,
        credential_plaintext_accessed: false
      }
    }).catch(() => {});
    throw new AccessError('The credential check is temporarily unavailable. No credential was changed.', 502);
  }
  const tokenStatus = ['VALID', 'INVALID', 'FAILED', 'NOT_AVAILABLE'].includes(result.token_status) ? result.token_status : 'FAILED';
  await auditEvent(env, {
    actorUserId: access.user.id,
    actorRole: access.platformRole,
    clientId: testTenant.id,
    action: 'owner.test_tenant.saved_credential_validated',
    requestId,
    request,
    details: { token_status: tokenStatus, credential_plaintext_accessed: false }
  });
  return redirectOwnerConsole(headers, `credential-${tokenStatus.toLowerCase()}`);
}

async function renewOwnerTestCredential(request, env, headers, requestId) {
  assertSameOrigin(request);
  const access = await requireSession(request, env);
  requirePlatform(access, ['owner']);
  const testTenant = await ownerTestTenantData(env);
  if (!testTenant || testTenant.phone_status !== 'FOUND') {
    throw new AccessError('Attach the Maqtomate-owned test sender before renewing its credential.', 409);
  }
  const form = await request.formData();
  const replacementToken = String(form.get('meta_access_token') || '').trim();
  if (replacementToken.length < 30 || replacementToken.length > 4096) {
    throw new AccessError('Enter a newly generated Meta access token.', 400);
  }
  const bridge = env.OWNER_TEST_BRIDGE;
  if (!bridge) throw new AccessError('The secure activation bridge is not configured.', 503);
  let result = null;
  let bridgeHttpStatus = null;
  let bridgeResponseClass = 'not_called';
  try {
    const response = await bridge.renewCredential(replacementToken);
    bridgeHttpStatus = Number(response?.http_status) || null;
    result = response?.payload || null;
    bridgeResponseClass = result?.token_status ? 'contract_json' : 'non_contract_response';
    if (!result?.token_status) throw new Error('Credential renewal response unavailable.');
  } catch (_) {
    await auditEvent(env, {
      actorUserId: access.user.id,
      actorRole: access.platformRole,
      clientId: testTenant.id,
      action: 'owner.test_tenant.credential_renewal_bridge_failed',
      requestId,
      request,
      details: {
        bridge_http_status: bridgeHttpStatus,
        bridge_response_class: bridgeResponseClass,
        credential_plaintext_accessed: false
      }
    }).catch(() => {});
    throw new AccessError('The secure credential renewal is temporarily unavailable. No credential was changed.', 502);
  }
  const tokenStatus = ['VALID', 'INVALID', 'FAILED', 'NOT_AVAILABLE'].includes(result.token_status) ? result.token_status : 'FAILED';
  await auditEvent(env, {
    actorUserId: access.user.id,
    actorRole: access.platformRole,
    clientId: testTenant.id,
    action: 'owner.test_tenant.credential_renewal_requested',
    requestId,
    request,
    details: { token_status: tokenStatus, credential_plaintext_accessed: false }
  });
  return redirectOwnerConsole(headers, `credential-renewal-${tokenStatus.toLowerCase()}`);
}

async function sendOwnerControlledTest(request, env, headers, requestId) {
  const access = await requireSession(request, env);
  requirePlatform(access, ['owner']);
  let result = null;
  try {
    if (!env.OWNER_TEST_BRIDGE?.sendControlledTest) throw new Error('bridge_unavailable');
    result = await env.OWNER_TEST_BRIDGE.sendControlledTest();
  } catch (_) {
    await auditEvent(env, { actorUserId: access.user.id, action: 'owner_test.controlled_send_bridge_failed', requestId, request, details: { response_class: 'bridge_unavailable' } }).catch(() => {});
    return redirectOwnerConsole(headers, 'controlled-test-unavailable');
  }
  const delivery = String(result?.payload?.delivery || 'FAILED').toLowerCase();
  await auditEvent(env, { actorUserId: access.user.id, action: 'owner_test.controlled_send_requested', requestId, request, details: { delivery } }).catch(() => {});
  return redirectOwnerConsole(headers, `controlled-test-${delivery}`);
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
  return { accepted: true };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
}

async function customerOnboardingRecord(userId, env) {
  return env.MAQVORA_DB.prepare(`
    SELECT o.id, o.business_name, o.country, o.requested_offer, o.requested_ai_mode, o.status,
           o.expected_setup_amount, o.currency, o.payment_reference, o.payment_submitted_at,
           o.review_note, o.tenant_client_id, o.created_at, o.updated_at,
           u.email, u.email_verified_at
    FROM customer_onboarding_requests o JOIN users u ON u.id = o.user_id
    WHERE o.user_id = ?
  `).bind(userId).first();
}

async function customerActivationReadiness(onboardingId, userId, env) {
  return env.MAQVORA_DB.prepare(`
    SELECT id, service_summary, operating_hours, handoff_email, status, opt_in_acknowledged_at, created_at, updated_at
    FROM customer_activation_readiness
    WHERE onboarding_request_id = ? AND user_id = ?
  `).bind(onboardingId, userId).first();
}

async function customerOnboardingPage(request, env, headers) {
  const access = await requireSession(request, env);
  if (access.platformRole) return redirectToOwnerGate(headers);
  if (access.memberships.length) {
    const responseHeaders = new Headers(headers);
    responseHeaders.set('Location', '/dashboard');
    return new Response(null, { status: 303, headers: responseHeaders });
  }
  const onboarding = await customerOnboardingRecord(access.user.id, env);
  if (!onboarding) throw new AccessError('No customer onboarding request is associated with this account.', 404);
  const readiness = await customerActivationReadiness(onboarding.id, access.user.id, env);
  return htmlResponse(customerOnboardingHTML(onboarding, readiness), 200, headers);
}

async function customerSignupPage(request, env, headers) {
  const session = await optionalSession(request, env).catch(() => null);
  if (session?.user?.id) {
    const responseHeaders = new Headers(headers);
    responseHeaders.set('Location', '/onboarding');
    return new Response(null, { status: 303, headers: responseHeaders });
  }
  return htmlResponse(signupHTML(Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET)), 200, headers);
}

async function customerOnboardingSetupPage(request, env, headers) {
  const access = await requireSession(request, env);
  if (access.platformRole) return redirectToOwnerGate(headers);
  if (access.memberships.length) {
    const responseHeaders = new Headers(headers);
    responseHeaders.set('Location', '/dashboard');
    return new Response(null, { status: 303, headers: responseHeaders });
  }
  const existing = await customerOnboardingRecord(access.user.id, env);
  if (existing) {
    const responseHeaders = new Headers(headers);
    responseHeaders.set('Location', '/onboarding');
    return new Response(null, { status: 303, headers: responseHeaders });
  }
  return htmlResponse(customerOnboardingSetupHTML(access.user.email), 200, headers);
}

async function completeCustomerOnboardingSetup(request, env, headers, requestId) {
  assertSameOrigin(request);
  const access = await requireSession(request, env);
  if (access.platformRole || access.memberships.length) throw new AccessError('Customer onboarding setup is unavailable for this account.', 403);
  const body = await request.json().catch(() => { throw new AccessError('Invalid onboarding setup request.', 400); });
  const password = validPassword(body.password);
  if (password !== String(body.confirm_password || '')) throw new AccessError('Passwords do not match.', 400);
  const businessName = publicText(body.business_name, 'Business name', 2, 120);
  const country = publicText(body.country, 'Country or region', 2, 80);
  const requestedOffer = onboardingOffer(body.requested_offer);
  const requestedAiMode = onboardingAiMode(body.requested_ai_mode);
  const existing = await customerOnboardingRecord(access.user.id, env);
  if (existing) throw new AccessError('This customer account already has an onboarding request.', 409);
  const verifier = await derivePasswordHash(password);
  await env.MAQVORA_DB.batch([
    env.MAQVORA_DB.prepare(`UPDATE users SET display_name = ?, password_hash = ?, password_salt = ?, password_iterations = ?, password_set_at = datetime('now'), status = 'active', email_verified_at = COALESCE(email_verified_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`).bind(businessName, verifier.hash, verifier.salt, verifier.iterations, access.user.id),
    env.MAQVORA_DB.prepare(`INSERT INTO customer_onboarding_requests (user_id, business_name, country, requested_offer, requested_ai_mode, status, expected_setup_amount) VALUES (?, ?, ?, ?, ?, 'payment_pending', ? )`).bind(access.user.id, businessName, country, requestedOffer, requestedAiMode, onboardingAmount(requestedOffer))
  ]);
  await auditEvent(env, { actorUserId: access.user.id, action: 'customer.onboarding_setup_completed', requestId, request, details: { requested_offer: requestedOffer, requested_ai_mode: requestedAiMode } });
  return json({ ok: true, redirect: '/onboarding' }, 201, headers);
}

async function customerOnboardingStatus(request, env, headers) {
  const access = await requireSession(request, env);
  if (access.platformRole) throw new AccessError('Customer onboarding access only.', 403);
  const onboarding = await customerOnboardingRecord(access.user.id, env);
  if (!onboarding) throw new AccessError('No customer onboarding request is associated with this account.', 404);
  const readiness = await customerActivationReadiness(onboarding.id, access.user.id, env);
  return json({ onboarding, readiness }, 200, headers);
}

async function saveCustomerActivationReadiness(request, env, headers, requestId) {
  assertSameOrigin(request);
  const access = await requireSession(request, env);
  if (access.platformRole || access.memberships.length) throw new AccessError('Customer activation readiness is unavailable for this account.', 403);
  const body = await request.json().catch(() => { throw new AccessError('Invalid activation readiness request.', 400); });
  const onboarding = await customerOnboardingRecord(access.user.id, env);
  const editableStatuses = new Set(['payment_pending', 'payment_submitted', 'connection_pending', 'connection_ready']);
  if (!onboarding || !editableStatuses.has(onboarding.status)) throw new AccessError('This onboarding request is not open for activation readiness.', 409);
  const serviceSummary = publicText(body.service_summary, 'Service summary', 20, 600);
  const operatingHours = publicText(body.operating_hours, 'Operating hours', 2, 240);
  const handoffEmail = normalizeEmail(body.handoff_email);
  if (body.opt_in_acknowledged !== true) throw new AccessError('Confirm that your business will collect and honor messaging opt-in and opt-out requests.', 400);
  await env.MAQVORA_DB.prepare(`
    INSERT INTO customer_activation_readiness (onboarding_request_id, user_id, service_summary, operating_hours, handoff_email, opt_in_acknowledged_at, status)
    VALUES (?, ?, ?, ?, ?, datetime('now'), 'submitted')
    ON CONFLICT(onboarding_request_id) DO UPDATE SET
      service_summary = excluded.service_summary,
      operating_hours = excluded.operating_hours,
      handoff_email = excluded.handoff_email,
      opt_in_acknowledged_at = datetime('now'),
      status = 'submitted',
      updated_at = datetime('now')
  `).bind(onboarding.id, access.user.id, serviceSummary, operatingHours, handoffEmail).run();
  await auditEvent(env, { actorUserId: access.user.id, action: 'customer.activation_readiness_submitted', requestId, request, details: { onboarding_id: onboarding.id, credential_collection: false } });
  return json({ ok: true, readiness_status: 'submitted', message: 'Activation readiness saved for private owner review.' }, 200, headers);
}

async function submitCustomerOnboardingPayment(request, env, headers, requestId) {
  assertSameOrigin(request);
  const access = await requireSession(request, env);
  if (access.platformRole) throw new AccessError('Customer onboarding access only.', 403);
  const body = await request.json().catch(() => { throw new AccessError('Invalid payment submission.', 400); });
  const reference = publicText(body.payment_reference, 'Payment reference', 3, 160);
  const current = await customerOnboardingRecord(access.user.id, env);
  if (!current || current.status !== 'payment_pending') throw new AccessError('This onboarding request is not ready for a payment reference.', 409);
  const submitted = await env.MAQVORA_DB.prepare(`
    UPDATE customer_onboarding_requests
    SET payment_reference = ?, payment_submitted_at = datetime('now'), status = 'payment_submitted', updated_at = datetime('now')
    WHERE id = ? AND user_id = ? AND status = 'payment_pending'
  `).bind(reference, current.id, access.user.id).run();
  if (!submitted.meta?.changes) throw new AccessError('This payment request has already changed. Refresh and try again.', 409);
  await auditEvent(env, { actorUserId: access.user.id, action: 'customer.onboarding_payment_submitted', requestId, request, details: { onboarding_id: current.id } });
  return json({ ok: true, status: 'payment_submitted', message: 'Your payment reference is awaiting Maqtomate owner review.' }, 200, headers);
}

async function ownerCustomerOnboardingRequests(request, env, headers, requestId) {
  const access = await requireSession(request, env);
  requirePlatform(access, ['owner']);
  const status = String(new URL(request.url).searchParams.get('status') || 'all');
  const allowed = new Set(['email_verification_required', 'payment_pending', 'payment_submitted', 'connection_pending', 'connection_ready', 'active', 'rejected', 'cancelled', 'all']);
  if (!allowed.has(status)) throw new AccessError('Invalid onboarding status.', 400);
  const filter = status === 'all' ? '' : 'WHERE o.status = ?';
  const rows = await env.MAQVORA_DB.prepare(`
    SELECT o.id, o.business_name, o.country, o.requested_offer, o.requested_ai_mode, o.status,
           o.expected_setup_amount, o.currency, o.payment_reference, o.payment_submitted_at,
           o.review_note, o.tenant_client_id, o.created_at, o.updated_at, u.email,
           r.status AS readiness_status, r.updated_at AS readiness_updated_at
    FROM customer_onboarding_requests o JOIN users u ON u.id = o.user_id
    LEFT JOIN customer_activation_readiness r ON r.onboarding_request_id = o.id AND r.user_id = o.user_id
    ${filter} ORDER BY CASE o.status WHEN 'payment_submitted' THEN 0 WHEN 'connection_pending' THEN 1 ELSE 2 END, o.created_at DESC LIMIT 100
  `).bind(...(status === 'all' ? [] : [status])).all();
  await auditEvent(env, { actorUserId: access.user.id, actorRole: access.platformRole, action: 'owner.customer_onboarding_queue_viewed', requestId, request, details: { status } });
  return json({ onboarding_requests: rows.results || [] }, 200, headers);
}

async function reviewCustomerOnboardingRequest(request, env, headers, requestId) {
  assertSameOrigin(request);
  const access = await requireSession(request, env);
  requirePlatform(access, ['owner']);
  const parts = new URL(request.url).pathname.split('/');
  const onboardingId = Number(parts[4]);
  const decision = String(parts[5] || '');
  if (!Number.isInteger(onboardingId) || onboardingId < 1 || !['approve', 'reject', 'activate'].includes(decision)) throw new AccessError('Invalid onboarding review request.', 400);
  const body = await request.json().catch(() => ({}));
  const note = String(body.note || '').trim().slice(0, 1000);
  const onboarding = await env.MAQVORA_DB.prepare(`
    SELECT id, user_id, requested_ai_mode, status FROM customer_onboarding_requests WHERE id = ?
  `).bind(onboardingId).first();
  if (!onboarding) throw new AccessError('Customer onboarding request not found.', 404);
  if (decision === 'reject') {
    if (!['payment_pending', 'payment_submitted', 'connection_pending', 'connection_ready'].includes(onboarding.status)) throw new AccessError('This onboarding request cannot be rejected from its current state.', 409);
    await env.MAQVORA_DB.prepare(`UPDATE customer_onboarding_requests SET status = 'rejected', reviewed_at = datetime('now'), reviewed_by_user_id = ?, review_note = ?, updated_at = datetime('now') WHERE id = ?`).bind(access.user.id, note || 'Request was not approved.', onboarding.id).run();
    await auditEvent(env, { actorUserId: access.user.id, actorRole: access.platformRole, action: 'owner.customer_onboarding_rejected', requestId, request, details: { onboarding_id: onboarding.id } });
    return json({ ok: true, status: 'rejected' }, 200, headers);
  }
  if (decision === 'approve') {
    if (onboarding.status !== 'payment_submitted') throw new AccessError('Only a submitted payment can be approved.', 409);
    await env.MAQVORA_DB.prepare(`UPDATE customer_onboarding_requests SET status = 'connection_pending', reviewed_at = datetime('now'), reviewed_by_user_id = ?, review_note = ?, updated_at = datetime('now') WHERE id = ? AND status = 'payment_submitted'`).bind(access.user.id, note || 'Payment verified. Managed official connection review can begin.', onboarding.id).run();
    await auditEvent(env, { actorUserId: access.user.id, actorRole: access.platformRole, action: 'owner.customer_onboarding_payment_approved', requestId, request, details: { onboarding_id: onboarding.id } });
    return json({ ok: true, status: 'connection_pending' }, 200, headers);
  }
  if (!['connection_pending', 'connection_ready'].includes(onboarding.status)) throw new AccessError('This onboarding request is not ready for tenant activation.', 409);
  const clientId = Number(body.tenant_client_id);
  if (!Number.isInteger(clientId) || clientId < 1) throw new AccessError('Provide the active connected customer tenant ID before activation.', 400);
  const expectedMode = onboarding.requested_ai_mode === 'customer_byok' ? 1 : 2;
  const client = await env.MAQVORA_DB.prepare(`
    SELECT id, business_name FROM clients
    WHERE id = ? AND active = 1 AND client_mode = ? AND business_name != 'Maqtomate Owner Test Tenant'
  `).bind(clientId, expectedMode).first();
  if (!client) throw new AccessError('The selected tenant is not an active customer-owned connection with the requested AI mode.', 409);
  await env.MAQVORA_DB.batch([
    env.MAQVORA_DB.prepare(`UPDATE customer_onboarding_requests SET status = 'active', tenant_client_id = ?, reviewed_at = datetime('now'), reviewed_by_user_id = ?, review_note = ?, updated_at = datetime('now') WHERE id = ?`).bind(client.id, access.user.id, note || 'Managed connection approved and customer dashboard activated.', onboarding.id),
    env.MAQVORA_DB.prepare(`INSERT INTO tenant_memberships (user_id, client_id, role, status) VALUES (?, ?, 'customer_admin', 'active') ON CONFLICT(user_id, client_id) DO UPDATE SET role = 'customer_admin', status = 'active', updated_at = datetime('now')`).bind(onboarding.user_id, client.id)
  ]);
  await auditEvent(env, { actorUserId: access.user.id, actorRole: access.platformRole, clientId: client.id, action: 'owner.customer_onboarding_activated', requestId, request, details: { onboarding_id: onboarding.id, requested_ai_mode: onboarding.requested_ai_mode } });
  return json({ ok: true, status: 'active', tenant_client_id: client.id }, 200, headers);
}

function loginHTML(env) {
  return accountShell('Secure customer sign-in', 'Use your business email and password. Customer access stays separate from the private Owner Console.', `<form id="login-form"><label>Business email<input id="email" type="email" autocomplete="email" required placeholder="you@business.com"></label><label>Password<input id="password" type="password" autocomplete="current-password" required></label><button id="submit">Sign in securely</button><p class="small"><a href="/signup">Create a customer account</a> · <a href="#" id="forgot">Forgot password?</a></p><div id="note" class="notice" aria-live="polite"></div></form>`, `<script>const f=document.querySelector('#login-form'),n=document.querySelector('#note'),b=document.querySelector('#submit');f.addEventListener('submit',async e=>{e.preventDefault();b.disabled=true;n.textContent='Signing in…';try{const r=await fetch('/auth/password-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.querySelector('#email').value,password:document.querySelector('#password').value})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Sign-in failed.');location.href=d.redirect||'/dashboard'}catch(e){n.textContent=e.message||'Unable to sign in.'}finally{b.disabled=false}});document.querySelector('#forgot').addEventListener('click',async e=>{e.preventDefault();const email=document.querySelector('#email').value;if(!email){n.textContent='Enter your email first, then choose Forgot password.';return}n.textContent='Requesting reset instructions…';try{const r=await fetch('/auth/password-forgot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});const d=await r.json();n.textContent=d.message||'If eligible, instructions will be sent.'}catch(_){n.textContent='Unable to request a reset right now.'}});</script>`);
}

function accountShell(title, intro, content, script = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)} — Maqtomate</title><style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:radial-gradient(circle at 72% 12%,#1f746036,transparent 24%),#071a16;color:#eef8f4;display:grid;min-height:100vh;place-items:center}.card{width:min(460px,calc(100vw - 36px));padding:34px;border:1px solid #24594b;border-radius:20px;background:#0d2922;box-shadow:0 24px 70px #0007}h1{margin:6px 0 8px;font-size:30px;letter-spacing:-.04em}p{color:#b7d0c8;line-height:1.55}.eyebrow{font-size:12px;color:#62e8b8;font-weight:700;letter-spacing:.08em}.small{font-size:13px}.small a{color:#79f0c6}.notice{min-height:24px;font-size:14px;color:#f6d28b}label{display:grid;gap:7px;margin:14px 0;font-size:13px;font-weight:700}input,select,textarea{box-sizing:border-box;width:100%;padding:14px;border:1px solid #3e7667;border-radius:10px;background:#06130f;color:#fff;font:inherit}textarea{min-height:110px;resize:vertical}button{box-sizing:border-box;display:block;width:100%;margin-top:18px;padding:14px;border:0;border-radius:10px;background:#17a673;color:white;font-weight:700;font-size:16px;cursor:pointer}button:disabled{opacity:.6}.status{border:1px solid #2d6659;border-radius:12px;background:#082018;padding:15px;margin:18px 0}.status b{display:block;color:#8ff3d8;margin-bottom:5px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:520px){.grid{grid-template-columns:1fr}.card{padding:26px}}</style></head><body><main class="card"><div class="eyebrow">MAQTOMATE CUSTOMER ACCESS</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(intro)}</p>${content}</main>${script}</body></html>`;
}

function signupHTML(googleConfigured) {
  const google = googleConfigured ? `<a class="google-button" href="/auth/customer/google">Continue with Google</a><p class="small">Google verifies the Gmail/business email identity. On the next page, the customer creates their own Maqtomate password.</p>` : `<div class="notice">Customer Google sign-in is not configured yet. Please request a managed rollout review.</div>`;
  return accountShell('Create your customer account', 'Use Google to verify your business email, then choose your own Maqtomate password. Payment approval and official connection review happen before a customer dashboard is activated.', `${google}<p class="small">Already have a Maqtomate password? <a href="/login">Sign in</a></p><p class="small">Your business will use its own official WhatsApp/Meta assets during the managed connection process. Never enter a Meta token, WhatsApp password, OTP, or personal number here.</p>`);
}

function customerOnboardingSetupHTML(email) {
  const form = `<form id="onboarding-setup-form"><section class="status"><b>Verified Google identity</b><span>${escapeHtml(email)}</span></section><div class="grid"><label>Business name<input id="business_name" required maxlength="120" autocomplete="organization"></label><label>Country or region<input id="country" required maxlength="80" placeholder="Pakistan" autocomplete="country-name"></label></div><div class="grid"><label>Choose offer<select id="requested_offer"><option value="managed_launch">Managed Launch</option><option value="custom_rollout">Custom Business Rollout</option></select></label><label>Gemini mode<select id="requested_ai_mode"><option value="customer_byok">Customer Gemini BYOK</option><option value="managed_ai">Managed Gemini allowance</option></select></label></div><section id="offer-summary" class="status"><b>Managed Launch — Rs 5,000 setup + Rs 2,000/month</b><span>Includes approved business context, qualification rules, human handoff design, and a supervised readiness test. Payment starts private review; it does not instantly activate a bot.</span></section><label>Create Maqtomate password <small>(at least 7 characters)</small><input id="password" type="password" autocomplete="new-password" minlength="7" required></label><label>Confirm password<input id="confirm_password" type="password" autocomplete="new-password" minlength="7" required></label><p class="small">Your selected Gemini mode is a commercial preference. The live platform enforces the allowed mode server-side only after owner approval. Your business always uses its own official Meta/WhatsApp assets—never Maqtomate owner credentials.</p><button id="submit">Save account and continue to payment review</button><div id="note" class="notice" aria-live="polite"></div></form>`;
  const script = `<script>const f=document.querySelector('#onboarding-setup-form'),n=document.querySelector('#note'),b=document.querySelector('#submit'),offer=document.querySelector('#requested_offer'),summary=document.querySelector('#offer-summary');function updateOffer(){summary.innerHTML=offer.value==='managed_launch'?'<b>Managed Launch — Rs 5,000 setup + Rs 2,000/month</b><span>Includes approved business context, qualification rules, human handoff design, and a supervised readiness test. Payment starts private review; it does not instantly activate a bot.</span>':'<b>Custom Business Rollout — quote after review</b><span>For higher volume, additional languages, complex workflows, or a separately approved integration requirement. Scope and setup amount are confirmed before payment review.</span>'}offer.addEventListener('change',updateOffer);f.addEventListener('submit',async e=>{e.preventDefault();b.disabled=true;n.textContent='Saving secure customer setup…';const data={business_name:document.querySelector('#business_name').value,country:document.querySelector('#country').value,requested_offer:offer.value,requested_ai_mode:document.querySelector('#requested_ai_mode').value,password:document.querySelector('#password').value,confirm_password:document.querySelector('#confirm_password').value};try{const r=await fetch('/api/customer/onboarding/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Customer setup could not be saved.');location.href=d.redirect||'/onboarding'}catch(e){n.textContent=e.message||'Unable to save customer setup.'}finally{b.disabled=false}});</script>`;
  return accountShell('Finish your customer setup', 'Your Google identity is verified. Create your Maqtomate password, select your customer-safe offer, and select the preferred Gemini cost mode.', form, script);
}

function passwordResetHTML(token) {
  const form = `<form id="reset-form"><label>New password<input id="password" type="password" autocomplete="new-password" minlength="7" required></label><label>Confirm new password<input id="confirm_password" type="password" autocomplete="new-password" minlength="7" required></label><button id="submit">Update password</button><div id="note" class="notice" aria-live="polite"></div></form>`;
  const script = `<script>const f=document.querySelector('#reset-form'),n=document.querySelector('#note'),b=document.querySelector('#submit'),token=${JSON.stringify(token)};f.addEventListener('submit',async e=>{e.preventDefault();b.disabled=true;n.textContent='Updating password…';try{const r=await fetch('/auth/password-reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password:document.querySelector('#password').value,confirm_password:document.querySelector('#confirm_password').value})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Password could not be updated.');n.textContent=d.message||'Password updated.';setTimeout(()=>location.href='/login',900)}catch(e){n.textContent=e.message||'Unable to update password.'}finally{b.disabled=false}});</script>`;
  return accountShell('Choose a new password', 'Use a new password with at least 7 characters. All active sessions will be signed out after this change.', form, script);
}

function customerOnboardingHTML(onboarding, readiness = null) {
  const statusLabels = { payment_pending: 'Payment pending', payment_submitted: 'Payment review in progress', connection_pending: 'Managed official connection in progress', connection_ready: 'Ready for activation', active: 'Dashboard active', rejected: 'Request not approved', cancelled: 'Request cancelled' };
  const status = statusLabels[onboarding.status] || onboarding.status;
  const amount = Number(onboarding.expected_setup_amount || 0);
  const paymentForm = onboarding.status === 'payment_pending' ? `<form id="payment-form"><label>Payment reference<input id="payment_reference" required maxlength="160" placeholder="Transaction or receipt reference"></label><button id="submit">Submit payment for review</button><div id="note" class="notice" aria-live="polite"></div></form>` : '';
  const readinessAllowed = ['payment_pending', 'payment_submitted', 'connection_pending', 'connection_ready'].includes(onboarding.status);
  const readinessForm = readinessAllowed && !readiness ? `<form id="readiness-form"><section class="status"><b>Activation readiness</b><span>Prepare the minimum approved business context for private owner review. This does not activate a tenant or request any provider credential.</span></section><label>Service summary<textarea id="service_summary" required maxlength="600" placeholder="What should the AI Employee help your customers with?"></textarea></label><label>Operating hours<textarea id="operating_hours" required maxlength="240" placeholder="For example: Monday–Saturday, 09:00–18:00 PKT"></textarea></label><label>Human-handoff email<input id="handoff_email" type="email" required maxlength="254" autocomplete="email" placeholder="team@yourbusiness.com"></label><label class="small"><input id="opt_in_acknowledged" type="checkbox" required style="width:auto;margin-right:8px">I confirm my business will collect and honor clear WhatsApp messaging opt-in and opt-out requests.</label><button id="readiness-submit" type="submit">Save activation readiness</button><div id="readiness-note" class="notice" aria-live="polite"></div></form>` : `<section class="status"><b>Activation readiness</b><span>${readiness ? `Submitted for private owner review on ${escapeHtml(readiness.updated_at || readiness.created_at)}.` : 'Available when the onboarding request is open for readiness review.'}</span></section>`;
  const script = `<script>const paymentForm=document.querySelector('#payment-form');if(paymentForm){const n=document.querySelector('#note'),b=paymentForm.querySelector('#submit');paymentForm.addEventListener('submit',async e=>{e.preventDefault();b.disabled=true;n.textContent='Submitting for review…';try{const r=await fetch('/api/customer/onboarding/payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payment_reference:document.querySelector('#payment_reference').value})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Payment reference could not be submitted.');location.reload()}catch(e){n.textContent=e.message||'Unable to submit payment reference.'}finally{b.disabled=false}})}const readinessForm=document.querySelector('#readiness-form');if(readinessForm){const n=document.querySelector('#readiness-note'),b=document.querySelector('#readiness-submit');readinessForm.addEventListener('submit',async e=>{e.preventDefault();b.disabled=true;n.textContent='Saving activation readiness…';const data={service_summary:document.querySelector('#service_summary').value,operating_hours:document.querySelector('#operating_hours').value,handoff_email:document.querySelector('#handoff_email').value,opt_in_acknowledged:document.querySelector('#opt_in_acknowledged').checked};try{const r=await fetch('/api/customer/onboarding/readiness',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Activation readiness could not be saved.');location.reload()}catch(e){n.textContent=e.message||'Unable to save activation readiness.'}finally{b.disabled=false}})}</script>`;
  const amountText = amount ? `${escapeHtml(onboarding.currency)} ${amount.toLocaleString()} setup review` : 'Scope and setup amount confirmed after review';
  const steps = [
    ['Google identity', 'Complete', true],
    ['Account and AI preference', 'Complete', true],
    ['Payment review', onboarding.status === 'payment_pending' ? 'Action needed' : onboarding.status === 'payment_submitted' ? 'Under owner review' : 'Completed', onboarding.status !== 'payment_pending' && onboarding.status !== 'payment_submitted'],
    ['Activation readiness', readiness ? `Submitted · ${readiness.status}` : 'Action needed', Boolean(readiness)],
    ['Official connection', onboarding.status === 'connection_pending' ? 'In progress' : onboarding.status === 'connection_ready' ? 'Ready for activation' : 'Locked until review', ['connection_pending', 'connection_ready', 'active'].includes(onboarding.status)],
    ['Business workspace', onboarding.status === 'active' ? 'Active' : 'Locked until activation', onboarding.status === 'active']
  ].map(([label, detail, complete]) => `<li class="${complete ? 'complete' : ''}"><i>${complete ? '✓' : '•'}</i><span><b>${escapeHtml(label)}</b><small>${escapeHtml(detail)}</small></span></li>`).join('');
  const card = `<section class="status"><b>${escapeHtml(status)}</b><span>${escapeHtml(onboarding.review_note || 'Your managed rollout remains separate from the private Owner Console and owner credentials.')}</span></section><section class="status"><b>Your activation journey</b><ol style="list-style:none;padding:0;margin:12px 0 0;display:grid;gap:9px">${steps}</ol></section><div class="grid"><section class="status"><b>Selected offer</b><span>${escapeHtml(onboarding.requested_offer === 'managed_launch' ? 'Managed Launch' : 'Custom Business Rollout')}</span></section><section class="status"><b>Gemini preference</b><span>${escapeHtml(onboarding.requested_ai_mode === 'customer_byok' ? 'Customer Gemini BYOK' : 'Managed Gemini allowance')}</span></section></div><section class="status"><b>Next permitted action</b><span>${onboarding.status === 'payment_pending' ? 'Submit your payment reference for private owner review.' : !readiness ? 'Complete your activation readiness information.' : onboarding.status === 'payment_submitted' ? 'Wait for payment review. Maqtomate will not activate a tenant automatically.' : 'Maqtomate is managing the official connection process. No credentials are needed from this page.'}</span></section><section class="status"><b>Payment status</b><span>${amountText}</span></section>${readinessForm}${paymentForm}<p class="small">Maqtomate never asks for a Meta password, token, WhatsApp password, OTP, personal number, or Gemini API key here.</p><p class="small"><a href="/">Back to Maqtomate overview</a> · <a href="/auth/logout" onclick="event.preventDefault();fetch('/auth/logout',{method:'POST'}).then(()=>location.href='/login')">Sign out</a></p>`;
  return accountShell('Your activation command center', 'See the real managed rollout state, complete only your currently permitted step, and keep official technical connection work with the protected Maqtomate owner process.', card, script);
}

const MARKETING_PATHS = new Set([
  '/product', '/how-it-works', '/use-cases', '/use-cases/real-estate', '/use-cases/clinics',
  '/use-cases/salons', '/use-cases/education', '/use-cases/ecommerce', '/pricing', '/security',
  '/resources', '/connect'
]);

function isMarketingPath(path) {
  return MARKETING_PATHS.has(path);
}

function marketingSitemap(request, env) {
  const base = portalBaseUrl(request, env);
  const urls = ['/', ...MARKETING_PATHS].map(path => `<url><loc>${escapeHtml(`${base}${path}`)}</loc><changefreq>weekly</changefreq><priority>${path === '/' ? '1.0' : '0.7'}</priority></url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

function verticalPage(name, intro, modules) {
  return {
    eyebrow: `${name} use case`,
    title: `${name} conversations, prepared for a <em>better next step.</em>`,
    intro,
    label: `${name} workflow`,
    modules,
    kicker: 'Start with the context your team needs before the handoff.'
  };
}

function capabilityDetail(index) {
  return [
    'Configured to keep the conversation grounded in approved business information.',
    'Voice-note support can prepare spoken enquiries for a useful response and review path.',
    'Qualification captures only the context needed for the next business decision.',
    'Human teams receive escalations with clear conversation history and context.',
    'Tenant-scoped operational views keep lead and follow-up work visible.'
  ][index] || 'Configured around your approved workflow and escalation rules.';
}

function routeVisual(path) {
  const configs = {
    '/product': { kind: 'product', eyebrow: 'AI Employee operating loop', title: 'From message to a useful next step', steps: ['Customer message', 'Approved business context', 'Qualification and handoff'], note: 'A factual product view of repeatable, supervised customer operations.' },
    '/how-it-works': { kind: 'launch', eyebrow: 'Managed rollout sequence', title: 'A controlled launch, not a dashboard burden', steps: ['Map the customer journey', 'Approve knowledge and guardrails', 'Run a supervised test', 'Activate after review'], note: 'Every activation remains guided by an official readiness review.' },
    '/use-cases': { kind: 'brief', eyebrow: 'Illustrative qualification brief', title: 'The next human decision, prepared', steps: ['Customer enquiry', 'Approved questions', 'Ready for the team'], note: 'An illustrative workflow, not a customer conversation or outcome claim.' },
    '/security': { kind: 'security', eyebrow: 'Security operating boundary', title: 'Designed around controlled access', steps: ['Official Meta Cloud API', 'Secure Worker and tenant scope', 'Encrypted credential boundary', 'Auditable sensitive actions'], note: 'Security controls are part of the operating model.' },
    '/resources': { kind: 'resources', eyebrow: 'Operational learning library', title: 'Turn repeat questions into better decisions', steps: ['AI Employee guides', 'Qualification templates', 'Human handoff', 'Official API readiness'], note: 'Useful operating guides are being developed around real team workflows.' },
    '/pricing': { kind: 'pricing', eyebrow: 'Managed offer compass', title: 'Choose the scope before activation', steps: ['Managed Launch', 'Custom business rollout', 'Supervised activation'], note: 'Each client uses their own official business assets.' }
  };
  const vertical = path.startsWith('/use-cases/') ? configs['/use-cases'] : null;
  const selected = configs[path] || vertical || { kind: 'command', eyebrow: 'AI Employee command loop', title: 'A calmer way to run enquiries', steps: ['Understand', 'Qualify', 'Human handoff'], note: 'Approved business context stays central to the next action.' };
  const steps = selected.steps.map(function (label, index) { return '<div class="visual-step ' + (index === 1 ? 'active' : '') + '"><b>0' + (index + 1) + '</b><span>' + escapeHtml(label) + '</span></div>'; }).join('<i class="visual-connector"></i>');
  return '<aside class="route-visual route-' + escapeHtml(selected.kind) + '" aria-label="' + escapeHtml(selected.eyebrow) + '"><div class="visual-top"><span>' + escapeHtml(selected.eyebrow) + '</span><i></i><i></i><i></i></div><h3>' + escapeHtml(selected.title) + '</h3><div class="visual-flow">' + steps + '</div><p class="visual-note">' + escapeHtml(selected.note) + '</p></aside>';
}
function stripTags(value) {
  return String(value || '').replace(/<[^>]*>/g, '');
}

function marketingSiteHTML(path) {
  const pages = {
    '/': {
      eyebrow: 'Official WhatsApp Cloud API · Managed deployment',
      title: 'Your WhatsApp can do more than reply. <em>It can work.</em>',
      intro: 'Maqtomate gives your business a managed WhatsApp AI Employee that answers enquiries, understands voice notes, qualifies leads, prepares human handoff, and keeps operations visible.',
      label: 'The managed WhatsApp AI Employee',
      modules: ['Reply with business context', 'Understand voice notes', 'Qualify every serious enquiry', 'Escalate with conversation context', 'Keep operations visible'],
      kicker: 'Every conversation becomes a clearer next action.'
    },
    '/product': {
      eyebrow: 'Product',
      title: 'One AI Employee. <em>Five operational jobs.</em>',
      intro: 'Maqtomate is designed around the work your team repeats every day: answer, understand, qualify, route, and report. It is not a generic chatbot builder.',
      label: 'The Maqtomate operating loop',
      modules: ['Customer message enters WhatsApp', 'AI uses approved business context', 'Lead context is captured consistently', 'Complex cases reach a human', 'Tenant-isolated operations stay reportable'],
      kicker: 'Designed for repeatable customer work, not one-off replies.'
    },
    '/how-it-works': {
      eyebrow: 'How it works',
      title: 'A managed launch path. <em>No developer dashboard for your team.</em>',
      intro: 'Maqtomate manages the technical connection process so your business team can focus on brand rules, customer experience, and escalation decisions.',
      label: 'A controlled four-stage rollout',
      modules: ['Map customer journey and handoff rules', 'Prepare approved knowledge and guardrails', 'Run a supervised official-API test', 'Activate after readiness review'],
      kicker: 'Your staff are not asked for Meta API keys, webhook URLs, passwords, or OTPs.'
    },
    '/pricing': {
      eyebrow: 'Pricing approach',
      title: 'Pay for a managed system, <em>not an abandoned automation.</em>',
      intro: 'Start with a managed rollout that matches your business journey. Every activation remains supervised and owner-reviewed; Maqtomate does not promise instant self-service connection.',
      label: 'Choose the managed rollout that fits your team',
      modules: ['Managed Launch', 'Custom business rollout', 'What every rollout includes', 'Activation boundary'],
      details: [
        'Rs 5,000 setup and Rs 2,000 monthly for a small-business official rollout: approved knowledge, qualification rules, human handoff design, and a supervised readiness test.',
        'Quoted after review for higher volume, additional languages, complex workflows, or a separately approved integration requirement.',
        'Every plan begins with the customer journey, approved business context, lead fields, escalation policy, and a supervised official connection review. Each client uses their own official business assets; Maqtomate never uses the owner’s personal Meta or WhatsApp account for a client.',
        'Payment starts a managed review. It does not promise an instant bot, self-service Meta connection, voice calling, social automation, owner-account sharing, or unverified integration.'
      ],
      kicker: 'Request a rollout plan before committing to activation.'
    },
    '/security': {
      eyebrow: 'Security and trust',
      title: 'Customer conversations are a business system. <em>We treat them like one.</em>',
      intro: 'Maqtomate is designed for tenant isolation, encrypted server-side credential handling, role-based access, and official API operation.',
      label: 'Built-in trust boundaries',
      modules: ['Official Meta WhatsApp Cloud API only', 'Encrypted server-side tenant credentials', 'Tenant-scoped dashboards', 'Auditable sensitive actions', 'No QR-session automation'],
      kicker: 'Security is part of the operating model, not an add-on.'
    },
    '/resources': {
      eyebrow: 'Resources',
      title: 'Build a stronger WhatsApp customer journey. <em>One useful decision at a time.</em>',
      intro: 'Maqtomate resources cover official WhatsApp onboarding, AI Employee workflows, voice-note operations, lead qualification, and human handoff design.',
      label: 'Content clusters in development',
      modules: ['AI Employee guides', 'Voice-note operations', 'Lead qualification templates', 'Industry conversation design', 'Official API readiness checklists'],
      kicker: 'Useful operational education—not recycled chatbot content.'
    },
    '/connect': {
      eyebrow: 'Managed connection',
      title: 'Connect WhatsApp without turning your team into <em>Meta developers.</em>',
      intro: 'Maqtomate uses a managed and approval-led connection journey. Your team provides business context and decision rules—not tokens, webhooks, passwords, or personal WhatsApp access.',
      label: 'What happens after you request a rollout',
      modules: ['Workflow and use-case review', 'Official connection eligibility review', 'Knowledge and escalation design', 'Supervised conversation test', 'Tenant activation after approval'],
      kicker: 'Self-serve connection will be published only after Meta Embedded Signup is implemented and verified.'
    },
    '/use-cases': {
      eyebrow: 'Use cases',
      title: 'The AI Employee adapts to the work <em>behind the enquiry.</em>',
      intro: 'Every industry has a different qualification path. Maqtomate starts with the information your team needs to make the next human decision faster.',
      label: 'Start with a conversation your team already repeats',
      modules: ['Real estate enquiry context', 'Clinic enquiry routing', 'Salon booking preparation', 'Education lead qualification', 'E-commerce exception handoff'],
      kicker: 'Use-case workflows are configured around your approved customer journey.'
    },
    '/use-cases/real-estate': verticalPage('Real estate', 'Capture location, property type, budget range, and visit timing before your team steps in.', ['Property enquiry triage', 'Budget and location context', 'Site-visit preparation', 'Agent handoff with history']),
    '/use-cases/clinics': verticalPage('Clinics', 'Prepare enquiry context and route the right next step without replacing professional judgement.', ['Service and availability questions', 'Appointment preparation', 'Consent-aware context', 'Staff handoff for complex cases']),
    '/use-cases/salons': verticalPage('Salons', 'Give clients fast answers about services and help staff prepare a smoother booking handoff.', ['Service discovery', 'Availability context', 'Repeat-question automation', 'Team follow-up preparation']),
    '/use-cases/education': verticalPage('Education', 'Qualify programme interest before a counsellor invests time in a detailed conversation.', ['Course and intake questions', 'Eligibility context', 'Counsellor routing', 'Follow-up visibility']),
    '/use-cases/ecommerce': verticalPage('E-commerce', 'Handle product questions with business context, then hand exceptions to a human team with the conversation intact.', ['Product enquiry support', 'Order context workflows', 'Recommendation guardrails', 'Human exception routing'])
  };
  const page = pages[path] || pages['/'];
  const cards = page.modules.map((item, index) => `<article class="cap"><span>0${index + 1}</span><h3>${escapeHtml(item)}</h3><p>${escapeHtml(page.details?.[index] || capabilityDetail(index))}</p></article>`).join('');
  const useCases = `<a href="/use-cases/real-estate">Real estate</a><a href="/use-cases/clinics">Clinics</a><a href="/use-cases/salons">Salons</a><a href="/use-cases/education">Education</a><a href="/use-cases/ecommerce">E-commerce</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#07111d"><meta name="description" content="Maqtomate is a managed WhatsApp AI Employee for official Meta Cloud API customer conversations, voice-note operations, lead qualification and supervised human handoff."><title>${escapeHtml(stripTags(page.title))} — Maqtomate</title><style>
    :root{--bg:#07111d;--panel:#0d1726;--ink:#edf6fb;--muted:#9badc1;--line:#ffffff17;--mint:#8ff3d8;--mint2:#2bd5b6}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 8% 0,#13405577,transparent 31%),radial-gradient(circle at 92% 18%,#0e725d33,transparent 24%),var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.nav{position:sticky;top:0;z-index:10;border-bottom:1px solid var(--line);background:#07111de8;backdrop-filter:blur(16px)}.navin,.wrap{max-width:1180px;margin:auto;padding:0 22px}.navin{height:70px;display:flex;align-items:center;justify-content:space-between;gap:18px}.brand{display:flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font-weight:850;letter-spacing:-.04em}.mark{display:grid;place-items:center;width:29px;height:29px;border-radius:9px;background:linear-gradient(135deg,#b7f8e0,#39d9bd);color:#063127;font-size:12px}.navlinks{display:flex;gap:18px;align-items:center}.navlinks a{color:#b5c3d2;text-decoration:none;font-size:13px;font-weight:650}.navlinks a:hover{color:#fff}.navcta,.button{display:inline-flex;align-items:center;justify-content:center;border-radius:10px;background:linear-gradient(135deg,#9af4db,#31d8bb);color:#063127;text-decoration:none;font-size:13px;font-weight:850;padding:11px 15px;box-shadow:0 9px 26px #21d4b025}.hero{position:relative;overflow:hidden;padding:clamp(66px,12vw,142px) 0 74px}.hero:after{content:"";position:absolute;right:-110px;top:54px;width:430px;height:430px;border-radius:999px;border:1px solid #a9f9e21d;box-shadow:0 0 0 48px #8ff3d805,0 0 0 96px #8ff3d803}.hero-grid{position:relative;z-index:1;display:grid;grid-template-columns:1.08fr .92fr;gap:46px;align-items:center}.eyebrow{color:var(--mint);font-size:10px;font-weight:850;letter-spacing:.16em;text-transform:uppercase}.hero h1{max-width:720px;margin:15px 0 0;font-size:clamp(46px,7vw,82px);line-height:.93;letter-spacing:-.075em}.hero h1 em{font-style:normal;color:var(--mint)}.hero p{max-width:610px;margin:22px 0 0;color:#b2c0d0;line-height:1.65;font-size:16px}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:27px}.ghost{display:inline-flex;align-items:center;justify-content:center;border:1px solid #8ff3d84b;border-radius:10px;color:#cbfff1;text-decoration:none;font-size:13px;font-weight:800;padding:11px 15px;background:#36dfbd0d}.trustline{display:flex;flex-wrap:wrap;gap:8px;margin-top:21px}.trustline span{border:1px solid #ffffff1a;border-radius:999px;color:#a9bdca;padding:6px 9px;background:#0e1c2c8c;font-size:10px;font-weight:700}.product-card{position:relative;border:1px solid #7ef0d93d;border-radius:22px;padding:18px;background:linear-gradient(145deg,#11263a,#091320);box-shadow:0 25px 65px #0008}.window{border:1px solid #ffffff12;border-radius:15px;background:#06101b;overflow:hidden}.windowbar{display:flex;justify-content:space-between;padding:11px 13px;border-bottom:1px solid #ffffff12;color:#93a7bb;font-size:10px}.dots i{display:inline-block;width:6px;height:6px;border-radius:50%;margin-left:4px;background:#ffcb6b}.thread{padding:15px;display:grid;gap:10px}.bubble{max-width:88%;border-radius:11px;padding:11px 12px;color:#b9c9d8;font-size:11px;line-height:1.45;background:#15253a}.bubble.you{margin-left:auto;background:#166f60;color:#d6fff5}.flow{display:grid;gap:9px;margin-top:13px}.flow div{display:flex;align-items:center;gap:9px;border:1px solid #ffffff10;border-radius:9px;padding:9px;color:#a8bacb;font-size:10px}.flow b{display:grid;place-items:center;width:19px;height:19px;border-radius:6px;background:#8ef2d630;color:#a4fee4;font-size:9px}.section{padding:78px 0;border-top:1px solid var(--line)}.section h2{max-width:760px;margin:12px 0 0;font-size:clamp(30px,5vw,54px);line-height:1;letter-spacing:-.06em}.section>p{max-width:680px;color:#9fb0c3;line-height:1.65}.capgrid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-top:28px}.cap{min-height:180px;border:1px solid var(--line);border-radius:15px;padding:17px;background:linear-gradient(145deg,#101d2f,#0a1421)}.cap>span{color:#83f2d7;font-size:10px;font-weight:800;letter-spacing:.1em}.cap h3{margin:26px 0 7px;font-size:15px;line-height:1.18;letter-spacing:-.025em}.cap p{margin:0;color:#7f93a9;font-size:11px;line-height:1.55}.proof{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:stretch}.proof article{border:1px solid var(--line);border-radius:18px;padding:24px;background:#0b1624}.proof h3{margin:0;font-size:22px;letter-spacing:-.04em}.proof p{color:#9eb0c1;line-height:1.6;font-size:13px}.list{display:grid;gap:10px;margin-top:17px}.list div{display:flex;gap:9px;color:#c7d5e2;font-size:12px;line-height:1.45}.list i{display:grid;place-items:center;flex:0 0 19px;height:19px;border-radius:6px;background:#4de2bf1b;color:#9effe4;font-style:normal;font-size:10px}.usecases{display:flex;flex-wrap:wrap;gap:9px;margin-top:22px}.usecases a{border:1px solid #ffffff1c;border-radius:999px;padding:8px 11px;color:#c4d2df;text-decoration:none;font-size:11px;font-weight:700}.usecases a:hover{border-color:#8ff3d870;color:#baffea}.cta{margin:0 0 80px;border:1px solid #8ff3d83a;border-radius:23px;padding:clamp(25px,6vw,58px);background:radial-gradient(circle at 90% 10%,#47e6c528,transparent 28%),linear-gradient(135deg,#10263a,#0b1523)}.cta h2{max-width:760px;margin:10px 0 0;font-size:clamp(30px,5vw,56px);line-height:.98;letter-spacing:-.06em}.cta p{max-width:660px;color:#aac0cf;line-height:1.6}.footer{border-top:1px solid var(--line);padding:32px 0 44px;color:#71859b;font-size:11px}.footerin{max-width:1180px;margin:auto;padding:0 22px;display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap}.footer a{color:#9fb5c5;text-decoration:none;margin-left:12px}.route-visual{position:relative;min-height:360px;border:1px solid #7ef0d955;border-radius:22px;padding:18px;background:radial-gradient(circle at 80% 18%,#3be5c82c,transparent 25%),linear-gradient(145deg,#10263a,#091320);box-shadow:0 25px 65px #0008;overflow:hidden}.route-visual:after{content:"";position:absolute;width:250px;height:250px;border:1px solid #8ff3d820;border-radius:50%;right:-120px;bottom:-110px;box-shadow:0 0 0 34px #8ff3d806,0 0 0 68px #8ff3d804}.visual-top{display:flex;align-items:center;gap:6px;border-bottom:1px solid #ffffff12;padding:1px 0 12px;color:#94aabd;font-size:10px;letter-spacing:.04em}.visual-top span{margin-right:auto}.visual-top i{width:6px;height:6px;border-radius:50%;background:#f2c86d}.route-visual h3{position:relative;z-index:1;max-width:340px;margin:21px 0 18px;font-size:27px;line-height:1.03;letter-spacing:-.055em}.visual-note{position:relative;z-index:1;margin:17px 0 0;color:#9fb6c4;font-size:11px;line-height:1.55}.visual-flow{position:relative;z-index:1;display:grid;gap:9px}.visual-connector{display:block;height:10px;width:1px;margin-left:20px;background:linear-gradient(#8ff3d8,#8ff3d822)}.visual-step{display:flex;align-items:center;gap:9px;border:1px solid #ffffff12;border-radius:11px;background:#07121eee;padding:12px;color:#aebfcb;font-size:11px}.visual-step.active{border-color:#8ff3d872;background:#176e5b3b;color:#d6fff4}.visual-step b{display:grid;place-items:center;flex:0 0 22px;height:22px;border-radius:7px;background:#8ff3d822;color:#9affdf;font-size:9px}.route-security .visual-flow{gap:7px}.route-security .visual-step{padding:10px}.route-resources .visual-flow{grid-template-columns:1fr 1fr}.route-resources .visual-connector{display:none}.route-pricing .visual-step.active{background:#176e5b44}.route-command .visual-step:first-child{margin-left:10px}.route-command .visual-step:last-child{margin-left:30px}@media(prefers-reduced-motion:no-preference){.route-visual .visual-step.active{animation:maqtomateGlow 4.6s ease-in-out infinite}}@keyframes maqtomateGlow{50%{transform:translateX(3px);border-color:#b9ffe8}}@media(max-width:900px){.hero-grid,.proof{grid-template-columns:1fr}.product-card{max-width:600px}.capgrid{grid-template-columns:repeat(2,minmax(0,1fr))}.navlinks{display:none}}@media(max-width:520px){.navin,.wrap{padding-left:15px;padding-right:15px}.navin{height:62px}.navcta{padding:9px 10px;font-size:11px}.hero{padding:58px 0}.hero h1{font-size:44px}.capgrid{grid-template-columns:1fr}.section{padding:55px 0}.cta{margin-bottom:55px}.footerin{padding:0 15px}}
  </style></head><body><header class="nav"><div class="navin"><a class="brand" href="/"><span class="mark">M</span>Maqtomate</a><nav class="navlinks"><a href="/product">Product</a><a href="/how-it-works">How it works</a><a href="/use-cases">Use cases</a><a href="/pricing">Pricing</a><a href="/security">Security</a><a href="/resources">Resources</a></nav><a class="navcta" href="/pricing">View plans</a></div></header><main><section class="hero"><div class="wrap hero-grid"><div><span class="eyebrow">${escapeHtml(page.eyebrow)}</span><h1>${page.title}</h1><p>${escapeHtml(page.intro)}</p><div class="actions"><a class="button" href="/connect">Plan your AI Employee</a><a class="ghost" href="/how-it-works">See the managed workflow</a></div><div class="trustline"><span>Official Meta Cloud API only</span><span>Tenant-isolated operations</span><span>Human handoff built in</span></div></div>${routeVisual(path)}</div></section><section class="section"><div class="wrap"><span class="eyebrow">${escapeHtml(page.label)}</span><h2>${escapeHtml(page.kicker)}</h2><p>Maqtomate is built around the work that should happen after a customer message arrives. Every public claim is tied to an implemented or supervised capability—not a generic automation promise.</p><div class="capgrid">${cards}</div></div></section><section class="section"><div class="wrap proof"><article><span class="eyebrow">The customer journey</span><h3>From conversation to a decision your team can use.</h3><div class="list"><div><i>01</i><span>Customer messages or voice notes begin the interaction.</span></div><div><i>02</i><span>Approved business context shapes the response.</span></div><div><i>03</i><span>Useful qualification details prepare the right next step.</span></div><div><i>04</i><span>Complex cases hand over with conversation history.</span></div></div></article><article><span class="eyebrow">Managed connection</span><h3>Your team should run the business, not the developer dashboard.</h3><p>Maqtomate’s rollout keeps credentials, tokens, webhook configuration, and technical controls out of the customer’s day-to-day workflow.</p><div class="list"><div><i>✓</i><span>No customer API tokens or developer credentials requested.</span></div><div><i>✓</i><span>Personal WhatsApp numbers are not business sender defaults.</span></div><div><i>✓</i><span>Official API and supervised activation remain at the core.</span></div></div></article></div></section><section class="section"><div class="wrap"><span class="eyebrow">Built around real teams</span><h2>Choose the enquiry your business cannot afford to lose.</h2><p>Use-case workflows start with the details a human team needs next. They are configured around your rules, not copied from another business.</p><div class="usecases">${useCases}</div></div></section><section class="wrap cta"><span class="eyebrow">Ready to make WhatsApp operational?</span><h2>Design the AI Employee your team can supervise with confidence.</h2><p>Start with your customer journey, knowledge sources, escalation rules, and the business outcome you want to protect.</p><div class="actions"><a class="button" href="/connect">Plan a managed rollout</a><a class="ghost" href="/login">Secure portal sign-in</a></div></section></main><footer class="footer"><div class="footerin"><span>© ${new Date().getFullYear()} Maqtomate · Managed WhatsApp AI Employee</span><span><a href="/pricing">Pricing</a><a href="/security">Security</a><a href="/resources">Resources</a><a href="/login">Sign in</a></span></div></footer></body></html>`;
}

function connectIntakeHTML() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#07111d"><title>Plan your AI Employee — Maqtomate</title><style>:root{--bg:#07111d;--line:#ffffff18;--ink:#eff8fc;--muted:#9dafc1;--mint:#8ff3d8}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 10% 0,#13475b7a,transparent 34%),var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.nav,.main{max-width:1000px;margin:auto;padding-left:20px;padding-right:20px}.nav{height:70px;display:flex;align-items:center;justify-content:space-between}.brand{color:#fff;text-decoration:none;font-weight:850;letter-spacing:-.04em;display:flex;align-items:center;gap:9px}.mark{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:linear-gradient(135deg,#b7f8e0,#39d9bd);color:#063127;font-size:11px}.back{color:#baffea;text-decoration:none;font-size:12px;font-weight:750}.main{padding-top:44px;padding-bottom:72px}.eyebrow{color:var(--mint);font-size:10px;letter-spacing:.16em;font-weight:850;text-transform:uppercase}.main h1{max-width:720px;margin:13px 0;font-size:clamp(38px,7vw,70px);line-height:.93;letter-spacing:-.07em}.main h1 em{font-style:normal;color:var(--mint)}.intro{max-width:660px;color:#afbfce;line-height:1.65}.grid{display:grid;grid-template-columns:.85fr 1.15fr;gap:18px;margin-top:36px}.panel{border:1px solid var(--line);border-radius:18px;padding:22px;background:linear-gradient(145deg,#102137,#091422)}.panel h2{margin:0 0 10px;font-size:18px}.panel p,.panel li{color:#9cafc2;font-size:12px;line-height:1.6}.panel ul{padding-left:19px}.panel li+li{margin-top:8px}form{display:grid;gap:12px}.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}label{display:grid;gap:6px;color:#c9d7e2;font-size:11px;font-weight:750}input,select,textarea{width:100%;border:1px solid #ffffff1c;border-radius:10px;background:#050d17;color:#f4fbff;padding:11px 12px;font:inherit;font-size:13px;outline:0}textarea{min-height:118px;resize:vertical}input:focus,select:focus,textarea:focus{border-color:#8ff3d87a;box-shadow:0 0 0 3px #38e3c114}.consent{display:flex;align-items:flex-start;gap:8px;color:#91a5b8;font-size:11px;line-height:1.45}.consent input{width:auto;margin-top:2px}.button{border:0;border-radius:10px;background:linear-gradient(135deg,#9af4db,#31d8bb);color:#063127;font:inherit;font-size:13px;font-weight:850;padding:12px 15px;cursor:pointer}.note{min-height:24px;color:#9ff6de;font-size:12px;line-height:1.5}.privacy{margin-top:14px;color:#72879c;font-size:10px;line-height:1.55}@media(max-width:720px){.grid,.two{grid-template-columns:1fr}.main{padding-top:22px}.main h1{font-size:44px}}</style></head><body><header class="nav"><a class="brand" href="/"><span class="mark">M</span>Maqtomate</a><a class="back" href="/">Back to overview</a></header><main class="main"><span class="eyebrow">Managed rollout request</span><h1>Plan the AI Employee your team can <em>actually supervise.</em></h1><p class="intro">Tell us about the customer journey you want to improve. We review the workflow before any WhatsApp connection step. You will never be asked to submit Meta tokens, webhook URLs, passwords, OTPs, or a personal WhatsApp number here.</p><div class="grid"><aside class="panel"><h2>What happens next</h2><ul><li>We review the conversation and handoff workflow.</li><li>We confirm official connection eligibility and number strategy.</li><li>We define knowledge, escalation, and team-visibility boundaries.</li><li>We arrange a supervised test before activation.</li></ul><p class="privacy">This form collects business planning information only. It does not create an account or connect a WhatsApp number.</p></aside><section class="panel"><h2>Request a rollout review</h2><form id="rollout-form"><div class="two"><label>Business name<input name="business_name" required minlength="2" maxlength="120" autocomplete="organization"></label><label>Work email<input name="email" type="email" required autocomplete="email"></label></div><div class="two"><label>Country or region<input name="country" required minlength="2" maxlength="80" autocomplete="country-name"></label><label>Website<input name="website" type="url" maxlength="2048" placeholder="https://example.com"></label></div><div class="two"><label>Primary workflow<select name="use_case" required><option value="sales">Sales and lead qualification</option><option value="support">Customer support</option><option value="appointments">Appointments and bookings</option><option value="ecommerce">E-commerce enquiries</option><option value="education">Education enquiries</option><option value="real_estate">Real estate enquiries</option><option value="other">Other workflow</option></select></label><label>Monthly WhatsApp volume<select name="monthly_message_band" required><option value="under_500">Under 500</option><option value="500_2000">500–2,000</option><option value="2000_10000">2,000–10,000</option><option value="10000_plus">10,000+</option><option value="unsure">Not sure yet</option></select></label></div><label>What should the AI Employee handle?<textarea name="details" required minlength="10" maxlength="1600" placeholder="For example: answer service questions, collect budget and location, then hand qualified enquiries to a sales representative."></textarea></label><label class="consent"><input name="consent" type="checkbox" required>I agree that Maqtomate may use this business information to review and respond to my rollout request.</label><button class="button" type="submit">Request rollout review</button><div class="note" id="note" aria-live="polite"></div></form></section></div></main><script>const form=document.querySelector('#rollout-form'),note=document.querySelector('#note');form.addEventListener('submit',async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;note.textContent='Submitting your request…';const f=new FormData(form);const body=Object.fromEntries(f.entries());body.consent=f.get('consent')==='on';try{const r=await fetch('/api/public/rollout-requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();note.textContent=d.message||'Your request has been received.';if(r.ok)form.reset()}catch{note.textContent='Unable to submit right now. Please try again.'}finally{button.disabled=false}});</script></body></html>`;
}

function ownerConsoleLegacyHTML(user, overview, testTenant) {
  const safeName = escapeHtml(user.display_name || user.email);
  const metric = value => Number(value || 0).toLocaleString('en-PK');
  const attachAction = testTenant && testTenant.phone_status !== 'FOUND'
    ? `<form method="post" action="/owner/test-tenant/attach-maqtomate-test-sender"><button type="submit">Attach Maqtomate-owned test sender</button></form>`
    : '';
  const credentialAction = testTenant && testTenant.phone_status === 'FOUND' && testTenant.token_status !== 'VALID'
    ? `<form method="post" action="/owner/test-tenant/validate-saved-credential"><button type="submit">Check saved bot credential</button></form>`
    : '';
  const renewalAction = testTenant && testTenant.phone_status === 'FOUND' && testTenant.token_status !== 'VALID'
    ? `<form method="post" action="/owner/test-tenant/renew-meta-token" autocomplete="off"><label for="meta-access-token">Renew dedicated test credential</label><input id="meta-access-token" name="meta_access_token" type="password" autocomplete="off" spellcheck="false" minlength="30" maxlength="4096" required><button type="submit">Validate and securely save new Meta token</button><p class="muted">The value is masked and used once. It is validated and encrypted server-side, never displayed again.</p></form>`
    : '';
  const tenantStatus = testTenant
    ? `<section class="card"><div class="eyebrow">OWNER TEST TENANT</div><h2>${escapeHtml(testTenant.business_name)}</h2><p class="success">Payment exempt · Active · Customer-equivalent test workspace</p><dl><div><dt>Connection</dt><dd>${escapeHtml(testTenant.connection_status || 'NOT_CONNECTED')}</dd></div><div><dt>Webhook</dt><dd>${escapeHtml(testTenant.webhook_status || 'NOT_CONFIGURED')}</dd></div><div><dt>Sender phone</dt><dd>${escapeHtml(testTenant.phone_status || 'NOT_FOUND')}</dd></div><div><dt>Token state</dt><dd>${escapeHtml(testTenant.token_status || 'NOT_AVAILABLE')}</dd></div></dl><p class="muted">No personal WhatsApp number, token, or secret is displayed or returned by this console. The credential check validates only the encrypted server-side Maqtomate test credential before any message can be sent.</p>${attachAction}${credentialAction}${renewalAction}</section>`
    : `<section class="card"><div class="eyebrow">OWNER TEST TENANT</div><h2>Run Maqtomate like your first customer</h2><p>Create one payment-exempt internal tenant. It follows the customer onboarding model but never creates a billing request, uses no customer credential, and never touches your personal WhatsApp number.</p><form method="post" action="/owner/test-tenant/provision"><button type="submit">Create payment-exempt Owner Test Tenant</button></form></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maqtomate Owner Console</title><style>:root{--deep:#062f24;--brand:#10a86f;--soft:#f3f8f6;--ink:#102720;--muted:#547067;--line:#d8e8e1}*{box-sizing:border-box}body{margin:0;background:var(--soft);color:var(--ink);font-family:Inter,system-ui,sans-serif}.bar{padding:16px max(18px,calc((100vw - 1080px)/2));color:#fff;background:linear-gradient(115deg,#063c2c,#0b674b);display:flex;justify-content:space-between;gap:14px;align-items:center}.brand{font-weight:850}.sub{font-size:13px;opacity:.82;margin-left:8px}.out,button{border:0;border-radius:9px;padding:10px 14px;font:inherit;font-weight:760;cursor:pointer}.out{background:#e3f7ee;color:#075e43}.wrap{max-width:1080px;margin:30px auto;padding:0 18px}.hero{margin-bottom:20px}.hero h1{margin:0 0 8px;font-size:clamp(28px,5vw,42px);letter-spacing:-.045em}.hero p,.muted{color:var(--muted);line-height:1.55}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:18px 0}.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px;box-shadow:0 10px 26px #164b3810}.label,.eyebrow{font-size:12px;font-weight:800;color:var(--muted);letter-spacing:.06em}.eyebrow{color:#087950}.value{font-size:28px;font-weight:850;margin-top:7px;letter-spacing:-.04em}h2{margin:8px 0;font-size:22px}button{background:var(--brand);color:#fff;margin-top:8px}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:18px 0}dl div{padding:12px;border:1px solid var(--line);border-radius:10px;background:#fbfdfc}dt{font-size:12px;color:var(--muted)}dd{margin:5px 0 0;font-weight:780;overflow-wrap:anywhere}.success{color:#087950;font-weight:720}@media(max-width:720px){.wrap{margin:20px auto;padding:0 14px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.sub{display:none}dl{grid-template-columns:1fr}}@media(max-width:380px){.grid{grid-template-columns:1fr}}</style></head><body><header class="bar"><div><span class="brand">Maqtomate</span><span class="sub">Owner Console</span></div><form method="post" action="/auth/logout"><button class="out" type="submit">Sign out</button></form></header><main class="wrap"><section class="hero"><div class="eyebrow">OWNER-ONLY CONTROL SURFACE</div><h1>Welcome, ${safeName}</h1><p>This console is server-rendered for reliable mobile access. It shows live fleet data without relying on browser-side dashboard initialization.</p></section><section class="grid"><article class="card"><div class="label">Active customers</div><div class="value">${metric(overview.active_tenants)}</div></article><article class="card"><div class="label">Platform users</div><div class="value">${metric(overview.active_users)}</div></article><article class="card"><div class="label">Monthly revenue</div><div class="value">Rs ${metric(overview.monthly_recurring_revenue)}</div></article><article class="card"><div class="label">Errors — 7 days</div><div class="value">${metric(overview.errors_last_7_days)}</div></article></section>${tenantStatus}</main></body></html>`;
}

function ownerConsoleHTML(user, overview, testTenant, runtimeDiagnostics = { available: false, checks: {} }) {
  const safeName = escapeHtml(user.display_name || user.email);
  const metric = value => Number(value || 0).toLocaleString('en-PK');
  const senderFound = testTenant?.phone_status === 'FOUND';
  const webhookVerified = testTenant?.webhook_status === 'VERIFIED';
  const tokenValid = testTenant?.token_status === 'VALID';
  const stageClass = state => state ? 'stage complete' : 'stage';
  const tokenClass = tokenValid ? 'good' : 'warn';
  const senderAction = testTenant && !senderFound
    ? `<form method="post" action="/owner/test-tenant/attach-maqtomate-test-sender"><button class="primary" type="submit">Attach Maqtomate-owned test sender</button></form>`
    : '';
  const credentialAction = testTenant && senderFound && !tokenValid
    ? `<form method="post" action="/owner/test-tenant/validate-saved-credential"><button class="secondary" type="submit">Check saved credential</button></form>`
    : '';
  const renewalAction = testTenant && senderFound && !tokenValid
    ? `<form class="renewal" method="post" action="/owner/test-tenant/renew-meta-token" autocomplete="off"><label for="meta-access-token">Fresh dedicated sender token</label><input id="meta-access-token" name="meta_access_token" type="password" autocomplete="off" spellcheck="false" minlength="30" maxlength="4096" required placeholder="Paste once — never displayed again"><button class="primary" type="submit">Validate & encrypt token</button><p>Use a new temporary token generated only for the Maqtomate test sender. The browser never receives it after submission.</p></form>`
    : '';
  const diagnosticLabels = {
    database: 'D1 database', kv: 'KV binding', admin_api_key: 'Admin key format', app_secret: 'Meta App Secret',
    master_verify_token: 'Webhook verify token', tenant_encryption_key: 'Vault encryption key', gemini_api_key: 'Gemini API', owner_sender_vault: 'Owner sender vault'
  };
  const healthyDiagnostic = value => ['HEALTHY', 'CONFIGURED', 'FORMAT_VALID', 'REACHABLE', 'STORED_READABLE'].includes(String(value));
  const diagnosticCards = runtimeDiagnostics.available
    ? Object.entries(diagnosticLabels).map(([key, label]) => `<div><span>${label}</span><b class="${healthyDiagnostic(runtimeDiagnostics.checks?.[key]) ? 'ok' : 'attention'}">${escapeHtml(runtimeDiagnostics.checks?.[key] || 'UNAVAILABLE')}</b></div>`).join('')
    : `<div><span>Diagnostic bridge</span><b class="attention">UNAVAILABLE</b></div>`;
  const runtimePanel = `<section class="sender-card" style="margin-top:16px"><div class="section-head"><div><span class="kicker">Runtime credential diagnostics</span><h2>Configuration status, not values</h2></div><span class="pill">Owner-only</span></div><p class="summary">Each check returns a coarse runtime state only. API keys, encrypted token material, secrets, and provider error details never enter this page, browser logs, or audit records.</p><div class="state-grid">${diagnosticCards}</div></section>`;
  const onboardingPanel = `<section class="sender-card" style="margin-top:16px"><div class="section-head"><div><span class="kicker">Customer onboarding review</span><h2>Payment-approved activation queue</h2></div><button class="secondary" type="button" onclick="loadCustomerOnboardingQueue()">Refresh queue</button></div><p class="summary">Customer accounts remain pre-tenant until you approve payment and later attach a real active customer-owned official connection. No owner Meta credential, personal WhatsApp, or secret is assigned to a customer.</p><div id="customer-onboarding-queue" class="state-grid"><div style="grid-column:1/-1"><span>Queue</span><b>Loading secure review queue…</b></div></div><div id="customer-onboarding-note" class="rule"></div></section>`;
  const controlledTestAction = tokenValid ? `<form method="post" action="/owner/test-tenant/send-controlled-test"><button class="secondary" type="submit">Send controlled test to private recipient</button></form>` : '';
  const tenantPanel = testTenant
    ? `<section class="sender-card"><div class="section-head"><div><span class="kicker">Owner test tenant</span><h2>${escapeHtml(testTenant.business_name)}</h2></div><span class="pill ${tokenClass}">${tokenValid ? 'Credential valid' : 'Activation in progress'}</span></div><p class="summary">A payment-exempt, customer-equivalent workspace that lets you run Maqtomate as the first verified customer without touching your personal WhatsApp account.</p><div class="state-grid"><div><span>Dedicated sender</span><b class="${senderFound ? 'ok' : 'attention'}">${escapeHtml(testTenant.phone_status || 'NOT_FOUND')}</b></div><div><span>Webhook route</span><b class="${webhookVerified ? 'ok' : 'attention'}">${escapeHtml(testTenant.webhook_status || 'NOT_CONFIGURED')}</b></div><div><span>Credential vault</span><b class="${tokenClass}">${escapeHtml(testTenant.token_status || 'NOT_AVAILABLE')}</b></div><div><span>Last controlled test</span><b>${testTenant.last_test_at ? 'Recorded' : 'Awaiting test'}</b></div></div><div class="safe-note"><strong>Personal-number boundary</strong><span>Your personal WhatsApp is a private recipient-only test destination. It is never registered, moved, disconnected, or used as an API sender.</span></div><div class="action-stack">${senderAction}${credentialAction}${renewalAction}${controlledTestAction}</div></section>`
    : `<section class="sender-card"><div class="section-head"><div><span class="kicker">Owner test tenant</span><h2>Run Maqtomate as your first customer</h2></div><span class="pill warn">Setup required</span></div><p class="summary">Create one payment-exempt internal workspace. It uses the same controlled customer lifecycle, but does not create a payment request or expose any customer credential.</p><form method="post" action="/owner/test-tenant/provision"><button class="primary" type="submit">Create payment-exempt Owner Test Tenant</button></form></section>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#07111d"><title>Maqtomate Owner Command</title><style>
    :root{--ink:#e8f1f8;--muted:#95a5b9;--dim:#64748b;--line:#ffffff17;--panel:#0d1726;--panel2:#101d2e;--teal:#83f5da;--teal2:#20c99a;--amber:#f6c15d;--bg:#07111d}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 12% 0,#123b4b88,transparent 31%),radial-gradient(circle at 100% 100%,#173b4b66,transparent 32%),var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.topbar{position:sticky;top:0;z-index:10;border-bottom:1px solid var(--line);background:#07111de8;backdrop-filter:blur(18px)}.topbar-inner{max-width:1260px;margin:auto;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;gap:14px}.brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-.035em}.mark{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:linear-gradient(135deg,#a7f3d0,#39d8ba);color:#063028;font-size:12px}.brand small{display:block;color:#7cdac5;font-size:9px;font-weight:750;letter-spacing:.16em;text-transform:uppercase}.signout,button{font:inherit;cursor:pointer}.signout{border:1px solid #7ce1cc44;border-radius:9px;background:#ddfff533;color:#cbfff1;padding:9px 12px;font-size:12px;font-weight:700}.wrap{max-width:1260px;margin:auto;padding:30px 20px 48px}.hero{position:relative;overflow:hidden;border:1px solid #74dec12d;border-radius:22px;padding:clamp(24px,5vw,52px);background:radial-gradient(circle at 90% 10%,#28d8bb28,transparent 28%),linear-gradient(132deg,#11243a,#09121f 70%);box-shadow:0 26px 70px #0005}.hero:after{content:"";position:absolute;right:-75px;bottom:-110px;width:300px;height:300px;border:1px solid #9fffe621;border-radius:999px}.kicker{color:#82f4dc;font-size:10px;font-weight:800;letter-spacing:.15em;text-transform:uppercase}.hero h1{position:relative;max-width:760px;margin:12px 0 0;font-size:clamp(32px,5vw,62px);line-height:.96;letter-spacing:-.07em}.hero h1 em{font-style:normal;color:var(--teal)}.hero p{position:relative;max-width:600px;margin:18px 0 0;color:#aab8c9;line-height:1.65;font-size:14px}.hero-meta{position:relative;display:flex;flex-wrap:wrap;gap:9px;margin-top:25px}.hero-meta span,.pill{display:inline-flex;align-items:center;border:1px solid #7ce1cc33;border-radius:999px;padding:6px 9px;color:#b7f7e7;background:#32dfbd12;font-size:10px;font-weight:750}.pill.warn{border-color:#f6c15d45;background:#f6c15d12;color:#f8d58b}.pill.good{color:#a1f6d8}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0}.metric{border:1px solid var(--line);border-radius:16px;padding:16px;background:linear-gradient(145deg,#122238,#0b1422);box-shadow:0 14px 32px #0003}.metric span{display:flex;justify-content:space-between;color:#8d9db2;font-size:11px}.metric span i{display:block;width:6px;height:6px;border-radius:50%;background:var(--teal);box-shadow:0 0 0 4px #44f2ce12}.metric b{display:block;margin-top:18px;font-size:25px;letter-spacing:-.045em}.metric small{display:block;margin-top:5px;color:#6e8098;font-size:10px}.command-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:16px}.sender-card,.launch-card{border:1px solid var(--line);border-radius:18px;padding:22px;background:linear-gradient(145deg,#101e30,#0a1421);box-shadow:0 18px 45px #0003}.section-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.section-head h2,.launch-card h2{margin:6px 0 0;font-size:20px;letter-spacing:-.035em}.summary{max-width:680px;color:#9cacbf;font-size:13px;line-height:1.6}.state-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:18px 0}.state-grid div{padding:12px;border:1px solid #ffffff12;border-radius:11px;background:#03091450}.state-grid span{display:block;color:#718198;font-size:10px}.state-grid b{display:block;margin-top:5px;color:#dce8f3;font-size:12px;overflow-wrap:anywhere}.ok{color:#8df1d2!important}.attention,.warn{color:#f5ca76!important}.safe-note{display:grid;grid-template-columns:132px 1fr;gap:10px;border-left:2px solid var(--teal2);padding:10px 12px;background:#38e3c10d;color:#91a4b9;font-size:11px;line-height:1.55}.safe-note strong{color:#cbfff0}.action-stack{display:grid;gap:9px;margin-top:18px}.primary,.secondary{border-radius:10px;padding:11px 14px;font-size:12px;font-weight:800}.primary{border:0;background:linear-gradient(135deg,#89f2d7,#2dd7ba);color:#063028}.secondary{border:1px solid #85f1d350;background:#2de4c111;color:#bfffee}.renewal{display:grid;grid-template-columns:1fr auto;gap:8px;border-top:1px solid var(--line);padding-top:16px}.renewal label{grid-column:1/-1;color:#b9c8d8;font-size:11px;font-weight:700}.renewal input{min-width:0;border:1px solid #ffffff1c;border-radius:10px;background:#02081380;color:#fff;padding:11px 12px;font:inherit;font-size:12px;outline:0}.renewal input:focus{border-color:#72efd08c;box-shadow:0 0 0 3px #3be1c116}.renewal p{grid-column:1/-1;margin:0;color:#72839a;font-size:10px;line-height:1.45}.launch-card{position:relative;overflow:hidden}.launch-card:before{content:"";position:absolute;top:0;left:0;width:100%;height:2px;background:linear-gradient(90deg,var(--teal),transparent)}.launch-card p{margin:7px 0 15px;color:#94a5b8;font-size:12px;line-height:1.55}.stages{display:grid;gap:12px}.stage{display:grid;grid-template-columns:24px 1fr;gap:10px;align-items:start}.stage:before{content:"";display:grid;place-items:center;width:21px;height:21px;border-radius:7px;border:1px solid #f4bf6055;background:#f4bf6014;color:#f8d58b;font-size:11px;font-weight:800}.stage:nth-child(1):before{content:"1"}.stage:nth-child(2):before{content:"2"}.stage:nth-child(3):before{content:"3"}.stage:nth-child(4):before{content:"4"}.stage.complete:before{border-color:#78efd077;background:#44e7c41a;color:#9ff8dc}.stage b{display:block;font-size:12px}.stage span{display:block;margin-top:3px;color:#718198;font-size:10px;line-height:1.45}.rule{margin-top:18px;border-top:1px solid var(--line);padding-top:14px;color:#8fa2b6;font-size:11px;line-height:1.55}.rule b{color:#d9e8f4}.fleet-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:16px}.fleet-strip div{border:1px solid #ffffff11;border-radius:12px;padding:13px;background:#07101b80}.fleet-strip span{color:#75869a;font-size:10px}.fleet-strip b{display:block;margin-top:5px;color:#e4f0fb;font-size:16px}@media(max-width:850px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.command-grid{grid-template-columns:1fr}.state-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.fleet-strip{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:520px){.topbar-inner,.wrap{padding-left:14px;padding-right:14px}.hero{padding:23px 20px;border-radius:17px}.metrics{grid-template-columns:1fr}.state-grid,.fleet-strip{grid-template-columns:1fr}.safe-note{grid-template-columns:1fr}.renewal{grid-template-columns:1fr}.renewal .primary{width:100%}.signout{padding:8px 10px}.brand small{display:none}}
  </style></head><body><header class="topbar"><div class="topbar-inner"><div class="brand"><span class="mark">M</span><div>Maqtomate<small>Owner command system</small></div></div><form method="post" action="/auth/logout"><button class="signout" type="submit">Sign out</button></form></div></header><main class="wrap"><section class="hero"><span class="kicker">Restricted production operations</span><h1>Command the <em>AI Employee fleet.</em></h1><p>Live control for tenant readiness, verified automation signals, and the owner-first activation path. All credentials remain encrypted behind server-side boundaries.</p><div class="hero-meta"><span>Owner verified: ${safeName}</span><span>Official Meta Cloud API only</span><span>Mobile-safe server rendering</span></div></section><section class="metrics"><article class="metric"><span>Active tenants<i></i></span><b>${metric(overview.active_tenants)}</b><small>Payment-approved production workspaces</small></article><article class="metric"><span>Platform users<i></i></span><b>${metric(overview.active_users)}</b><small>Owner and approved customer members</small></article><article class="metric"><span>Monthly revenue<i></i></span><b>Rs ${metric(overview.monthly_recurring_revenue)}</b><small>Live tenant monthly fee total</small></article><article class="metric"><span>Errors · 7 days<i></i></span><b>${metric(overview.errors_last_7_days)}</b><small>Operational events requiring review</small></article></section><section class="command-grid">${tenantPanel}<aside class="launch-card"><span class="kicker">Activation sequence</span><h2>Owner-first launch gate</h2><p>Complete this controlled path before any public customer onboarding.</p><div class="stages"><div class="${stageClass(Boolean(testTenant))}"><div><b>Payment-exempt tenant</b><span>${testTenant ? 'Internal customer-equivalent workspace is active.' : 'Create the internal owner workspace first.'}</span></div></div><div class="${stageClass(senderFound && webhookVerified)}"><div><b>Dedicated Maqtomate sender</b><span>${senderFound && webhookVerified ? 'Phone and webhook attachment confirmed.' : 'Use the Maqtomate-owned sender only.'}</span></div></div><div class="${stageClass(tokenValid)}"><div><b>Encrypted Meta credential</b><span>${tokenValid ? 'Stored and validated in the tenant vault.' : 'Fresh token is required before messages can be sent.'}</span></div></div><div class="${stageClass(false)}"><div><b>Controlled WhatsApp proof</b><span>Dedicated sender → Worker → Gemini → private recipient test still requires recorded success.</span></div></div></div><div class="rule"><b>Non-negotiable:</b> Your personal WhatsApp remains a private recipient-only test destination. It is never registered as the business sender.</div></aside></section>${runtimePanel}${onboardingPanel}<section class="fleet-strip"><div><span>Voice notes · 7 days</span><b>${metric(overview.voice_notes_last_7_days)}</b></div><div><span>Follow-ups created</span><b>${metric(overview.follow_ups_created_last_7_days)}</b></div><div><span>Qualified leads</span><b>${metric(overview.qualified_leads_last_7_days)}</b></div><div><span>Enabled workflows</span><b>${metric(overview.enabled_workflows)}</b></div></section></main><script>function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]))}async function ownerPost(url,payload){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload||{})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed');return d}function onboardingLabel(v){return ({managed_launch:'Managed Launch',custom_rollout:'Custom Rollout',customer_byok:'Customer Gemini BYOK',managed_ai:'Managed Gemini allowance'})[v]||v}async function loadCustomerOnboardingQueue(){const box=document.querySelector('#customer-onboarding-queue'),note=document.querySelector('#customer-onboarding-note');box.innerHTML='<div style="grid-column:1/-1"><span>Queue</span><b>Loading secure review queue…</b></div>';try{const r=await fetch('/api/owner/customer-onboarding?status=all'),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Unable to load queue.');const rows=d.onboarding_requests||[];box.innerHTML=rows.length?rows.map(x=>{const controls=x.status==='payment_submitted'?'<button class="primary" type="button" onclick="reviewCustomerOnboarding('+Number(x.id)+',\'approve\')">Approve payment</button> <button class="secondary" type="button" onclick="reviewCustomerOnboarding('+Number(x.id)+',\'reject\')">Reject</button>':(x.status==='connection_pending'||x.status==='connection_ready')?'<button class="primary" type="button" onclick="reviewCustomerOnboarding('+Number(x.id)+',\'activate\')">Activate connected tenant</button> <button class="secondary" type="button" onclick="reviewCustomerOnboarding('+Number(x.id)+',\'reject\')">Reject</button>':'<span class="pill">'+esc(x.status)+'</span>';const readiness=x.readiness_status?(' · readiness: '+esc(x.readiness_status)):' · readiness: not submitted';return '<div style="grid-column:1/-1"><span>'+esc(x.business_name)+' · '+esc(x.email)+'</span><b>'+esc(onboardingLabel(x.requested_offer))+' · '+esc(onboardingLabel(x.requested_ai_mode))+' · '+esc(x.status)+readiness+'</b><div style="margin-top:9px">'+controls+'</div></div>'}).join(''):'<div style="grid-column:1/-1"><span>Queue</span><b>No customer onboarding requests yet.</b></div>';note.textContent='Queue shows no Meta tokens, WhatsApp credentials, passwords, or personal numbers.'}catch(e){box.innerHTML='<div style="grid-column:1/-1"><span>Queue</span><b class="attention">Unable to load review queue.</b></div>';note.textContent=e.message}}async function reviewCustomerOnboarding(id,decision){const note=prompt(decision==='approve'?'Optional owner note:':decision==='activate'?'Optional activation note:':'Reason for rejection (optional):')||'';const payload={note};if(decision==='activate'){const value=prompt('Enter the existing active customer-owned tenant ID. It must match the selected Gemini mode and must never be the Owner Test Tenant.');if(!value)return;payload.tenant_client_id=Number(value)}if(!confirm('Confirm '+decision+' for this customer onboarding request?'))return;try{await ownerPost('/api/owner/customer-onboarding/'+Number(id)+'/'+decision,payload);await loadCustomerOnboardingQueue()}catch(e){document.querySelector('#customer-onboarding-note').textContent=e.message}}loadCustomerOnboardingQueue();</script></body></html>`;
}

function customerWorkspaceHTML(user, memberships) {
  const primary = memberships[0];
  if (!primary) return accountShell('Workspace activation pending', 'Your customer workspace will open only after the protected owner activation process creates an active tenant membership.', `<section class="status"><b>Managed rollout in progress</b><span>Return to your activation command center to review your current permitted action.</span></section><a href="/onboarding" style="color:#79f0c6">Open activation command center</a>`);
  const business = escapeHtml(primary.business_name || 'Your business');
  const memberName = escapeHtml(user.display_name || user.email);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${business} workspace — Maqtomate</title><style>:root{--bg:#071a16;--panel:#0d2922;--line:#2d6659;--mint:#62e8b8;--ink:#eef8f4;--muted:#b7d0c8}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% 4%,#1f746044,transparent 27%),var(--bg);color:var(--ink);font:15px Inter,system-ui,sans-serif}.bar{padding:15px max(20px,calc((100vw - 1140px)/2));border-bottom:1px solid #24594b;display:flex;justify-content:space-between;gap:12px;align-items:center}.brand{font-weight:800;letter-spacing:-.03em}.brand small{display:block;color:var(--mint);font-size:10px;letter-spacing:.1em;text-transform:uppercase}.out{background:#173c32;border:1px solid #3e7667;color:#dffbed;padding:9px 12px;border-radius:9px;font-weight:700}.shell{max-width:1140px;margin:auto;padding:28px 20px}.hero,.card{border:1px solid var(--line);border-radius:18px;background:linear-gradient(145deg,#10352b,#0a201a);box-shadow:0 18px 48px #0004}.hero{padding:30px;display:grid;grid-template-columns:1fr auto;gap:18px}.eyebrow{color:var(--mint);font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.hero h1{margin:8px 0;font-size:clamp(28px,5vw,48px);letter-spacing:-.06em}.hero p{max-width:600px;color:var(--muted);line-height:1.6}.pill{align-self:start;border:1px solid #62e8b866;background:#62e8b815;color:#a6f7d9;border-radius:999px;padding:7px 10px;font-weight:800;font-size:11px}.grid{display:grid;grid-template-columns:1.15fr .85fr;gap:16px;margin-top:16px}.card{padding:22px}.card h2{margin:5px 0 8px;font-size:20px}.card p{color:var(--muted);line-height:1.55}.steps{display:grid;gap:10px;margin-top:18px}.step{display:grid;grid-template-columns:28px 1fr;gap:10px;padding:10px;border-radius:11px;background:#06130f99}.step i{display:grid;place-items:center;width:24px;height:24px;border-radius:8px;background:#1a4b3f;color:var(--mint);font-style:normal;font-weight:900}.step b{display:block}.step small{display:block;margin-top:3px;color:#9fc0b5}.nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.nav span{padding:9px 11px;border-radius:9px;border:1px solid #326c5d;color:#bcecdf;font-size:12px;font-weight:700}.nav span.active{background:#17a673;color:#062319;border-color:#17a673}.note{margin-top:16px;border-left:2px solid #62e8b8;padding:10px 12px;background:#062b22;color:#b7d0c8;line-height:1.55;font-size:13px}@media(max-width:700px){.hero,.grid{grid-template-columns:1fr}.hero{padding:23px}.shell{padding:18px 14px}}</style></head><body><header class="bar"><div class="brand">Maqtomate<small>Customer workspace</small></div><form method="post" action="/auth/logout"><button class="out" type="submit">Sign out</button></form></header><main class="shell"><section class="hero"><div><span class="eyebrow">Official WhatsApp managed workspace</span><h1>${business}</h1><p>Welcome, ${memberName}. This workspace shows only verified activation and operating information for your business. It does not expose owner access, provider credentials, or unverified automation claims.</p></div><span class="pill">Tenant active</span></section><nav class="nav" aria-label="Workspace sections"><span class="active">Overview</span><span>Conversations · pending proof</span><span>Leads · pending activation</span><span>Knowledge · managed setup</span><span>Team & handoff · pending</span><span>Usage & AI mode · server enforced</span></nav><section class="grid"><article class="card"><span class="eyebrow">Your operating profile</span><h2>Managed connection is protected</h2><p>Your tenant is active in the Maqtomate access model. Message processing, approved knowledge, handoff rules and live operational data appear here only after the official WhatsApp connection and safe go-live proof are verified for this business.</p><div class="steps"><div class="step"><i>✓</i><div><b>Tenant membership active</b><small>Your workspace is isolated from every other customer.</small></div></div><div class="step"><i>✓</i><div><b>AI policy selected</b><small>Gemini mode is enforced server-side, never by browser controls.</small></div></div><div class="step"><i>•</i><div><b>Official go-live proof</b><small>Pending a verified WhatsApp connection and controlled test result.</small></div></div></div></article><aside class="card"><span class="eyebrow">Next managed step</span><h2>Activate with evidence</h2><p>Maqtomate will guide the official connection and safe go-live test. Do not enter Meta tokens, app secrets, WhatsApp passwords, OTPs, personal numbers, or Gemini keys in this workspace.</p><div class="note"><strong>Why some areas are pending:</strong> Maqtomate shows conversations, leads, knowledge, team tools and integrations only when the tenant-specific capability is real, authorized and tested—not as an empty demo.</div></aside></section></main></body></html>`;
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
