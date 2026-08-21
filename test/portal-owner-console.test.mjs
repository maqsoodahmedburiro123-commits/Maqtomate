import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Owner Console is server-rendered and Owner Test Tenant provisioning is payment-exempt', () => {
  const source = readFileSync(new URL('../portal-worker.js', import.meta.url), 'utf8');
  assert.match(source, /path === '\/owner'/);
  assert.match(source, /path === '\/owner\/test-tenant\/provision'/);
  assert.match(source, /function ownerConsoleHTML\(user, overview, testTenant\)/);
  assert.match(source, /Maqtomate Owner Test Tenant/);
  assert.match(source, /'owner_test', 0/);
  assert.match(source, /'customer_admin', 'active'/);
  assert.match(source, /'ONBOARDING_STARTED', 'VERIFIED', 'NOT_FOUND', 'NOT_AVAILABLE'/);
  assert.match(source, /No personal WhatsApp number, token, or secret is displayed or returned by this console/);
});
