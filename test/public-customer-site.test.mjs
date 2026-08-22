import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../portal-worker.js', import.meta.url), 'utf8');

test('public customer site routes keep secure sign-in separate from the marketing homepage', () => {
  assert.match(source, /path === '\/'\) return htmlResponse\(marketingSiteHTML\('\/'\)/);
  assert.match(source, /path === '\/login'\) return htmlResponse\(loginHTML\(env\)/);
  assert.match(source, /function marketingSiteHTML\(path\)/);
  assert.match(source, /Official Meta Cloud API only/);
});

test('customer website copy does not advertise unofficial WhatsApp access or unimplemented self-serve activation', () => {
  assert.match(source, /No QR-session automation/);
  assert.match(source, /published only after Meta Embedded Signup is implemented and verified/);
  assert.doesNotMatch(source, /Maqtomate .* 4\.9\/5/);
});

test('public rollout intake is privacy-minimised, rate-limited, and does not request a WhatsApp number or credential', () => {
  assert.match(source, /path === '\/api\/public\/rollout-requests'/);
  assert.match(source, /public-rollout:\$\{ipHash\}/);
  assert.match(source, /No customer API tokens or developer credentials requested/);
  assert.match(source, /You will never be asked to submit Meta tokens/);
  assert.doesNotMatch(source, /name="phone_number"/);
  assert.doesNotMatch(source, /name="meta_access_token"[^\n]*rollout/);
});
