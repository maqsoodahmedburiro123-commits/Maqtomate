import { hasPlanFeature } from './config/plans.js';
import { FEATURE_KEYS, shouldProcessVoice } from './config/features.js';
import { generateTenantText, transcribeTenantAudio } from './services/ai/router.js';
import { canConsumeTenantUsage, recordTenantUsage } from './services/usage/usage-service.js';

let WorkerEntrypointBase = class {};
try {
  const cloudflareWorkers = await import('cloudflare:workers');
  WorkerEntrypointBase = cloudflareWorkers.WorkerEntrypoint;
} catch (_) {
  // Node regression tests do not provide Cloudflare's runtime-only module.
}

/**
 * Maqtomate AI — Multi-Tenant WhatsApp AI Bot Worker
 * Single Cloudflare Worker that powers ALL clients.
 *
 * BINDINGS REQUIRED (set in Worker → Settings → Bindings):
 *   MAQVORA_DB    — D1 database (run backend/d1-schema.sql first)
 *   MAQVORA_KV    — KV namespace (for conversation memory + rate limit + dedup)
 *
 * SECRETS REQUIRED (set as encrypted secrets in Worker → Settings → Variables):
 *   GEMINI_API_KEY    — Google AI Studio key (shared fallback; clients can override via gemini_api_key column)
 *   ADMIN_API_KEY     — bearer token for /api/* and /admin
 *   MASTER_VERIFY_TOKEN — shared Meta webhook verify token (or per-client via DB)
 *   APP_SECRET        — Meta App Secret; used to verify X-Hub-Signature-256 on every incoming POST
 *
 * SECURITY MODEL:
 *   - Webhook POSTs are verified against Meta's HMAC-SHA256 signature (if APP_SECRET set)
 *   - Rate limited: 20 msgs/60s/number/client via KV counter
 *   - Duplicate-protected: Meta msg IDs are deduped for 24h via KV
 *   - Admin endpoints: bearer-token gated with constant-time compare
 *   - Audit log: every admin mutation goes to D1.audit_logs
 */

async function getOwnerTestTenant(env) {
  return await env.MAQVORA_DB.prepare(`
    SELECT c.id, COALESCE(wc.phone_number_id, c.phone_number_id) AS phone_number_id, c.active
    FROM clients c
    LEFT JOIN tenant_whatsapp_connections wc ON wc.client_id = c.id
    WHERE c.business_name = 'Maqtomate Owner Test Tenant'
    ORDER BY c.id DESC LIMIT 1
  `).first();
}

export class OwnerTestCredentialBridge extends WorkerEntrypointBase {
  async credentialHealth() {
    const auditRequest = new Request('https://maqtomate.internal/owner-test/credential-health');
    const ownerTenant = await getOwnerTestTenant(this.env);
    if (!ownerTenant || Number(ownerTenant.active) !== 1 || !/^\d{8,30}$/.test(String(ownerTenant.phone_number_id || ''))) {
      return { http_status: 409, payload: { success: false, token_status: 'NOT_AVAILABLE' } };
    }
    const storedToken = await getTenantSecret(this.env, ownerTenant.id, 'whatsapp_token');
    if (!storedToken) {
      await this.env.MAQVORA_DB.prepare(`
        UPDATE tenant_whatsapp_connections
        SET token_status = 'NOT_AVAILABLE', last_error_code = 'OWNER_TEST_TOKEN_MISSING', updated_at = datetime('now')
        WHERE client_id = ?
      `).bind(ownerTenant.id).run();
      await writeAuditLog(this.env, auditRequest, 'owner_test.credential_health_checked', ownerTenant.id, { token_status: 'NOT_AVAILABLE' });
      return { http_status: 200, payload: { success: true, token_status: 'NOT_AVAILABLE' } };
    }
    let tokenStatus = 'FAILED';
    let errorCode = 'META_TOKEN_VALIDATION_FAILED';
    try {
      const validation = await fetch(`https://graph.facebook.com/v23.0/${ownerTenant.phone_number_id}?fields=id`, {
        headers: { Authorization: `Bearer ${storedToken}` }
      });
      tokenStatus = validation.ok ? 'VALID' : 'INVALID';
      errorCode = validation.ok ? null : 'META_TOKEN_VALIDATION_FAILED';
    } catch (_) {
      tokenStatus = 'FAILED';
      errorCode = 'META_TOKEN_VALIDATION_UNAVAILABLE';
    }
    await this.env.MAQVORA_DB.prepare(`
      UPDATE tenant_whatsapp_connections
      SET token_status = ?, last_error_code = ?, updated_at = datetime('now')
      WHERE client_id = ?
    `).bind(tokenStatus, errorCode, ownerTenant.id).run();
    await writeAuditLog(this.env, auditRequest, 'owner_test.credential_health_checked', ownerTenant.id, { token_status: tokenStatus });
    return { http_status: 200, payload: { success: true, token_status: tokenStatus } };
  }

  async renewCredential(replacementToken) {
    const auditRequest = new Request('https://maqtomate.internal/owner-test/renew-credential');
    const token = String(replacementToken || '').trim();
    if (token.length < 30 || token.length > 4096) {
      return { http_status: 400, payload: { success: false, token_status: 'INVALID' } };
    }
    const ownerTenant = await getOwnerTestTenant(this.env);
    if (!ownerTenant || Number(ownerTenant.active) !== 1 || !/^\d{8,30}$/.test(String(ownerTenant.phone_number_id || ''))) {
      return { http_status: 409, payload: { success: false, token_status: 'NOT_AVAILABLE' } };
    }
    let limitedScopeTestCredential = false;
    try {
      const validation = await fetch(`https://graph.facebook.com/v23.0/${ownerTenant.phone_number_id}?fields=id`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!validation.ok) {
        const errorPayload = await validation.json().catch(() => null);
        limitedScopeTestCredential = errorPayload?.error?.code === 100 && errorPayload?.error?.error_subcode === 33;
        if (!limitedScopeTestCredential) {
          await writeAuditLog(this.env, auditRequest, 'owner_test.credential_renewal_rejected', ownerTenant.id, { token_status: 'INVALID' });
          return { http_status: 400, payload: { success: false, token_status: 'INVALID' } };
        }
      } else {
        const phoneInfo = await validation.json().catch(() => ({}));
        if (String(phoneInfo.id || '') !== String(ownerTenant.phone_number_id)) {
          await writeAuditLog(this.env, auditRequest, 'owner_test.credential_renewal_rejected', ownerTenant.id, { token_status: 'INVALID' });
          return { http_status: 400, payload: { success: false, token_status: 'INVALID' } };
        }
      }
    } catch (_) {
      return { http_status: 502, payload: { success: false, token_status: 'FAILED' } };
    }
    await putTenantSecret(this.env, ownerTenant.id, 'whatsapp_token', token);
    await this.env.MAQVORA_DB.prepare(`
      UPDATE tenant_whatsapp_connections
      SET token_status = 'VALID', last_error_code = ?, updated_at = datetime('now')
      WHERE client_id = ?
    `).bind(limitedScopeTestCredential ? 'META_TEST_SCOPE_LIMITED' : null, ownerTenant.id).run();
    await writeAuditLog(this.env, auditRequest, 'owner_test.credential_renewed', ownerTenant.id, {
      token_status: 'VALID', limited_scope_test_credential: limitedScopeTestCredential
    });
    return { http_status: 200, payload: { success: true, token_status: 'VALID' } };
  }

