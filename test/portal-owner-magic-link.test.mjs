import assert from 'node:assert/strict';
import test from 'node:test';
import portal from '../portal-worker.js';

function d1ForOwnerMagicLink(ownerEmail) {
  return {
    prepare(sql) {
      return {
        bind(...params) {
          if (sql.includes('SELECT id, email FROM users')) {
            return { first: async () => ({ id: 7, email: ownerEmail }) };
          }
          if (sql.includes('UPDATE magic_link_tokens SET expires_at')) {
            return { run: async () => ({ meta: { changes: 1 } }) };
          }
          if (sql.includes('INSERT INTO magic_link_tokens')) {
            return { run: async () => ({ meta: { changes: 1 } }) };
          }
          if (sql.includes('INSERT INTO dashboard_events')) {
            return { run: async () => ({ meta: { changes: 1 } }) };
          }
          throw new Error(`Unexpected SQL in test: ${sql}`);
        }
      };
    }
  };
}

test('configured test owner can request a secure magic link while Turnstile protects other portal logins', async () => {
  const ownerEmail = 'owner@example.test';
  const originalFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (input, init) => {
    sent.push({ input: String(input), init });
    return new Response(JSON.stringify({ id: 'email_123' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const response = await portal.fetch(new Request('https://portal.example/auth/request-link', {
      method: 'POST',
      headers: { Origin: 'https://portal.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ownerEmail, turnstile_token: '' })
    }), {
      MAQVORA_KV: { get: async () => null, put: async () => undefined },
      MAQVORA_DB: d1ForOwnerMagicLink(ownerEmail),
      RESEND_API_KEY: 'test-key',
      TEST_MODE_OWNER_EMAIL: ownerEmail,
      TURNSTILE_SECRET: 'turnstile-is-enabled',
      PORTAL_URL: 'https://portal.example'
    }, {});

    assert.equal(response.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].input, 'https://api.resend.com/emails');
    assert.match(String(sent[0].init.body), /"from":"Maqtomate <onboarding@resend.dev>"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('magic-link provider failure is non-enumerating, expires the fresh token, and records a safe failure audit', async () => {
  const ownerEmail = 'owner@example.test';
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'rejected' }), { status: 403 });
  const db = {
    prepare(sql) {
      return {
        bind(...params) {
          calls.push({ sql, params });
          if (sql.includes('SELECT id, email FROM users')) return { first: async () => ({ id: 7, email: ownerEmail }) };
          if (sql.includes('UPDATE magic_link_tokens SET expires_at')) return { run: async () => ({ meta: { changes: 1 } }) };
          if (sql.includes('INSERT INTO magic_link_tokens')) return { run: async () => ({ meta: { changes: 1 } }) };
          if (sql.includes('INSERT INTO dashboard_events')) return { run: async () => ({ meta: { changes: 1 } }) };
          throw new Error(`Unexpected SQL in test: ${sql}`);
        }
      };
    }
  };

  try {
    const response = await portal.fetch(new Request('https://portal.example/auth/request-link', {
      method: 'POST',
      headers: { Origin: 'https://portal.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ownerEmail })
    }), {
      MAQVORA_KV: { get: async () => null, put: async () => undefined },
      MAQVORA_DB: db,
      RESEND_API_KEY: 'test-key',
      TEST_MODE_OWNER_EMAIL: ownerEmail,
      PORTAL_URL: 'https://portal.example'
    }, {});

    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    assert.ok(calls.some(call => call.sql.includes('WHERE token_hash = ? AND used_at IS NULL')));
    assert.ok(calls.some(call => call.sql.includes('INSERT INTO dashboard_events')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Google owner-login initiation requires both OAuth secrets and uses state plus nonce cookies when configured', async () => {
  const unavailable = await portal.fetch(new Request('https://portal.example/auth/google'), {}, {});
  assert.equal(unavailable.status, 503);

  const configured = await portal.fetch(new Request('https://portal.example/auth/google'), {
    GOOGLE_OAUTH_CLIENT_ID: 'client-id.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: 'server-only-secret',
    PORTAL_URL: 'https://portal.example'
  }, {});
  assert.equal(configured.status, 302);
  const location = configured.headers.get('Location');
  assert.match(location, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  assert.match(location, /scope=openid(?:%20|\+)email(?:%20|\+)profile/);
  assert.match(location, /redirect_uri=https%3A%2F%2Fportal\.example%2Fauth%2Fgoogle%2Fcallback/);
  const cookies = configured.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.ok(cookies.every(cookie => cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax')));
});
