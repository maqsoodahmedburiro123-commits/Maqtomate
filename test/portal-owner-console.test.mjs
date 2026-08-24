import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Owner Console is server-rendered and Owner Test Tenant provisioning is payment-exempt', () => {
  const source = readFileSync(new URL('../portal-worker.js', import.meta.url), 'utf8');
  assert.match(source, /path === '\/owner'/);
  assert.match(source, /ownerConsoleOrLogin\(request, env, headers\)/);
  assert.match(source, /OWNER_GATE_PASSWORD/);
  assert.match(source, /function ownerGateHTML/);
  assert.match(source, /owner\.password_gate_verified/);
  assert.match(source, /error\.status === 401\) return await beginOwnerGoogleLogin/);
  assert.match(source, /path === '\/owner\/test-tenant\/provision'/);
  assert.match(source, /function ownerConsoleHTML\(user, overview, testTenant, runtimeDiagnostics/);
  assert.match(source, /Maqtomate Owner Test Tenant/);
  assert.match(source, /'owner_test', 0/);
  assert.match(source, /'customer_admin', 'active'/);
  assert.match(source, /'ONBOARDING_STARTED', 'VERIFIED', 'NOT_FOUND', 'NOT_AVAILABLE'/);
  assert.match(source, /No personal WhatsApp number, token, or secret is displayed or returned by this console/);
  assert.match(source, /Runtime credential diagnostics/);
  assert.match(source, /ownerRuntimeCredentialDiagnostics/);
  assert.match(source, /runtimeDiagnostics\(\)/);
});

test('Customer login keeps owner access and Google sign-in private', () => {
  const source = readFileSync(new URL('../portal-worker.js', import.meta.url), 'utf8');
  const customerLogin = source.slice(source.indexOf('function loginHTML(env)'), source.indexOf('const MARKETING_PATHS'));
  assert.match(customerLogin, /Business email/);
  assert.match(customerLogin, /Create a customer account/);
  assert.match(customerLogin, /Forgot password/);
  assert.doesNotMatch(customerLogin, /Owner access uses Google Sign-In/);
  assert.doesNotMatch(customerLogin, /Continue with Google — Owner access/);
  assert.doesNotMatch(customerLogin, /href="\/auth\/google"/);
});