  async runtimeDiagnostics() {
    const checks = {
      database: 'UNAVAILABLE',
      kv: this.env.MAQVORA_KV ? 'CONFIGURED' : 'MISSING',
      admin_api_key: this.env.ADMIN_API_KEY && String(this.env.ADMIN_API_KEY).length >= 24 ? 'FORMAT_VALID' : (this.env.ADMIN_API_KEY ? 'FORMAT_INVALID' : 'MISSING'),
      app_secret: this.env.APP_SECRET && String(this.env.APP_SECRET).length >= 16 ? 'CONFIGURED' : (this.env.APP_SECRET ? 'FORMAT_INVALID' : 'MISSING'),
      master_verify_token: this.env.MASTER_VERIFY_TOKEN && String(this.env.MASTER_VERIFY_TOKEN).length >= 16 ? 'CONFIGURED' : (this.env.MASTER_VERIFY_TOKEN ? 'FORMAT_INVALID' : 'MISSING'),
      tenant_encryption_key: 'MISSING',
      gemini_api_key: this.env.GEMINI_API_KEY ? 'CONFIGURED' : 'MISSING',
      owner_sender_vault: 'NOT_AVAILABLE'
    };
    try {
      await this.env.MAQVORA_DB.prepare('SELECT 1 AS healthy').first();
      checks.database = 'HEALTHY';
    } catch (_) {}
    if (this.env.TENANT_DATA_ENCRYPTION_KEY) {
      try {
        checks.tenant_encryption_key = base64ToBytes(this.env.TENANT_DATA_ENCRYPTION_KEY).length === 32 ? 'FORMAT_VALID' : 'FORMAT_INVALID';
      } catch (_) {
        checks.tenant_encryption_key = 'FORMAT_INVALID';
      }
    }
    try {
      const ownerTenant = await getOwnerTestTenant(this.env);
      if (ownerTenant) {
        const storedToken = await getTenantSecret(this.env, ownerTenant.id, 'whatsapp_token');
        checks.owner_sender_vault = storedToken ? 'STORED_READABLE' : 'MISSING';
      }
    } catch (_) {
      checks.owner_sender_vault = 'UNREADABLE';
    }
    if (this.env.GEMINI_API_KEY) {
      try {
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
          headers: { 'x-goog-api-key': this.env.GEMINI_API_KEY }
        });
        checks.gemini_api_key = response.ok ? 'REACHABLE' : 'REJECTED';
      } catch (_) {
        checks.gemini_api_key = 'UNAVAILABLE';
      }
    }
    return { http_status: 200, payload: { success: true, checks } };
  }

  async sendControlledTest() {
    const auditRequest = new Request('https://maqtomate.internal/owner-test/controlled-send');
    const recipient = String(this.env.OWNER_TEST_RECIPIENT_MSISDN || '').replace(/\D/g, '');
    if (!/^\d{8,15}$/.test(recipient)) {
      return { http_status: 409, payload: { success: false, delivery: 'RECIPIENT_NOT_CONFIGURED' } };
    }
    const ownerTenant = await getOwnerTestTenant(this.env);
    if (!ownerTenant || Number(ownerTenant.active) !== 1 || !/^\d{8,30}$/.test(String(ownerTenant.phone_number_id || ''))) {
      return { http_status: 409, payload: { success: false, delivery: 'SENDER_NOT_READY' } };
    }
    const token = await getTenantSecret(this.env, ownerTenant.id, 'whatsapp_token');
    if (!token) return { http_status: 409, payload: { success: false, delivery: 'CREDENTIAL_NOT_AVAILABLE' } };
    try {
      const messageId = await sendWhatsAppText(
        recipient,
        'Maqtomate controlled activation test: your dedicated AI Employee sender is connected.',
        token,
        ownerTenant.phone_number_id
      );
      await this.env.MAQVORA_DB.prepare(`
        UPDATE tenant_whatsapp_connections
        SET last_test_at = datetime('now'), updated_at = datetime('now')
        WHERE client_id = ?
      `).bind(ownerTenant.id).run();
      await writeAuditLog(this.env, auditRequest, 'owner_test.outbound_message_requested', ownerTenant.id, { delivery: 'requested' });
      return { http_status: 200, payload: { success: true, delivery: messageId ? 'REQUESTED' : 'UNKNOWN' } };
    } catch (_) {
      await writeAuditLog(this.env, auditRequest, 'owner_test.outbound_message_failed', ownerTenant.id, { delivery: 'failed' });
      return { http_status: 502, payload: { success: false, delivery: 'FAILED' } };
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    // Only the production Pages site and the secure portal may make browser API calls.
    // Requests without an Origin header (Meta webhooks and server-to-server calls) remain unaffected.
    const origin = request.headers.get('Origin') || '';
    const allowedOrigins = new Set([
      'https://maqtomate.pages.dev',
      'https://maqtomate-portal.moviesmaqxanimation.workers.dev'
    ]);
    const corsHeaders = {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Vary': 'Origin',
    };
    if (origin && allowedOrigins.has(origin)) {
      corsHeaders['Access-Control-Allow-Origin'] = origin;
    }

    if (request.method === 'OPTIONS') {
      if (!origin || !allowedOrigins.has(origin)) return new Response(null, { status: 403, headers: corsHeaders });
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ── INTERNAL OWNER-TEST CREDENTIAL HEALTH ──
    // This path is callable only by the Portal Worker through a dedicated shared secret. It never
    // accepts, returns, logs, or decrypts credentials outside the server runtime; it only validates
    // the already encrypted tenant credential with Meta and returns a coarse readiness state.
    if (path === '/internal/owner-test/credential-health' && request.method === 'POST') {
      const internalToken = request.headers.get('X-Maqtomate-Internal-Token') || '';
      const expectedInternalToken = env.PORTAL_CORE_SHARED_SECRET || '';
      if (!expectedInternalToken || !timingSafeEqual(internalToken, expectedInternalToken)) {
        return new Response('Not found', { status: 404 });
      }

      const ownerTenant = await getOwnerTestTenant(env);
      if (!ownerTenant || Number(ownerTenant.active) !== 1 || !/^\d{8,30}$/.test(String(ownerTenant.phone_number_id || ''))) {
        return jsonResponse({ success: false, token_status: 'NOT_AVAILABLE' }, 409, corsHeaders);
      }

      const storedToken = await getTenantSecret(env, ownerTenant.id, 'whatsapp_token');
      if (!storedToken) {
        await env.MAQVORA_DB.prepare(`
          UPDATE tenant_whatsapp_connections
          SET token_status = 'NOT_AVAILABLE', last_error_code = 'OWNER_TEST_TOKEN_MISSING', updated_at = datetime('now')
          WHERE client_id = ?
        `).bind(ownerTenant.id).run();
        await writeAuditLog(env, request, 'owner_test.credential_health_checked', ownerTenant.id, { token_status: 'NOT_AVAILABLE' });
        return jsonResponse({ success: true, token_status: 'NOT_AVAILABLE' }, 200, corsHeaders);
      }

      let tokenStatus = 'FAILED';
      let errorCode = 'META_TOKEN_VALIDATION_FAILED';
      try {
        const validation = await fetch(`https://graph.facebook.com/v23.0/${ownerTenant.phone_number_id}?fields=id`, {
          headers: { Authorization: `Bearer ${storedToken}` }
        });
        tokenStatus = validation.ok ? 'VALID' : 'INVALID';
        errorCode = validation.ok ? null : 'META_TOKEN_VALIDATION_FAILED';
      } catch (_) {
        // Network/provider failures are intentionally coarse-grained and do not disclose token or provider internals.
        tokenStatus = 'FAILED';
        errorCode = 'META_TOKEN_VALIDATION_UNAVAILABLE';
      }

      await env.MAQVORA_DB.prepare(`
        UPDATE tenant_whatsapp_connections
        SET token_status = ?, last_error_code = ?, updated_at = datetime('now')
        WHERE client_id = ?
      `).bind(tokenStatus, errorCode, ownerTenant.id).run();
      await writeAuditLog(env, request, 'owner_test.credential_health_checked', ownerTenant.id, { token_status: tokenStatus });
      return jsonResponse({ success: true, token_status: tokenStatus }, 200, corsHeaders);
    }

    // ── INTERNAL OWNER-TEST TOKEN RENEWAL ──
    // This authenticated bridge accepts a one-time masked Portal form value, validates it with
    // Meta, then writes only an AES-GCM tenant envelope. It never returns or logs plaintext.
    if (path === '/internal/owner-test/renew-credential' && request.method === 'POST') {
      const internalToken = request.headers.get('X-Maqtomate-Internal-Token') || '';
      const expectedInternalToken = env.PORTAL_CORE_SHARED_SECRET || '';
      if (!expectedInternalToken || !timingSafeEqual(internalToken, expectedInternalToken)) {
        return new Response('Not found', { status: 404 });
      }
      const body = await request.json().catch(() => null);
      const replacementToken = String(body?.meta_access_token || '').trim();
      if (replacementToken.length < 30 || replacementToken.length > 4096) {
        return jsonResponse({ success: false, token_status: 'INVALID' }, 400, corsHeaders);
      }
      const ownerTenant = await getOwnerTestTenant(env);
      if (!ownerTenant || Number(ownerTenant.active) !== 1 || !/^\d{8,30}$/.test(String(ownerTenant.phone_number_id || ''))) {
        return jsonResponse({ success: false, token_status: 'NOT_AVAILABLE' }, 409, corsHeaders);
      }
      let limitedScopeTestCredential = false;
      try {
        const validation = await fetch(`https://graph.facebook.com/v23.0/${ownerTenant.phone_number_id}?fields=id`, {
          headers: { Authorization: `Bearer ${replacementToken}` }
        });
        if (!validation.ok) {
          const errorPayload = await validation.json().catch(() => null);
          limitedScopeTestCredential = errorPayload?.error?.code === 100 && errorPayload?.error?.error_subcode === 33;
          if (!limitedScopeTestCredential) {
            await writeAuditLog(env, request, 'owner_test.credential_renewal_rejected', ownerTenant.id, { token_status: 'INVALID' });
            return jsonResponse({ success: false, token_status: 'INVALID' }, 400, corsHeaders);
          }
        } else {
          const phoneInfo = await validation.json().catch(() => ({}));
          if (String(phoneInfo.id || '') !== String(ownerTenant.phone_number_id)) {
            await writeAuditLog(env, request, 'owner_test.credential_renewal_rejected', ownerTenant.id, { token_status: 'INVALID' });
            return jsonResponse({ success: false, token_status: 'INVALID' }, 400, corsHeaders);
          }
        }
      } catch (_) {
        return jsonResponse({ success: false, token_status: 'FAILED' }, 502, corsHeaders);
      }
      await putTenantSecret(env, ownerTenant.id, 'whatsapp_token', replacementToken);
      await env.MAQVORA_DB.prepare(`
        UPDATE tenant_whatsapp_connections
        SET token_status = 'VALID', last_error_code = ?, updated_at = datetime('now')
        WHERE client_id = ?
      `).bind(limitedScopeTestCredential ? 'META_TEST_SCOPE_LIMITED' : null, ownerTenant.id).run();
      await writeAuditLog(env, request, 'owner_test.credential_renewed', ownerTenant.id, {
        token_status: 'VALID', limited_scope_test_credential: limitedScopeTestCredential
      });
      return jsonResponse({ success: true, token_status: 'VALID' }, 200, corsHeaders);
    }

    // ── OWNER TEST CREDENTIAL HANDOFF (single-use, HTTPS-only) ──
    // This prevents the owner from pasting a Meta access token into chat. The submitted
    // token is validated with Meta, AES-GCM encrypted in the tenant vault, then the link
    // is invalidated. This is intentionally limited to the fixed Meta test number.
    if (path === '/owner-test-connect') {
      const handoffToken = url.searchParams.get('token') || '';
      const expectedHandoffToken = env.OWNER_TEST_HANDOFF_TOKEN || '';
      if (!expectedHandoffToken || !timingSafeEqual(handoffToken, expectedHandoffToken)) {
        return new Response('Not found', { status: 404 });
      }
      const handoffKey = `owner-test-handoff:${await sha256Hex(expectedHandoffToken)}`;
      const used = await env.MAQVORA_KV?.get(handoffKey);
      if (used) return new Response('This secure setup link has already been used.', { status: 410 });

      if (request.method === 'GET') {
        return new Response(ownerTestConnectHtml(), {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store, max-age=0',
            'Referrer-Policy': 'no-referrer',
            'X-Frame-Options': 'DENY',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
          }
        });
      }

      if (request.method === 'POST') {
        try {
          const data = await request.formData();
          const metaAccessToken = String(data.get('meta_access_token') || '').trim();
          if (metaAccessToken.length < 30 || metaAccessToken.length > 4096) {
            return ownerTestConnectError('The access token format is not valid. Return to Meta and generate a new access code.');
          }

          const testPhoneNumberId = String(env.OWNER_TEST_PHONE_NUMBER_ID || '').trim();
          if (!/^\d{8,30}$/.test(testPhoneNumberId)) {
            throw new Error('The dedicated Maqtomate test phone number is not configured.');
          }
          const metaValidation = await fetch(`https://graph.facebook.com/v23.0/${testPhoneNumberId}?fields=id,display_phone_number,status`, {
            headers: { Authorization: `Bearer ${metaAccessToken}` }
          });
          let limitedScopeTestCredential = false;
          if (!metaValidation.ok) {
            let errorPayload = null;
            try { errorPayload = await metaValidation.json(); } catch (_) { /* preserve status-only diagnostic */ }
            const errorCode = errorPayload?.error?.code ?? null;
            const errorSubcode = errorPayload?.error?.error_subcode ?? null;
            await env.MAQVORA_KV?.put('diagnostic:last_owner_test_token_validation', JSON.stringify({
              at: new Date().toISOString(),
              http_status: metaValidation.status,
              meta_error_code: errorCode,
              meta_error_subcode: errorSubcode,
              meta_error_type: errorPayload?.error?.type ?? null
            }), { expirationTtl: 900 });
            // Meta's API Setup temporary credential can send test WhatsApp messages but may not
            // grant read access to the phone-number node. Accept only this known permission-limited
            // response on the owner-only, single-use test path; all invalid/OAuth errors remain rejected.
            limitedScopeTestCredential = errorCode === 100 && errorSubcode === 33;
            if (!limitedScopeTestCredential) {
              return ownerTestConnectError('Meta did not accept this credential. Generate a new access token in API Setup and try again.');
            }
          } else {
            const phoneInfo = await metaValidation.json();
            if (String(phoneInfo.id || '') !== testPhoneNumberId) {
              return ownerTestConnectError('This access token does not belong to the Maqtomate test phone number.');
            }
          }

          const ownerTenant = await getOwnerTestTenant(env);
          if (!ownerTenant) throw new Error('Owner test tenant is unavailable.');
          await env.MAQVORA_DB.prepare(`
            UPDATE clients
            SET business_name = ?, niche = ?, country = ?, phone_number_id = ?, client_mode = 3, active = 1, updated_at = datetime('now')
            WHERE id = ?
          `).bind('Maqtomate Owner Test Tenant', 'AI automation demonstration', 'Pakistan', testPhoneNumberId, ownerTenant.id).run();
          await putTenantSecret(env, ownerTenant.id, 'whatsapp_token', metaAccessToken);
          await env.MAQVORA_DB.prepare(`
            INSERT INTO tenant_ai_provider_settings (client_id, provider_name, model_name, credential_mode, active, validation_status, updated_at)
            VALUES (?, 'gemini', 'gemini-3.6-flash', 'platform_managed', 1, 'valid', datetime('now'))
            ON CONFLICT(client_id) DO UPDATE SET provider_name = excluded.provider_name, model_name = excluded.model_name,
              credential_mode = excluded.credential_mode, active = excluded.active, validation_status = excluded.validation_status,
              updated_at = excluded.updated_at
          `).bind(ownerTenant.id).run();
          await env.MAQVORA_KV?.put(handoffKey, 'used', { expirationTtl: 86400 });
          await writeAuditLog(env, request, 'owner_test.meta_token_configured', ownerTenant.id, { phone_number_id: testPhoneNumberId, limited_scope_test_credential: limitedScopeTestCredential });
          return ownerTestConnectSuccessHtml();
        } catch (err) {
          console.error('[OWNER TEST CONNECT ERROR]', String(err?.message || err));
          return ownerTestConnectError('The secure setup could not be completed. Generate a fresh Meta access code and try once more.');
        }
      }

      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } });
    }

    // ── OWNER TEST META WEBHOOK SUBSCRIPTION SYNC (single-use) ──
    // The callback URL is configured in the Meta dashboard; this server-to-server call
    // subscribes the app to the test WABA so inbound message events reach that callback.
    if (path === '/owner-test-sync' && request.method === 'POST') {
      const syncToken = url.searchParams.get('token') || '';
      const expectedSyncToken = env.OWNER_TEST_SYNC_TOKEN || '';
      if (!expectedSyncToken || !timingSafeEqual(syncToken, expectedSyncToken)) return new Response('Not found', { status: 404 });
      const syncKey = `owner-test-sync:${await sha256Hex(expectedSyncToken)}`;
      if (await env.MAQVORA_KV?.get(syncKey)) return new Response('This one-time sync link has already been used.', { status: 410 });
      let subscriptionStage = 'initialize';
      try {
        const testPhoneNumberId = String(env.OWNER_TEST_PHONE_NUMBER_ID || '').trim();
        const wabaId = String(env.OWNER_TEST_WABA_ID || '').trim();
        if (!/^\d{8,30}$/.test(testPhoneNumberId) || !/^\d{8,30}$/.test(wabaId)) {
          throw new Error('Dedicated Maqtomate test identifiers are not configured.');
        }
        subscriptionStage = 'load_tenant';
        const client = await getOwnerTestTenant(env);
        if (!client || String(client.phone_number_id) !== testPhoneNumberId) throw new Error('Owner test tenant is not ready.');
        subscriptionStage = 'load_encrypted_token';
        const metaAccessToken = await getTenantSecret(env, client.id, 'whatsapp_token');
        if (!metaAccessToken) throw new Error('Owner test token is unavailable.');
        subscriptionStage = 'meta_subscribe_request';
        const subscribeResponse = await fetch(`https://graph.facebook.com/v23.0/${wabaId}/subscribed_apps`, {
          method: 'POST', headers: { Authorization: `Bearer ${metaAccessToken}` }
        });
        if (!subscribeResponse.ok) {
          let errorPayload = null;
          try { errorPayload = await subscribeResponse.json(); } catch (_) { /* status-only diagnostic */ }
          await env.MAQVORA_KV?.put('diagnostic:last_owner_test_subscription', JSON.stringify({
            at: new Date().toISOString(), stage: subscriptionStage, http_status: subscribeResponse.status,
            meta_error_code: errorPayload?.error?.code ?? null,
            meta_error_subcode: errorPayload?.error?.error_subcode ?? null,
            meta_error_type: errorPayload?.error?.type ?? null
          }), { expirationTtl: 900 });
          throw new Error(`Meta subscription request failed (${subscribeResponse.status}).`);
        }
        await env.MAQVORA_KV?.put(syncKey, 'used', { expirationTtl: 86400 });
        await writeAuditLog(env, request, 'owner_test.meta_webhook_subscribed', client.id, { waba_id: wabaId });
        return jsonResponse({ success: true, subscription: 'active' }, 200, corsHeaders);
      } catch (err) {
        const safeReason = String(err?.message || err).replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]').slice(0, 160);
        await env.MAQVORA_KV?.put('diagnostic:last_owner_test_subscription', JSON.stringify({
          at: new Date().toISOString(), stage: subscriptionStage, worker_error: safeReason
        }), { expirationTtl: 900 });
        console.error('[OWNER TEST SYNC ERROR]', safeReason);
        return jsonResponse({ success: false, error: 'Meta test subscription could not be completed.' }, 502, corsHeaders);
      }
    }

    // ── 1. META WEBHOOK VERIFICATION (GET / or /webhook) ──
    if (request.method === 'GET' && (path === '/' || path === '/webhook')) {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      // Accept a master token OR any per-client token in the DB
      if (mode === 'subscribe' && token === env.MASTER_VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 });
      }
      if (mode === 'subscribe' && token && env.MAQVORA_DB) {
        const client = await env.MAQVORA_DB.prepare(
          'SELECT id FROM clients WHERE verify_token = ?'
        ).bind(await sha256Hex(token)).first();
        if (client) return new Response(challenge, { status: 200 });
      }
      return new Response('Forbidden', { status: 403 });
    }

    // ── 2. INCOMING WHATSAPP MESSAGES (POST / or /webhook) ──
    if (request.method === 'POST' && (path === '/' || path === '/webhook')) {
      try {
        // Verify request actually came from Meta (HMAC-SHA256).
        // Without this, anyone who knows your worker URL can POST fake
        // WhatsApp payloads and burn Gemini quota or spoof messages.
        const rawBody = await request.text();
        const signatureHeader = request.headers.get('x-hub-signature-256') || '';
        let diagnosticBody = null;
        try { diagnosticBody = JSON.parse(rawBody); } catch (_) { /* strict verification below still rejects malformed bodies */ }
        if (!env.APP_SECRET) {
          await env.MAQVORA_KV?.put('diagnostic:last_meta_webhook', JSON.stringify({ at: new Date().toISOString(), signature_present: Boolean(signatureHeader), signature_valid: false, reason: 'app_secret_missing' }), { expirationTtl: 900 });
          console.error('[SECURITY ERROR] APP_SECRET is not configured. Rejecting webhook to prevent fail-open vulnerability.');
          return new Response('Forbidden — Server configuration error', { status: 403 });
        }
        const valid = await verifyMetaSignature(rawBody, signatureHeader, env.APP_SECRET);
        await env.MAQVORA_KV?.put('diagnostic:last_meta_webhook', JSON.stringify({
          at: new Date().toISOString(),
          signature_present: Boolean(signatureHeader),
          signature_valid: valid,
          phone_number_id: String(diagnosticBody?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id || ''),
          has_message: Boolean(diagnosticBody?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id)
        }), { expirationTtl: 900 });
        if (!valid) {
          console.error('[SECURITY] Invalid or missing webhook signature');
          return new Response('Forbidden', { status: 403 });
        }

        const body = diagnosticBody || JSON.parse(rawBody);
        const entry = body.entry?.[0];
        const change = entry?.changes?.[0];
        const value = change?.value;
        const msgObj = value?.messages?.[0];
        const phoneNumberId = value?.metadata?.phone_number_id;

        if (!msgObj || !phoneNumberId) return new Response('OK', { status: 200 });
        if (!env.MAQVORA_DB) {
          console.error('[ERROR] D1 database not bound');
          return new Response('OK', { status: 200 });
        }

        // Route to the right client
        const storedClient = await env.MAQVORA_DB.prepare(
          `SELECT c.*, COALESCE(v.voice_notes_enabled, 0) AS voice_notes_enabled,
                  COALESCE(ai.provider_name, 'gemini') AS ai_provider_name,
                  COALESCE(ai.model_name, c.gemini_model, 'gemini-3.6-flash') AS ai_model_name,
                  COALESCE(ai.credential_mode, CASE WHEN c.client_mode = 1 THEN 'tenant_byok' ELSE 'platform_managed' END) AS ai_credential_mode,
                  COALESCE(ai.active, 1) AS ai_provider_active,
                  COALESCE(ai.validation_status, 'unvalidated') AS ai_validation_status
           FROM clients c
           LEFT JOIN tenant_voice_settings v ON v.client_id = c.id
           LEFT JOIN tenant_ai_provider_settings ai ON ai.client_id = c.id
           WHERE c.phone_number_id = ? AND c.active = 1`
        ).bind(phoneNumberId).first();
        if (!storedClient) {
          console.error('[ERROR] No client found for phone_number_id:', phoneNumberId);
          return new Response('OK', { status: 200 });
        }
        const client = await hydrateTenantCredentials(env, storedClient);

        const fromNumber = msgObj.from;
        const msgId = msgObj.id;
        const msgType = msgObj.type;

        // Duplicate protection
        const dupKey = `dup:${client.id}:${msgId}`;
        const exists = await env.MAQVORA_KV?.get(dupKey);
        if (exists) return new Response('OK', { status: 200 });
        await env.MAQVORA_KV?.put(dupKey, '1', { expirationTtl: 86400 });

        // Rate limit (real cost control, not just abuse prevention)
        const rateLimited = await checkRateLimit(env, client.id, fromNumber);
        if (rateLimited) {
          console.error('[RATE LIMIT]', client.id, fromNumber);
          return new Response('OK', { status: 200 });
        }

        // Conversation history
        let history = [];
        const histRaw = await env.MAQVORA_KV?.get(`conv:${client.id}:${fromNumber}`);
        if (histRaw) { try { history = JSON.parse(histRaw); } catch (e) { history = []; } }

        // Parse message. Voice messages are transcribed into text before the tenant AI is asked to respond.
        let userQuery = '';
        let mediaBase64 = null;
        let mediaMimeType = null;
        let voiceNoteId = null;
        let isVoiceNote = false;

        if (msgType === 'text' && msgObj.text?.body) {
          userQuery = msgObj.text.body;
        } else if (msgType === 'audio' && msgObj.audio) {
          isVoiceNote = true;
          if (!shouldProcessVoice(client, env)) {
            const disabledReply = 'Voice-note support is temporarily unavailable. Please send your message as text and our team will assist you.';
            await sendWhatsAppText(fromNumber, disabledReply, client.whatsapp_token, client.phone_number_id);
            await logToD1(env, client.id, fromNumber, 'audio', '[voice_feature_disabled]', disabledReply);
            return new Response('OK', { status: 200 });
          }
          voiceNoteId = await createVoiceNote(env, {
            clientId: client.id,
            whatsappMessageId: msgId,
            fromNumber,
            mediaId: msgObj.audio.id,
            mimeType: msgObj.audio.mime_type || null
          });
          await incrementVoiceMetric(env, client.id, 'voice_notes_received', 1);

          try {
            const media = await downloadWhatsAppMedia(msgObj.audio.id, client.whatsapp_token, 16 * 1024 * 1024);
            if (!media) throw new Error('Voice media could not be downloaded.');
            mediaBase64 = media.base64;
            mediaMimeType = media.mimeType || 'audio/ogg';
            await markVoiceNoteTranscribing(env, voiceNoteId, media.mimeType, media.sizeBytes);
            const transcription = await transcribeTenantAudio(client, env, { mediaBase64, mimeType: mediaMimeType });
            userQuery = transcription.transcript;
            if (!userQuery || userQuery.trim().length < 1) throw new Error('The voice note did not contain a usable transcript.');
            await completeVoiceTranscript(env, voiceNoteId, userQuery);
            await incrementVoiceMetric(env, client.id, 'voice_notes_transcribed', 1);
          } catch (voiceError) {
            console.error('[VOICE NOTE ERROR]', { clientId: client.id, voiceNoteId, message: String(voiceError?.message || voiceError) });
            await failVoiceNote(env, voiceNoteId, 'transcription_failed', String(voiceError?.message || voiceError));
            await incrementVoiceMetric(env, client.id, 'voice_note_failures', 1);
            const unavailableReply = 'I received your voice note, but I could not understand it clearly. Please send it again or type your message.';
            await sendWhatsAppText(fromNumber, unavailableReply, client.whatsapp_token, client.phone_number_id);
            await logToD1(env, client.id, fromNumber, 'audio', '[voice note processing failed]', unavailableReply);
            return new Response('OK', { status: 200 });
          }
        } else if (msgType === 'image' && msgObj.image) {
          const media = await downloadWhatsAppMedia(msgObj.image.id, client.whatsapp_token, 16 * 1024 * 1024);
          if (media) {
            mediaBase64 = media.base64;
            mediaMimeType = media.mimeType || 'image/jpeg';
            userQuery = msgObj.image.caption || '[User sent an image. Please analyze and respond appropriately.]';
          }
        } else {
          await sendWhatsAppText(fromNumber,
            client.unsupported_msg || "I can only handle text, voice notes, and images. Please type your message.",
            client.whatsapp_token, client.phone_number_id);
          return new Response('OK', { status: 200 });
        }

        // Human handoff detection runs on the real text transcript for voice notes.
        const handoffTriggers = (client.handoff_triggers || 'human,manager,agent,bande se baat,insan,representative,support team,baat karo').split(',');
        const lowerQuery = userQuery.toLowerCase();
        if (handoffTriggers.some(t => lowerQuery.includes(t.trim()))) {
          const handoffResponse = `Bilkul, main aapko ${client.business_name} ke representative se connect karwa raha hoon. Thora wait karein, unka contact: ${client.contact_number || 'soon available'}.`;
          const responseMessageId = await sendWhatsAppText(fromNumber, handoffResponse, client.whatsapp_token, client.phone_number_id);
          if (voiceNoteId) {
            await completeVoiceResponse(env, voiceNoteId, handoffResponse, responseMessageId);
          }
          await createLeadAndFollowUp(env, {
            clientId: client.id,
            voiceNoteId,
            fromNumber,
            transcript: userQuery,
            aiResponse: handoffResponse,
            sourceType: voiceNoteId ? 'whatsapp_voice_note' : 'whatsapp_text',
          });
          await logToD1(env, client.id, fromNumber, msgType, userQuery, handoffResponse);
          return new Response('OK', { status: 200 });
        }

        // Centralized plan policy controls whether the tenant may use text automation.
        if (!hasPlanFeature(client, FEATURE_KEYS.WHATSAPP_TEXT)) {
          const unavailableReply = 'This automation is not available for the current business plan. Please contact the business team for help.';
          await sendWhatsAppText(fromNumber, unavailableReply, client.whatsapp_token, client.phone_number_id);
          await logToD1(env, client.id, fromNumber, msgType, userQuery, unavailableReply);
          return new Response('OK', { status: 200 });
        }

        // Enforce centralized message and AI usage limits before a billable provider call is made.
        const [messageAllowance, aiAllowance] = await Promise.all([
          canConsumeTenantUsage(env, client, 'messages'),
          canConsumeTenantUsage(env, client, 'ai_requests'),
        ]);
        if (!messageAllowance.allowed || !aiAllowance.allowed) {
          const limitReply = 'This business has reached its current automation usage limit. Please contact the business team for assistance.';
          await sendWhatsAppText(fromNumber, limitReply, client.whatsapp_token, client.phone_number_id);
          await logToD1(env, client.id, fromNumber, msgType, userQuery, '[usage_limit_reached]');
          return new Response('OK', { status: 200 });
        }

        // Build prompt through the selected provider adapter. Audio remains null for text generation.
        const systemPrompt = buildSystemPrompt(client);
        const generation = await generateTenantText(client, env, {
          systemPrompt,
          history,
          userText: userQuery,
          mediaBase64: isVoiceNote ? null : mediaBase64,
          mediaMimeType: isVoiceNote ? null : mediaMimeType,
        });
        const aiResponse = generation.text;

        // Update history (last 24 messages = ~12 exchanges)
        history.push({ role: 'user', content: userQuery });
        history.push({ role: 'model', content: aiResponse });
        if (history.length > 24) history = history.slice(-24);
        await env.MAQVORA_KV?.put(`conv:${client.id}:${fromNumber}`, JSON.stringify(history), { expirationTtl: 604800 });

        // Reply + log. A voice reply can be enabled later with a separate TTS provider; the first production release returns reliable text.
        const responseMessageId = await sendWhatsAppText(fromNumber, aiResponse, client.whatsapp_token, client.phone_number_id);
        if (voiceNoteId) {
          await completeVoiceResponse(env, voiceNoteId, aiResponse, responseMessageId);
          await createLeadAndFollowUp(env, { clientId: client.id, voiceNoteId, fromNumber, transcript: userQuery, aiResponse, sourceType: 'whatsapp_voice_note' });
        }
        await logToD1(env, client.id, fromNumber, msgType, userQuery, aiResponse);
        if (!voiceNoteId) {
          await createLeadAndFollowUp(env, { clientId: client.id, voiceNoteId: null, fromNumber, transcript: userQuery, aiResponse, sourceType: 'whatsapp_text' });
        }
        await Promise.all([
          recordTenantUsage(env, client, 'messages'),
          recordTenantUsage(env, client, 'ai_requests'),
        ]);

        return new Response('OK', { status: 200 });
      } catch (err) {
        const requestId = crypto.randomUUID();
        console.error('[WORKER ERROR]', { requestId, category: 'webhook_processing_failure', message: String(err?.message || 'unknown') });
        return new Response('We are temporarily unable to process this request. Please try again.', { status: 500, headers: { 'X-Request-Id': requestId } });
      }
    }

    // ── 3. ADMINISTRATION (Bearer Token Protected) ──
    if (path.startsWith('/admin/')) {
      const auth = request.headers.get('Authorization');
      if (auth !== `Bearer ${env.ADMIN_API_KEY}`) return new Response('Unauthorized', { status: 401 });

      if (path === '/admin/clients' && request.method === 'POST') {
        try {
          const data = await request.json();
          const adminVerifyToken = generateToken();
          const result = await env.MAQVORA_DB.prepare(`
            INSERT INTO clients (business_name, niche, country, phone_number_id, whatsapp_token, verify_token, gemini_api_key, client_mode, active)
            VALUES (?, ?, ?, ?, 'encrypted:v1', ?, 'encrypted:v1', ?, 1)
          `).bind(data.business_name, data.niche, data.country, data.phone_number_id, await sha256Hex(adminVerifyToken), data.client_mode || 3).run();
          const newClientId = result.meta.last_row_id;
          try {
            await putTenantSecret(env, newClientId, 'whatsapp_token', data.whatsapp_token);
            await putTenantSecret(env, newClientId, 'verify_token', adminVerifyToken);
            if (data.gemini_api_key) await putTenantSecret(env, newClientId, 'gemini_api_key', data.gemini_api_key);
            await env.MAQVORA_DB.prepare(`
              INSERT INTO tenant_voice_settings (client_id, voice_notes_enabled, follow_ups_enabled, follow_up_mode, lead_capture_enabled)
              VALUES (?, 1, 1, 'whatsapp_service', 1)
            `).bind(newClientId).run();
          } catch (secretError) {
            await env.MAQVORA_DB.prepare(`UPDATE clients SET active = 0, updated_at = datetime('now') WHERE id = ?`).bind(newClientId).run();
            throw secretError;
          }
          await writeAuditLog(env, request, 'client.create', newClientId, { business_name: data.business_name, client_mode: data.client_mode || 3 });
          return jsonResponse({ success: true, id: newClientId, verify_token: adminVerifyToken });
        } catch (err) {
          return jsonResponse({ success: false, error: String(err?.message || err) }, 500);
        }
      }

      if (path === '/admin/stats' && request.method === 'GET') {
        const stats = await env.MAQVORA_DB.prepare(`
          SELECT
            (SELECT COUNT(*) FROM clients) as total_clients,
            (SELECT COUNT(*) FROM logs) as total_messages
        `).first();
        return jsonResponse(stats);
      }

      if (path.startsWith('/admin/clients/') && request.method === 'PUT') {
        try {
          const clientId = Number(path.split('/')[3]);
          const data = await request.json();
          if (data.whatsapp_token) await putTenantSecret(env, clientId, 'whatsapp_token', data.whatsapp_token);
          if (data.gemini_api_key) await putTenantSecret(env, clientId, 'gemini_api_key', data.gemini_api_key);
          if (data.phone_number_id) {
            await env.MAQVORA_DB.prepare('UPDATE clients SET phone_number_id = ?, updated_at = datetime("now") WHERE id = ?').bind(data.phone_number_id, clientId).run();
          }
          await writeAuditLog(env, request, 'client.update', clientId, { updated: Object.keys(data) });
          return jsonResponse({ success: true });
        } catch (err) {
          console.error('[PUT CLIENT ERROR DETAIL]', err);
          return jsonResponse({ success: false, error: String(err?.message || err) }, 500);
        }
      }
    }

    // ── 4. WHATSAPP-FIRST PRODUCT FLOW ──
    // Maqtomate intentionally does not expose paid PSTN calling routes.
    // All automated customer follow-up happens through authorized WhatsApp service interactions.

    // ── 5. PUBLIC SELF-SIGNUP (Mode 1 / DIY BYOK only) ──
    // No admin token needed — the whole point of Mode 1 is the client sets
    // themselves up with their own Gemini + WhatsApp credentials. Deliberately
    // narrow: can only CREATE a Mode 1 client, can't set client_mode, can't
    // update/delete anything, can't touch other clients' records.
    if (request.method === 'POST' && path === '/api/self-signup') {
      try {
        // Basic abuse protection: 3 signups per IP per hour. This is a public,
        // unauthenticated endpoint — without this, anyone could spam-create
        // thousands of empty client rows.
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const rlKey = `signup-rl:${ip}`;
        const rlCount = parseInt((await env.MAQVORA_KV?.get(rlKey)) || '0', 10);
        if (rlCount >= 3) {
          return jsonResponse({ error: 'Too many signup attempts. Try again later or contact support.' }, 429, corsHeaders);
        }

        const data = await request.json();
        const mode = Number(data.client_mode || 1);
        if (![1, 2, 3].includes(mode)) return jsonResponse({ error: 'Choose a valid Maqtomate plan.' }, 400, corsHeaders);
        const requiredFields = ['business_name', 'dashboard_owner_email', 'payment_reference'];
        if (mode === 1) requiredFields.push('phone_number_id', 'whatsapp_token', 'gemini_api_key');
        const missing = requiredFields.filter(f => !data[f] || !String(data[f]).trim());
        if (missing.length > 0) {
          return jsonResponse({ error: `Missing required field(s): ${missing.join(', ')}.` }, 400, corsHeaders);
        }
        const dashboardOwnerEmail = String(data.dashboard_owner_email).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dashboardOwnerEmail) || dashboardOwnerEmail.length > 254) {
          return jsonResponse({ error: 'Enter a valid dashboard owner email address.' }, 400, corsHeaders);
        }
        const paymentReference = String(data.payment_reference || '').trim().slice(0, 160);
        const clientPhoneNumberId = mode === 1 ? String(data.phone_number_id).trim() : `pending_${generateSecureToken(18)}`;

        if (!env.TENANT_DATA_ENCRYPTION_KEY) {
          return jsonResponse({ error: 'Secure credential storage is not configured. Please contact Maqtomate support.' }, 503, corsHeaders);
        }
        const verifyToken = generateToken();
        const encryptedMarker = 'encrypted:v1';
        let result;
        try {
          result = await env.MAQVORA_DB.prepare(`
            INSERT INTO clients (
              business_name, niche, country, plan, monthly_fee,
              phone_number_id, whatsapp_token, verify_token,
              working_hours, location, services, pricing, contact_number,
              ai_name, handoff_triggers, gemini_model, active,
              gemini_api_key, client_mode
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
          `).bind(
            data.business_name, data.niche || 'general', data.country || 'PK',
            modeToPlanName(mode), modeToMonthlyFee(mode),
            clientPhoneNumberId, mode === 1 ? encryptedMarker : 'pending:setup', await sha256Hex(verifyToken),
            data.working_hours || '', data.location || '', data.services || '',
            data.pricing || '', data.contact_number || '',
            data.ai_name || `AI Assistant for ${data.business_name}`,
            'human,manager,agent,bande se baat,insan',
            data.gemini_model || 'gemini-3.6-flash',
            mode === 1 ? encryptedMarker : null, mode
          ).run();
        } catch (dbErr) {
          if (String(dbErr.message || '').includes('UNIQUE constraint')) {
            return jsonResponse({ error: 'This WhatsApp phone_number_id is already registered.' }, 409, corsHeaders);
          }
          throw dbErr;
        }

        const newClientId = result.meta.last_row_id;
        try {
          // Store any submitted tenant credentials encrypted. Managed plans remain inactive until Maqtomate completes setup.
          if (mode === 1) {
            await putTenantSecret(env, newClientId, 'whatsapp_token', data.whatsapp_token);
            await putTenantSecret(env, newClientId, 'gemini_api_key', data.gemini_api_key);
          }
          await putTenantSecret(env, newClientId, 'verify_token', verifyToken);
          await env.MAQVORA_DB.prepare(`
            INSERT INTO tenant_voice_settings (client_id, voice_notes_enabled, follow_ups_enabled, follow_up_mode, lead_capture_enabled)
            VALUES (?, 1, 1, 'whatsapp_service', 1)
          `).bind(newClientId).run();
          const payment = await env.MAQVORA_DB.prepare(`
            INSERT INTO tenant_payment_requests (client_id, dashboard_email, payer_name, payment_method, payment_reference, expected_amount, currency, status)
            VALUES (?, ?, ?, 'manual', ?, ?, ?, 'pending_review')
          `).bind(
            newClientId,
            dashboardOwnerEmail,
            data.business_name,
            paymentReference,
            modeToMonthlyFee(mode),
            currencyForCountry(data.country || 'PK')
          ).run();
          data.payment_request_id = payment.meta.last_row_id;
        } catch (setupError) {
          await env.MAQVORA_DB.prepare(`UPDATE clients SET active = 0, updated_at = datetime('now') WHERE id = ?`).bind(newClientId).run();
          throw setupError;
        }
        await env.MAQVORA_KV?.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });

        // No admin bearer token exists for a public signup — record the
        // caller's IP as the actor instead of hashing an (absent) token.
        try {
          await env.MAQVORA_DB.prepare(`
            INSERT INTO audit_logs (actor, action, client_id, detail, ip, created_at)
            VALUES (?, 'client.self_signup', ?, ?, ?, datetime('now'))
          `).bind(`self-signup:${ip}`, newClientId, JSON.stringify({ business_name: data.business_name }), ip).run();
        } catch (e) { console.error('[AUDIT LOG ERROR]', e); }

        return jsonResponse({
          success: true,
          client_id: newClientId,
          mode,
          payment_request_id: data.payment_request_id,
          payment_status: 'pending_review',
          next_steps: 'Your payment reference was submitted for Maqtomate owner review. Your bot and private dashboard remain inactive until the payment is verified. Once approved, Maqtomate will issue your one-time dashboard activation link through a trusted channel.'
        }, 201, corsHeaders);
      } catch (err) {
        console.error('[SELF-SIGNUP ERROR]', err);
        return jsonResponse({ error: 'Signup failed. Please contact support.' }, 500, corsHeaders);
      }
    }

    // ── 5. ADMIN API (/api/*) ──
    if (path.startsWith('/api/')) {
      const authHeader = request.headers.get('Authorization') || '';
      const expectedAuth = `Bearer ${env.ADMIN_API_KEY}`;
      if (!env.ADMIN_API_KEY || !timingSafeEqual(authHeader, expectedAuth)) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
      }

      // GET /api/clients — list all
      if (request.method === 'GET' && path === '/api/clients') {
        const clients = await env.MAQVORA_DB.prepare(
          `SELECT id, business_name, niche, country, plan, client_mode, monthly_fee,
                  c.active, c.created_at, c.phone_number_id, c.contact_number,
                  COALESCE(ai.provider_name, 'gemini') AS ai_provider_name,
                  COALESCE(ai.model_name, c.gemini_model, 'platform-managed') AS ai_model_name,
                  COALESCE(ai.credential_mode, CASE WHEN c.client_mode = 1 THEN 'tenant_byok' ELSE 'platform_managed' END) AS ai_credential_mode,
                  CASE
                    WHEN c.active = 0 THEN 'paused'
                    WHEN ai.active = 0 THEN 'disabled'
                    WHEN ai.validation_status = 'valid' THEN 'ready'
                    WHEN ai.validation_status IN ('invalid', 'error') THEN 'needs_attention'
                    ELSE 'pending_validation'
                  END AS ai_status
           FROM clients c
           LEFT JOIN tenant_ai_provider_settings ai ON ai.client_id = c.id
           ORDER BY c.created_at DESC`
        ).all();
        return jsonResponse({ clients: clients.results }, 200, corsHeaders);
      }

      // GET /api/clients/:id — single
      if (request.method === 'GET' && path.match(/^\/api\/clients\/\d+$/)) {
        const id = path.split('/').pop();
        const client = await env.MAQVORA_DB.prepare(
          `SELECT id, business_name, niche, country, plan, monthly_fee, phone_number_id,
                  working_hours, services, pricing, ai_name,
                  system_prompt_extra, handoff_triggers, unsupported_msg, fallback_msg,
                  gemini_model, client_mode, active, created_at, updated_at
           FROM clients WHERE id = ?`
        ).bind(id).first();
        if (!client) return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
        return jsonResponse({ client }, 200, corsHeaders);
      }

      // POST /api/clients/:id/system-user-token — validate and encrypt a permanent Meta token; never returns it.
      if (request.method === 'POST' && path.match(/^\/api\/clients\/\d+\/system-user-token$/)) {
        const id = Number(path.split('/')[3]);
        const data = await request.json().catch(() => null);
        const token = typeof data?.token === 'string' ? data.token.trim() : '';
        if (!Number.isInteger(id) || id < 1 || token.length < 40 || token.length > 4096) {
          return jsonResponse({ error: 'A valid tenant and Meta token are required.' }, 400, corsHeaders);
        }

        const client = await env.MAQVORA_DB.prepare('SELECT id, phone_number_id FROM clients WHERE id = ?').bind(id).first();
        const phoneNumberId = String(client?.phone_number_id || '').trim();
        if (!client || !/^\d{8,30}$/.test(phoneNumberId)) {
          return jsonResponse({ error: 'Set the tenant Phone Number ID before saving a System User token.' }, 400, corsHeaders);
        }

        const validation = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}?fields=id`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const isValid = validation.ok;
        await env.MAQVORA_DB.prepare(`
          INSERT INTO tenant_whatsapp_connections (client_id, phone_number_id, connection_status, phone_status, token_status, last_error_code, updated_at)
          VALUES (?, ?, 'PHONE_FOUND', 'FOUND', ?, ?, datetime('now'))
          ON CONFLICT(client_id) DO UPDATE SET phone_number_id = excluded.phone_number_id,
            token_status = excluded.token_status, last_error_code = excluded.last_error_code,
            connection_status = CASE WHEN tenant_whatsapp_connections.connection_status IN ('PHONE_REGISTERED', 'WABA_SUBSCRIBED', 'WEBHOOK_VERIFIED', 'TEST_MESSAGE_SUCCESS', 'ACTIVE') THEN tenant_whatsapp_connections.connection_status ELSE 'PHONE_FOUND' END,
            phone_status = CASE WHEN tenant_whatsapp_connections.phone_status = 'REGISTERED' THEN 'REGISTERED' ELSE 'FOUND' END,
            updated_at = datetime('now')
        `).bind(id, phoneNumberId, isValid ? 'VALID' : 'INVALID', isValid ? null : 'META_TOKEN_VALIDATION_FAILED').run();

        if (!isValid) {
          await writeAuditLog(env, request, 'tenant.system_user_token.rejected', id, { validation: 'failed' });
          return jsonResponse({ success: false, token_status: 'INVALID' }, 422, corsHeaders);
        }

        await putTenantSecret(env, id, 'whatsapp_token', token);
        await writeAuditLog(env, request, 'tenant.system_user_token.saved', id, { validation: 'valid' });
        return jsonResponse({ success: true, token_status: 'VALID' }, 200, corsHeaders);
      }

      // PUT /api/clients/:id/whatsapp-connection — metadata-only connection handoff. Tokens use the dedicated encrypted route.
      if (request.method === 'PUT' && path.match(/^\/api\/clients\/\d+\/whatsapp-connection$/)) {
        const id = Number(path.split('/')[3]);
        const data = await request.json().catch(() => null);
        const wabaId = String(data?.waba_id || '').trim();
        const phoneNumberId = String(data?.phone_number_id || '').trim();
        const displayName = String(data?.display_name || '').trim().slice(0, 120);
        if (!Number.isInteger(id) || id < 1 || !/^\d{8,30}$/.test(wabaId) || !/^\d{8,30}$/.test(phoneNumberId)) {
          return jsonResponse({ error: 'A valid tenant, WABA ID, and Phone Number ID are required.' }, 400, corsHeaders);
        }
        const client = await env.MAQVORA_DB.prepare('SELECT id FROM clients WHERE id = ?').bind(id).first();
        if (!client) return jsonResponse({ error: 'Tenant not found.' }, 404, corsHeaders);

        await env.MAQVORA_DB.prepare('UPDATE clients SET phone_number_id = ?, updated_at = datetime(\'now\') WHERE id = ?').bind(phoneNumberId, id).run();
        await env.MAQVORA_DB.prepare(`
          INSERT INTO tenant_whatsapp_connections (client_id, waba_id, phone_number_id, display_name, connection_status, phone_status, updated_at)
          VALUES (?, ?, ?, ?, 'PHONE_FOUND', 'FOUND', datetime('now'))
          ON CONFLICT(client_id) DO UPDATE SET waba_id = excluded.waba_id, phone_number_id = excluded.phone_number_id,
            display_name = excluded.display_name,
            connection_status = CASE WHEN tenant_whatsapp_connections.connection_status IN ('PHONE_REGISTERED', 'WABA_SUBSCRIBED', 'WEBHOOK_VERIFIED', 'TEST_MESSAGE_SUCCESS', 'ACTIVE') THEN tenant_whatsapp_connections.connection_status ELSE 'PHONE_FOUND' END,
            phone_status = CASE WHEN tenant_whatsapp_connections.phone_status = 'REGISTERED' THEN 'REGISTERED' ELSE 'FOUND' END,
            updated_at = datetime('now')
        `).bind(id, wabaId, phoneNumberId, displayName || null).run();
        await writeAuditLog(env, request, 'tenant.whatsapp_connection.metadata_saved', id, { has_waba_id: true, has_phone_number_id: true });
        return jsonResponse({ success: true, connection_status: 'PHONE_FOUND' }, 200, corsHeaders);
      }

      // POST /api/owner-test/send — explicit controlled message test. Recipient and body are never written to audit logs.
      if (request.method === 'POST' && path === '/api/owner-test/send') {
        const data = await request.json().catch(() => null);
        const recipient = String(data?.recipient || '').replace(/\D/g, '');
        const message = String(data?.message || '').trim();
        if (!/^\d{8,15}$/.test(recipient) || !message || message.length > 1000) {
          return jsonResponse({ error: 'A valid test recipient and message are required.' }, 400, corsHeaders);
        }
        const ownerTenant = await env.MAQVORA_DB.prepare(`
          SELECT id, phone_number_id, active FROM clients
          WHERE business_name = 'Maqtomate Owner Test Tenant'
          ORDER BY id DESC LIMIT 1
        `).first();
        if (!ownerTenant || Number(ownerTenant.active) !== 1 || !ownerTenant.phone_number_id) {
          return jsonResponse({ error: 'Owner test tenant is not ready.' }, 409, corsHeaders);
        }
        const token = await getTenantSecret(env, ownerTenant.id, 'whatsapp_token');
        if (!token) return jsonResponse({ error: 'Owner test WhatsApp credential is unavailable.' }, 409, corsHeaders);

        const messageId = await sendWhatsAppText(recipient, message, token, ownerTenant.phone_number_id);
        await env.MAQVORA_DB.prepare(`
          UPDATE tenant_whatsapp_connections SET last_test_at = datetime('now'), updated_at = datetime('now')
          WHERE client_id = ?
        `).bind(ownerTenant.id).run().catch(() => null);
        await writeAuditLog(env, request, 'owner_test.message_requested', ownerTenant.id, { delivery: 'requested' });
        return jsonResponse({ success: true, delivery: 'requested', message_id: messageId ? 'received' : 'unknown' }, 200, corsHeaders);
      }

      // POST /api/clients — create
      if (request.method === 'POST' && path === '/api/clients') {
        const data = await request.json();
        // Server-side validation — HTML `required` only protects the UI
        const requiredFields = ['business_name', 'phone_number_id', 'whatsapp_token'];
        const missing = requiredFields.filter(f => !data[f] || !String(data[f]).trim());
        if (missing.length > 0) {
          return jsonResponse({ error: `Missing required field(s): ${missing.join(', ')}` }, 400, corsHeaders);
        }

        if (!env.TENANT_DATA_ENCRYPTION_KEY) {
          return jsonResponse({ error: 'Secure credential storage is not configured.' }, 503, corsHeaders);
        }
        const adminVerifyToken = data.verify_token || generateToken();
        const encryptedMarker = 'encrypted:v1';
        const result = await env.MAQVORA_DB.prepare(`
          INSERT INTO clients (
            business_name, niche, country, plan, monthly_fee,
            phone_number_id, whatsapp_token, verify_token,
            working_hours, location, services, pricing, contact_number,
            ai_name, system_prompt_extra, handoff_triggers,
            unsupported_msg, fallback_msg, gemini_model, active,
            gemini_api_key, client_mode
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          data.business_name, data.niche || 'general', data.country || 'PK',
          data.plan || modeToPlanName(data.client_mode || 3),
          data.monthly_fee || modeToMonthlyFee(data.client_mode || 3),
          data.phone_number_id, encryptedMarker, await sha256Hex(adminVerifyToken),
          data.working_hours, data.location, data.services, data.pricing, data.contact_number,
          data.ai_name || `AI Assistant for ${data.business_name}`,
          data.system_prompt_extra || '',
          data.handoff_triggers || 'human,manager,agent,bande se baat,insan',
          data.unsupported_msg || '', data.fallback_msg || '',
          data.gemini_model || 'gemini-3.6-flash', 1,
          data.gemini_api_key ? encryptedMarker : null, data.client_mode || 3
        ).run();

        const newClientId = result.meta.last_row_id;
        try {
          await putTenantSecret(env, newClientId, 'whatsapp_token', data.whatsapp_token);
          await putTenantSecret(env, newClientId, 'verify_token', adminVerifyToken);
          if (data.gemini_api_key) await putTenantSecret(env, newClientId, 'gemini_api_key', data.gemini_api_key);
          await env.MAQVORA_DB.prepare(`
            INSERT INTO tenant_voice_settings (client_id, voice_notes_enabled, follow_ups_enabled, follow_up_mode, lead_capture_enabled)
            VALUES (?, 1, 1, 'whatsapp_service', 1)
          `).bind(newClientId).run();
        } catch (secretError) {
          await env.MAQVORA_DB.prepare(`UPDATE clients SET active = 0, updated_at = datetime('now') WHERE id = ?`).bind(newClientId).run();
          throw secretError;
        }
        await writeAuditLog(env, request, 'client.create', newClientId, { business_name: data.business_name, client_mode: data.client_mode || 3 });

        return jsonResponse({
          success: true,
          client_id: newClientId,
          webhook_url: `https://${url.hostname}/`,
          verify_token: adminVerifyToken
        }, 201, corsHeaders);
      }

      // PUT /api/clients/:id — partial update
      if (request.method === 'PUT' && path.match(/^\/api\/clients\/\d+$/)) {
        const id = path.split('/').pop();
        const data = await request.json();

        const allowedFields = [
          'business_name', 'niche', 'country', 'plan', 'monthly_fee',
          'phone_number_id', 'working_hours', 'location', 'services', 'pricing', 'contact_number',
          'ai_name', 'system_prompt_extra', 'handoff_triggers',
          'unsupported_msg', 'fallback_msg', 'gemini_model', 'active', 'client_mode'
        ];
        const sensitiveFields = ['whatsapp_token', 'verify_token', 'gemini_api_key'];
        const sensitiveUpdates = sensitiveFields.filter(key => data[key] !== undefined);
        const fields = [];
        const values = [];
        for (const key of allowedFields) {
          if (data[key] !== undefined) {
            fields.push(`${key} = ?`);
            values.push(data[key]);
          }
        }
        if (fields.length === 0 && sensitiveUpdates.length === 0) {
          return jsonResponse({ error: 'No fields to update' }, 400, corsHeaders);
        }
        if (fields.length > 0) {
          values.push(id);
          await env.MAQVORA_DB.prepare(
            `UPDATE clients SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`
          ).bind(...values).run();
        }
        if (sensitiveUpdates.length > 0) {
          if (!env.TENANT_DATA_ENCRYPTION_KEY) return jsonResponse({ error: 'Secure credential storage is not configured.' }, 503, corsHeaders);
          for (const key of sensitiveUpdates) {
            const value = String(data[key] || '');
            if (key === 'verify_token') {
              await putTenantSecret(env, id, key, value);
              await env.MAQVORA_DB.prepare(`UPDATE clients SET verify_token = ?, updated_at = datetime('now') WHERE id = ?`).bind(await sha256Hex(value), id).run();
            } else {
              if (!value && key === 'whatsapp_token') return jsonResponse({ error: 'WhatsApp token cannot be empty.' }, 400, corsHeaders);
              if (value) await putTenantSecret(env, id, key, value);
              await env.MAQVORA_DB.prepare(`UPDATE clients SET ${key} = ?, updated_at = datetime('now') WHERE id = ?`).bind(value ? 'encrypted:v1' : null, id).run();
            }
          }
        }
        await writeAuditLog(env, request, 'client.update', id, { fields_changed: Object.keys(data) });
        return jsonResponse({ success: true }, 200, corsHeaders);
      }

      // DELETE /api/clients/:id — soft delete
      if (request.method === 'DELETE' && path.match(/^\/api\/clients\/\d+$/)) {
        const id = path.split('/').pop();
        await env.MAQVORA_DB.prepare(
          `UPDATE clients SET active = 0, updated_at = datetime('now') WHERE id = ?`
        ).bind(id).run();
        await writeAuditLog(env, request, 'client.deactivate', id, null);
        return jsonResponse({ success: true }, 200, corsHeaders);
      }

      // GET /api/stats — dashboard counters
      if (request.method === 'GET' && path === '/api/stats') {
        const totalClients = await env.MAQVORA_DB.prepare(
          `SELECT COUNT(*) as count FROM clients WHERE active = 1`
        ).first();
        const totalMrr = await env.MAQVORA_DB.prepare(
          `SELECT SUM(monthly_fee) as mrr FROM clients WHERE active = 1`
        ).first();
        const nicheBreakdown = await env.MAQVORA_DB.prepare(
          `SELECT niche, COUNT(*) as count FROM clients WHERE active = 1 GROUP BY niche`
        ).all();
        const countryBreakdown = await env.MAQVORA_DB.prepare(
          `SELECT country, COUNT(*) as count FROM clients WHERE active = 1 GROUP BY country`
        ).all();
        const modeBreakdown = await env.MAQVORA_DB.prepare(
          `SELECT client_mode, COUNT(*) as count, SUM(monthly_fee) as mrr
           FROM clients WHERE active = 1 GROUP BY client_mode`
        ).all();
        return jsonResponse({
          total_clients: totalClients?.count || 0,
          total_mrr: totalMrr?.mrr || 0,
          niches: nicheBreakdown.results,
          countries: countryBreakdown.results,
          modes: modeBreakdown.results
        }, 200, corsHeaders);
      }

      // GET /api/health — owner-safe service availability only; never returns secret values or D1 error internals.
      if (request.method === 'GET' && path === '/api/health') {
        try {
          await env.MAQVORA_DB.prepare('SELECT 1 AS healthy').first();
          return jsonResponse({
            worker: 'healthy',
            database: 'healthy',
            kv: env.MAQVORA_KV ? 'configured' : 'missing',
            gemini: env.GEMINI_API_KEY ? 'configured' : 'missing',
            meta_webhook_security: env.APP_SECRET ? 'configured' : 'missing',
            timestamp: new Date().toISOString()
          }, 200, corsHeaders);
        } catch (error) {
          return jsonResponse({
            worker: 'degraded',
            database: 'unavailable',
            kv: env.MAQVORA_KV ? 'configured' : 'missing',
            gemini: env.GEMINI_API_KEY ? 'configured' : 'missing',
            meta_webhook_security: env.APP_SECRET ? 'configured' : 'missing',
            timestamp: new Date().toISOString()
          }, 503, corsHeaders);
        }
      }

      // GET /api/audit — audit log
      if (request.method === 'GET' && path === '/api/audit') {
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
        const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);
        const total = await env.MAQVORA_DB.prepare('SELECT COUNT(*) AS count FROM audit_logs').first();
        const rows = await env.MAQVORA_DB.prepare(
          `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?`
        ).bind(limit, offset).all();
        const totalCount = Number(total?.count || 0);
        const nextOffset = offset + rows.results.length < totalCount ? offset + rows.results.length : null;
        return jsonResponse({ audit: rows.results, page: { limit, offset, total: totalCount, next_offset: nextOffset } }, 200, corsHeaders);
      }

      // GET /api/whatsapp-connections — connection metadata only. Never returns access tokens or secret envelope values.
      if (request.method === 'GET' && path === '/api/whatsapp-connections') {
        try {
          const connections = await env.MAQVORA_DB.prepare(`
            SELECT wc.client_id, wc.waba_id, wc.meta_business_id, wc.phone_number_id,
                   wc.display_phone_number, wc.display_name, wc.connection_status,
                   wc.webhook_status, wc.phone_status, wc.token_status,
                   wc.last_error_code, wc.connected_at,
                   wc.last_verified_at, wc.last_test_at, wc.updated_at,
                   c.business_name, c.active
            FROM tenant_whatsapp_connections wc
            INNER JOIN clients c ON c.id = wc.client_id
            ORDER BY wc.updated_at DESC
          `).all();
          return jsonResponse({ connections: connections.results }, 200, corsHeaders);
        } catch (error) {
          if (String(error?.message || '').includes('no such table')) {
            return jsonResponse({ error: 'Connection-state schema is not applied.' }, 503, corsHeaders);
          }
          throw error;
        }
      }

      return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
    }

    // ── 6. ADMIN DASHBOARD (/admin) ──
    if (path === '/admin') {
      return new Response(adminDashboardHTML(), {
        headers: { 'Content-Type': 'text/html', ...corsHeaders }
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};

// ════════════════════════════════════════════════════════════════
// SECURITY HELPERS
// ════════════════════════════════════════════════════════════════

async function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expectedHex = signatureHeader.slice('sha256='.length).trim();
  if (!expectedHex) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const computedHex = [...new Uint8Array(sigBuffer)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return timingSafeEqual(computedHex, expectedHex);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

// ════════════════════════════════════════════════════════════════
// HTTP HELPERS
// ════════════════════════════════════════════════════════════════

function jsonResponse(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

function ownerTestConnectHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect Meta Test Number | Maqtomate</title><style>body{margin:0;background:#0b1020;color:#ecf2ff;font:16px system-ui,-apple-system,Segoe UI,sans-serif}.card{max-width:540px;margin:8vh auto;padding:32px;background:#151d33;border:1px solid #2d3b60;border-radius:18px;box-shadow:0 20px 70px #0008}h1{font-size:25px;margin:0 0 12px}p{line-height:1.55;color:#c9d4ea}.note{padding:13px 15px;background:#202b48;border-left:3px solid #68b6ff;border-radius:7px;font-size:14px}label{display:block;font-weight:700;margin:25px 0 9px}textarea{box-sizing:border-box;width:100%;height:125px;border-radius:10px;border:1px solid #536993;background:#0d1426;color:#fff;padding:12px;font:14px ui-monospace,SFMono-Regular,Menlo,monospace}button{width:100%;margin-top:18px;border:0;border-radius:10px;background:#2d8cff;color:#fff;padding:14px;font-size:16px;font-weight:800;cursor:pointer}small{display:block;margin-top:14px;color:#aab8d4}</style></head><body><main class="card"><h1>Connect the Maqtomate Test Number</h1><p>Paste the Meta <strong>access code</strong> that you generated in Step&nbsp;1 Testing. It will be verified with Meta, encrypted immediately, and this one-time link will be disabled.</p><div class="note">Do not paste this code into chat, email, or screenshots. Use this secure page only.</div><form method="post" autocomplete="off"><label for="meta_access_token">Meta access code</label><textarea id="meta_access_token" name="meta_access_token" required autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="Paste the code here"></textarea><button type="submit">Securely connect test number</button></form><small>This connection is limited to the Maqtomate owner test number and does not affect your personal WhatsApp account.</small></main></body></html>`;
}

function ownerTestConnectSuccessHtml() {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connected | Maqtomate</title><style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#0b1020;color:#ecf2ff;font:17px system-ui}.card{max-width:500px;padding:34px;margin:24px;background:#151d33;border:1px solid #2d3b60;border-radius:18px;text-align:center}.ok{font-size:44px;color:#5bea9d}p{color:#c9d4ea;line-height:1.55}</style><main class="card"><div class="ok">✓</div><h1>Test number connected</h1><p>The Meta test credential has been validated and encrypted for the Maqtomate owner test tenant. This one-time link is now disabled.</p><p>Return to WhatsApp and send a fresh message: <strong>Hello Maqtomate</strong>.</p></main>`, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' } });
}

function ownerTestConnectError(message) {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connection not completed | Maqtomate</title><style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#0b1020;color:#ecf2ff;font:17px system-ui}.card{max-width:500px;padding:34px;margin:24px;background:#151d33;border:1px solid #7a394b;border-radius:18px;text-align:center}p{color:#f2cbd4;line-height:1.55}</style><main class="card"><h1>Connection not completed</h1><p>${String(message || 'Please try again.').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p><p>Close this page, generate a new Meta access code, and use a fresh secure setup link.</p></main>`, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' } });
}

// Mode → plan label / default monthly fee, per docs/pricing-canonical.md
// "Final Call (v3)". Used as the fallback when the admin doesn't type an
// explicit plan/monthly_fee — keeps every client's fee correct-by-default
// instead of relying on someone remembering the current price sheet.
function modeToPlanName(mode) {
  return { 1: 'diy-byok', 2: 'smart-pro', 3: 'vip-managed' }[mode] || 'vip-managed';
}
function modeToMonthlyFee(mode) {
  return { 1: 1500, 2: 2000, 3: 3000 }[mode] || 3000;
}
function currencyForCountry(country) {
  return { PK: 'PKR', IN: 'INR', BD: 'BDT', AE: 'AED', SA: 'SAR', US: 'USD', UK: 'GBP', CA: 'CAD', AU: 'AUD' }[country] || 'USD';
}

function generateToken() {
  return `mv_${generateSecureToken(24)}`;
}

// Cryptographically secure, URL-safe token used only for passwordless dashboard activation.
function generateSecureToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

// ════════════════════════════════════════════════════════════════
// TENANT CREDENTIAL ENCRYPTION
// ════════════════════════════════════════════════════════════════

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function tenantEncryptionKey(env) {
  if (!env.TENANT_DATA_ENCRYPTION_KEY) throw new Error('Tenant credential encryption key is not configured.');
  return crypto.subtle.importKey(
    'raw',
    base64ToBytes(env.TENANT_DATA_ENCRYPTION_KEY),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

async function putTenantSecret(env, clientId, secretName, plaintext) {
  const key = await tenantEncryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(String(plaintext)));
  await env.MAQVORA_DB.prepare(`
    INSERT INTO tenant_secret_envelopes (client_id, secret_name, ciphertext, iv, key_version, updated_at)
    VALUES (?, ?, ?, ?, 1, datetime('now'))
    ON CONFLICT(client_id, secret_name) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, key_version = excluded.key_version, updated_at = datetime('now')
  `).bind(clientId, secretName, bytesToBase64(new Uint8Array(ciphertext)), bytesToBase64(iv)).run();
}

async function getTenantSecret(env, clientId, secretName) {
  const envelope = await env.MAQVORA_DB.prepare(
    'SELECT ciphertext, iv FROM tenant_secret_envelopes WHERE client_id = ? AND secret_name = ?'
  ).bind(clientId, secretName).first();
  if (!envelope) return null;
  const key = await tenantEncryptionKey(env);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(envelope.iv) },
    key,
    base64ToBytes(envelope.ciphertext)
  );
  return new TextDecoder().decode(plaintext);
}

async function hydrateTenantCredentials(env, client) {
  const [whatsappToken, geminiKey] = await Promise.all([
    getTenantSecret(env, client.id, 'whatsapp_token'),
    getTenantSecret(env, client.id, 'gemini_api_key')
  ]);
  if (!whatsappToken) throw new Error(`Missing encrypted WhatsApp token for tenant ${client.id}.`);
  return { ...client, whatsapp_token: whatsappToken, gemini_api_key: geminiKey || null };
}

// ════════════════════════════════════════════════════════════════
// META / GEMINI INTEGRATION
// ════════════════════════════════════════════════════════════════

async function downloadWhatsAppMedia(mediaId, token, maxBytes = 10 * 1024 * 1024) {
  try {
    const metaRes = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(mediaId)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!metaRes.ok) throw new Error(`Meta media lookup failed (${metaRes.status}).`);
    const metaData = await metaRes.json();
    if (!metaData.url) throw new Error('Meta did not return a media download URL.');
    const advertisedSize = Number(metaData.file_size || 0);
    if (advertisedSize && advertisedSize > maxBytes) throw new Error('Media file exceeds the configured processing limit.');

    const mediaRes = await fetch(metaData.url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!mediaRes.ok) throw new Error(`Meta media download failed (${mediaRes.status}).`);
    const contentLength = Number(mediaRes.headers.get('content-length') || 0);
    if (contentLength && contentLength > maxBytes) throw new Error('Media file exceeds the configured processing limit.');
    const arrayBuffer = await mediaRes.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) throw new Error('Media file exceeds the configured processing limit.');
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.byteLength)));
    }
    return {
      base64: btoa(binary),
      mimeType: metaData.mime_type || mediaRes.headers.get('content-type') || 'application/octet-stream',
      sizeBytes: arrayBuffer.byteLength
    };
  } catch (err) {
    console.error('[MEDIA ERROR]', String(err?.message || err));
    return null;
  }
}

