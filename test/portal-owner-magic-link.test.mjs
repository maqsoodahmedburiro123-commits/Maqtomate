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
  } finally {
    globalThis.fetch = originalFetch;
  }
});