function buildSystemPrompt(client) {
  return `You are ${client.ai_name || 'an AI Customer Service Assistant'} for ${client.business_name}.

BUSINESS INFORMATION:
- Working Hours: ${client.working_hours || 'Not specified'}
- Location: ${client.location || 'Not specified'}
- Services/Products: ${client.services || 'Not specified'}
- Pricing: ${client.pricing || 'Not specified'}
- Contact/Escalation: ${client.contact_number || 'Not specified'}
${client.system_prompt_extra ? '- Additional Notes: ' + client.system_prompt_extra : ''}

STRICT RULES:
1. Be extremely polite, professional, and concise. Use short paragraphs (1-3 sentences max per bubble).
2. Answer ONLY based on the provided business information. Never hallucinate.
3. If asked about pricing, provide exact prices listed above.
4. If customer wants to book an appointment or asks something outside your knowledge, say: "Main aapki details lekar ${client.business_name} ko inform kar deta hoon. Aapka naam aur contact number kya hai?"
5. Do NOT entertain off-topic questions (politics, coding, other businesses, general knowledge). Politely refuse: "Mujhe maaf kijiye, main sirf ${client.business_name} se related sawalon ka jawab de sakta hoon."
6. Respond in the SAME LANGUAGE the user is typing in (English, Roman Urdu, Urdu, Hindi, Arabic, Spanish, etc.).
7. If user sends a voice note, acknowledge naturally: "Aapki awaaz sun li, yeh raha jawab..."
8. Never make up discounts, offers, or policies not listed above.
9. Always end with a helpful closing like "Aur koi madad chahiye toh batain." or "Anything else I can help you with?"`;
}

async function sendWhatsAppText(to, text, token, phoneId) {
  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to,
      type: 'text',
      text: { body: String(text).slice(0, 4096), preview_url: false }
    })
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('[WHATSAPP SEND ERROR]', err);
    return null;
  }
  const data = await res.json().catch(() => ({}));
  return data.messages?.[0]?.id || null;
}

// ════════════════════════════════════════════════════════════════
// STORAGE / RATE LIMIT / AUDIT
// ════════════════════════════════════════════════════════════════

async function logToD1(env, clientId, fromNumber, msgType, query, response) {
  try {
    await env.MAQVORA_DB.prepare(`
      INSERT INTO logs (client_id, from_number, msg_type, query, response, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(clientId, fromNumber, msgType, String(query || '').substring(0, 500), String(response || '').substring(0, 500)).run();
  } catch (e) {
    console.error('[LOG ERROR]', e);
  }
}

async function createVoiceNote(env, { clientId, whatsappMessageId, fromNumber, mediaId, mimeType }) {
  const result = await env.MAQVORA_DB.prepare(`
    INSERT INTO voice_notes (
      client_id, whatsapp_message_id, contact_phone_e164, media_id, mime_type,
      transcription_status, retention_expires_at, received_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'received', datetime('now', '+90 days'), datetime('now'), datetime('now'), datetime('now'))
    ON CONFLICT(whatsapp_message_id) DO UPDATE SET updated_at = datetime('now')
  `).bind(clientId, whatsappMessageId, fromNumber, mediaId, mimeType).run();
  if (result.meta?.last_row_id) return result.meta.last_row_id;
  const existing = await env.MAQVORA_DB.prepare('SELECT id FROM voice_notes WHERE whatsapp_message_id = ? AND client_id = ?').bind(whatsappMessageId, clientId).first();
  if (!existing) throw new Error('Voice-note record could not be created.');
  return existing.id;
}

async function markVoiceNoteTranscribing(env, voiceNoteId, mimeType, sizeBytes) {
  await env.MAQVORA_DB.prepare(`
    UPDATE voice_notes
    SET transcription_status = 'transcribing', mime_type = ?, media_size_bytes = ?, processing_error_code = NULL, processing_error_detail = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).bind(mimeType || null, Number(sizeBytes || 0) || null, voiceNoteId).run();
}

async function completeVoiceTranscript(env, voiceNoteId, transcript) {
  await env.MAQVORA_DB.prepare(`
    UPDATE voice_notes
    SET transcription_status = 'completed', transcription_provider = 'gemini', transcript = ?, transcribed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).bind(String(transcript).slice(0, 12000), voiceNoteId).run();
}

async function completeVoiceResponse(env, voiceNoteId, responseText, responseMessageId) {
  await env.MAQVORA_DB.prepare(`
    UPDATE voice_notes
    SET ai_response = ?, whatsapp_response_message_id = ?, responded_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).bind(String(responseText).slice(0, 4096), responseMessageId || null, voiceNoteId).run();
}

async function failVoiceNote(env, voiceNoteId, code, detail) {
  if (!voiceNoteId) return;
  await env.MAQVORA_DB.prepare(`
    UPDATE voice_notes
    SET transcription_status = 'failed', processing_error_code = ?, processing_error_detail = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(String(code).slice(0, 80), String(detail || '').slice(0, 500), voiceNoteId).run();
}

function classifyLeadIntent(transcript) {
  const normalized = String(transcript || '').toLowerCase();
  if (/do not contact|don't contact|stop messaging|unsubscribe/.test(normalized)) return { status: 'do_not_contact', priority: 'low', createTask: false };
  if (/not interested|no thanks|nahi chahiye|not now/.test(normalized)) return { status: 'not_interested', priority: 'low', createTask: false };
  if (/book|booking|appointment|schedule|visit|meeting|available today|available tomorrow/.test(normalized)) return { status: 'appointment_requested', priority: 'high', createTask: true };
  if (/price|cost|charges|interested|want|need|details|information/.test(normalized)) return { status: 'interested', priority: 'normal', createTask: true };
  return { status: 'new', priority: 'normal', createTask: true };
}

async function createLeadAndFollowUp(env, { clientId, voiceNoteId = null, fromNumber, transcript, aiResponse, sourceType = 'whatsapp_text' }) {
  const settings = await env.MAQVORA_DB.prepare(`
    SELECT lead_capture_enabled, follow_ups_enabled, follow_up_mode, follow_up_instructions
    FROM tenant_voice_settings WHERE client_id = ?
  `).bind(clientId).first();
  // A missing settings row means the tenant has not been activated for this feature yet.
  if (!settings || !settings.lead_capture_enabled) return { leadId: null, taskId: null };

  const classification = classifyLeadIntent(transcript);
  const sourceLabel = sourceType === 'whatsapp_voice_note' ? 'WhatsApp voice note' : 'WhatsApp text message';
  const summary = `${sourceLabel} received and service response sent. ${String(aiResponse || '').slice(0, 500)}`;
  const leadResult = await env.MAQVORA_DB.prepare(`
    INSERT INTO lead_data (
      client_id, voice_note_id, source_type, contact_phone_e164, lead_status,
      requested_service, summary, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).bind(
    clientId,
    voiceNoteId,
    sourceType,
    fromNumber,
    classification.status,
    classification.status === 'appointment_requested' ? 'Appointment request' : null,
    summary
  ).run();
  const leadId = leadResult.meta?.last_row_id || null;
  if (classification.status === 'appointment_requested' || classification.status === 'interested') {
    await incrementVoiceMetric(env, clientId, 'qualified_leads', 1);
  }

  if (!settings.follow_ups_enabled || !classification.createTask) return { leadId, taskId: null };
  const humanActionNeeded = classification.status === 'appointment_requested' || classification.status === 'interested';
  const taskType = humanActionNeeded ? 'human_follow_up' : 'whatsapp_service';
  const taskStatus = humanActionNeeded ? 'open' : 'completed';
  const title = humanActionNeeded
    ? `Review WhatsApp lead: ${classification.status.replace('_', ' ')}`
    : 'WhatsApp service follow-up completed';
  const details = `${settings.follow_up_instructions || 'Review the customer conversation and take the next appropriate business action.'}\n\nTranscript: ${String(transcript || '').slice(0, 2000)}`;
  const taskResult = await env.MAQVORA_DB.prepare(`
    INSERT INTO follow_up_tasks (
      client_id, lead_id, voice_note_id, task_type, task_status, priority, title, details,
      due_at, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'open' THEN datetime('now', '+1 hour') ELSE NULL END,
      CASE WHEN ? = 'completed' THEN datetime('now') ELSE NULL END, datetime('now'), datetime('now'))
  `).bind(
    clientId, leadId, voiceNoteId, taskType, taskStatus, classification.priority, title, details,
    taskStatus, taskStatus
  ).run();
  await incrementVoiceMetric(env, clientId, 'follow_ups_created', 1);
  if (taskStatus === 'completed') await incrementVoiceMetric(env, clientId, 'follow_ups_completed', 1);
  return { leadId, taskId: taskResult.meta?.last_row_id || null };
}

const VOICE_METRIC_COLUMNS = new Set([
  'voice_notes_received', 'voice_notes_transcribed', 'voice_note_failures',
  'follow_ups_created', 'follow_ups_completed', 'qualified_leads'
]);

async function incrementVoiceMetric(env, clientId, metric, amount = 1) {
  if (!VOICE_METRIC_COLUMNS.has(metric)) throw new Error('Unsupported voice metric.');
  const value = Math.max(0, Number(amount) || 0);
  await env.MAQVORA_DB.prepare(`
    INSERT INTO tenant_voice_metrics_daily (client_id, metric_date, ${metric}, created_at, updated_at)
    VALUES (?, date('now'), ?, datetime('now'), datetime('now'))
    ON CONFLICT(client_id, metric_date) DO UPDATE SET
      ${metric} = ${metric} + excluded.${metric}, updated_at = datetime('now')
  `).bind(clientId, value).run();
}

// Sliding-ish window rate limit (KV isn't built for counters but good enough
// to stop runaway cost). 20 msgs / 60s / number / client.
async function checkRateLimit(env, clientId, fromNumber) {
  if (!env.MAQVORA_KV) {
    console.error('[SECURITY ERROR] KV rate-limit binding is not configured. Rejecting automated processing.');
    return true; // fail closed: no KV means no automated message processing.
  }
  const key = `rl:${clientId}:${fromNumber}`;
  const raw = await env.MAQVORA_KV.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= 20) return true;
  await env.MAQVORA_KV.put(key, String(count + 1), { expirationTtl: 60 });
  return false;
}

async function writeAuditLog(env, request, action, clientId, detail) {
  try {
    if (!env.MAQVORA_DB) return;
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    // Hash the admin token rather than storing a literal 'admin' string or the
    // raw token — lets you tell different admin tokens apart later (e.g. once
    // you split Super Admin / Support Agent tokens) without ever persisting
    // the actual secret in a log table.
    const authHeader = request.headers.get('Authorization') || '';
    const rawToken = authHeader.replace('Bearer ', '').trim();
    const actor = rawToken ? (await sha256Hex(rawToken)).slice(0, 12) : 'unknown';
    await env.MAQVORA_DB.prepare(`
      INSERT INTO audit_logs (actor, action, client_id, detail, ip, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(actor, action, clientId ?? null, detail ? JSON.stringify(detail) : null, ip).run();
  } catch (e) {
    console.error('[AUDIT LOG ERROR]', e);
  }
}



// SHA-256 hex digest — used to fingerprint the admin token in audit_logs
// without ever storing the token itself.
async function sha256Hex(message) {
  const data = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ════════════════════════════════════════════════════════════════
// ADMIN DASHBOARD HTML
// ════════════════════════════════════════════════════════════════

function adminDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Maqtomate AI — Admin Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>body{font-family:'Inter',sans-serif;}</style>
</head>
<body class="bg-gray-950 text-white min-h-screen">
  <div class="max-w-7xl mx-auto px-4 py-8">
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="text-3xl font-bold text-blue-400">Maqtomate AI Dashboard</h1>
        <p class="text-gray-400">Multi-Tenant WhatsApp Bot Management</p>
      </div>
      <div class="text-right">
        <div class="text-sm text-gray-400">Total MRR</div>
        <div class="text-2xl font-bold text-emerald-400" id="mrr">Loading...</div>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
      <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <div class="text-sm text-gray-400 mb-1">Active Clients</div>
        <div class="text-3xl font-bold" id="totalClients">-</div>
      </div>
      <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <div class="text-sm text-gray-400 mb-1">Countries</div>
        <div class="text-3xl font-bold" id="totalCountries">-</div>
      </div>
      <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <div class="text-sm text-gray-400 mb-1">Niches</div>
        <div class="text-3xl font-bold" id="totalNiches">-</div>
      </div>
      <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <div class="text-sm text-gray-400 mb-1">Modes</div>
        <div class="text-3xl font-bold text-purple-400" id="totalModes">-</div>
      </div>
    </div>

    <div class="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden mb-8">
      <div class="px-6 py-4 border-b border-gray-800 flex justify-between items-center">
        <h2 class="text-xl font-bold">Clients</h2>
        <button onclick="showAddForm()" class="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition">+ Add Client</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left">
          <thead class="bg-gray-800 text-gray-400 text-sm">
            <tr>
              <th class="px-6 py-3">ID</th>
              <th class="px-6 py-3">Business</th>
              <th class="px-6 py-3">Niche</th>
              <th class="px-6 py-3">Country</th>
              <th class="px-6 py-3">Mode</th>
              <th class="px-6 py-3">Monthly</th>
              <th class="px-6 py-3">Status</th>
              <th class="px-6 py-3">Actions</th>
            </tr>
          </thead>
          <tbody id="clientsTable" class="text-sm">
            <tr><td colspan="8" class="px-6 py-8 text-center text-gray-500">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div id="addModal" class="hidden fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div class="bg-gray-900 rounded-2xl border border-gray-700 max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-xl font-bold">Add New Client</h2>
          <button onclick="hideAddForm()" class="text-gray-400 hover:text-white text-2xl">&times;</button>
        </div>
        <form id="addForm" class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div><label class="block text-sm text-gray-400 mb-1">Business Name *</label><input name="business_name" required class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></div>
            <div><label class="block text-sm text-gray-400 mb-1">Niche *</label><input name="niche" required placeholder="dental, salon, real_estate, restaurant..." class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div><label class="block text-sm text-gray-400 mb-1">Country *</label><input name="country" required value="PK" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></div>
            <div>
              <label class="block text-sm text-gray-400 mb-1">Mode *</label>
              <select name="client_mode" required class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white">
                <option value="1">1 — DIY BYOK (client brings all keys; highest margin)</option>
                <option value="2">2 — Smart Pro (we manage AI; client owns Meta)</option>
                <option value="3" selected>3 — VIP Managed (we handle everything)</option>
              </select>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div><label class="block text-sm text-gray-400 mb-1">Monthly Fee (Rs)</label><input name="monthly_fee" type="number" value="2500" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></div>
            <div><label class="block text-sm text-gray-400 mb-1">Phone Number ID *</label><input name="phone_number_id" required placeholder="Meta Phone Number ID" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></div>
          </div>
          <div><label class="block text-sm text-gray-400 mb-1">WhatsApp Token *</label><input name="whatsapp_token" required class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></div>
          <div><label class="block text-sm text-gray-400 mb-1">Gemini API Key (Mode 1 only — leave blank to use shared key)</label><input name="gemini_api_key" placeholder="AIza..." class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></div>
          <div><label class="block text-sm text-gray-400 mb-1">Working Hours</label><input name="working_hours" placeholder="e.g., 4PM-9PM Mon-Sat" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></div>
          <div><label class="block text-sm text-gray-400 mb-1">Location</label><input name="location" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></div>
          <div><label class="block text-sm text-gray-400 mb-1">Services</label><textarea name="services" rows="2" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></textarea></div>
          <div><label class="block text-sm text-gray-400 mb-1">Pricing</label><textarea name="pricing" rows="3" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></textarea></div>
          <div><label class="block text-sm text-gray-400 mb-1">Contact Number (for handoff)</label><input name="contact_number" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"></div>
          <div class="flex justify-end space-x-3 pt-4">
            <button type="button" onclick="hideAddForm()" class="px-4 py-2 text-gray-400 hover:text-white transition">Cancel</button>
            <button type="submit" class="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-semibold transition">Create Client</button>
          </div>
        </form>
      </div>
    </div>
  </div>

  <script>
    const API_KEY = prompt('Enter Admin API Key:');
    if (!API_KEY) document.body.innerHTML = '<div class="text-center py-20 text-red-400">API Key required</div>';

    const MODE_LABELS = { 1: 'DIY', 2: 'Smart Pro', 3: 'VIP' };
    const MODE_COLORS = { 1: 'text-emerald-400', 2: 'text-blue-400', 3: 'text-purple-400' };

    async function loadStats() {
      const res = await fetch('/api/stats', { headers: { 'Authorization': 'Bearer ' + API_KEY } });
      const data = await res.json();
      document.getElementById('totalClients').textContent = data.total_clients;
      document.getElementById('totalCountries').textContent = data.countries ? data.countries.length : 0;
      document.getElementById('totalNiches').textContent = data.niches ? data.niches.length : 0;
      document.getElementById('totalModes').textContent = data.modes ? data.modes.length : 0;
      document.getElementById('mrr').textContent = 'Rs ' + (data.total_mrr || 0).toLocaleString();
    }

    async function loadClients() {
      const res = await fetch('/api/clients', { headers: { 'Authorization': 'Bearer ' + API_KEY } });
      const data = await res.json();
      const tbody = document.getElementById('clientsTable');
      if (!data.clients || data.clients.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="px-6 py-8 text-center text-gray-500">No clients yet</td></tr>';
        return;
      }
      tbody.innerHTML = data.clients.map(function(c) {
        const mode = c.client_mode || 3;
        return '<tr class="border-t border-gray-800 hover:bg-gray-800/50 transition">' +
          '<td class="px-6 py-4">#' + c.id + '</td>' +
          '<td class="px-6 py-4 font-medium">' + c.business_name + '</td>' +
          '<td class="px-6 py-4"><span class="bg-gray-800 px-2 py-1 rounded text-xs">' + c.niche + '</span></td>' +
          '<td class="px-6 py-4">' + c.country + '</td>' +
          '<td class="px-6 py-4"><span class="' + (MODE_COLORS[mode] || 'text-gray-400') + '">M' + mode + ' ' + (MODE_LABELS[mode] || '') + '</span></td>' +
          '<td class="px-6 py-4">Rs ' + c.monthly_fee + '</td>' +
          '<td class="px-6 py-4"><span class="' + (c.active ? 'text-emerald-400' : 'text-red-400') + '">' + (c.active ? 'Active' : 'Inactive') + '</span></td>' +
          '<td class="px-6 py-4"><button onclick="deleteClient(' + c.id + ')" class="text-red-400 hover:text-red-300 text-sm">Delete</button></td>' +
        '</tr>';
      }).join('');
    }

    function showAddForm() { document.getElementById('addModal').classList.remove('hidden'); }
    function hideAddForm() { document.getElementById('addModal').classList.add('hidden'); }

    document.getElementById('addForm').onsubmit = async function(e) {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = {};
      formData.forEach(function(v, k) {
        // Coerce client_mode to number
        data[k] = (k === 'client_mode' || k === 'monthly_fee') ? Number(v) : v;
      });
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await res.json();
      if (result.success) {
        alert('Client created! Webhook URL: ' + result.webhook_url);
        hideAddForm();
        loadClients();
        loadStats();
      } else {
        alert('Error: ' + (result.error || 'Unknown'));
      }
    };

    async function deleteClient(id) {
      if (!confirm('Deactivate client #' + id + '?')) return;
      await fetch('/api/clients/' + id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + API_KEY } });
      loadClients();
      loadStats();
    }

    loadStats();
    loadClients();
  </script>
</body>
</html>`;
}
