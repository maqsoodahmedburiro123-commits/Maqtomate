import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import portal from '../portal-worker.js';

test('customer login exposes password-account access without owner or Google prompts', async () => {
  const response = await portal.fetch(new Request('https://portal.example/login'), {}, {});
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Business email/);
  assert.match(html, /Create a customer account/);
  assert.match(html, /Forgot password/);
  assert.doesNotMatch(html, /Owner access/);
  assert.doesNotMatch(html, /Continue with Google/);
});

test('customer Google sign-in uses a distinct callback and state cookies without requiring the owner gate', async () => {
  const response = await portal.fetch(new Request('https://portal.example/auth/customer/google'), {
    GOOGLE_OAUTH_CLIENT_ID: 'customer-client.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: 'server-only-secret',
    PORTAL_URL: 'https://portal.example'
  }, {});
  assert.equal(response.status, 302);
  const location = response.headers.get('Location');
  assert.match(location, /redirect_uri=https%3A%2F%2Fportal\.example%2Fauth%2Fcustomer%2Fgoogle%2Fcallback/);
  assert.match(location, /scope=openid(?:%20|\+)email(?:%20|\+)profile/);
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.ok(cookies.some(cookie => cookie.startsWith('mt_customer_google_state=')));
  assert.ok(cookies.some(cookie => cookie.startsWith('mt_customer_google_nonce=')));
  assert.ok(cookies.every(cookie => cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax')));
});

test('customer account source uses server-side password derivation and email-action token tables', async () => {
  const source = await readFile(new URL('../portal-worker.js', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../backend/migration-010-customer-accounts-and-onboarding.sql', import.meta.url), 'utf8');
  assert.match(source, /PBKDF2/);
  assert.match(source, /PASSWORD_PBKDF2_ITERATIONS/);
  assert.match(source, /password_hash/);
  assert.match(source, /account_action_tokens/);
  assert.match(source, /customer_onboarding_requests/);
  assert.match(source, /customerGoogleCallbackUrl/);
  assert.match(source, /customer\.google_identity_verified/);
  assert.match(migration, /password_hash TEXT/);
  assert.match(migration, /password_salt TEXT/);
  assert.match(migration, /customer_onboarding_requests/);
});

test('customer onboarding remains pre-tenant until an owner approves payment and activates a matching customer mode', async () => {
  const source = await readFile(new URL('../portal-worker.js', import.meta.url), 'utf8');
  assert.match(source, /status = 'payment_submitted'/);
  assert.match(source, /status = 'connection_pending'/);
  assert.match(source, /tenant_client_id/);
  assert.match(source, /business_name != 'Maqtomate Owner Test Tenant'/);
  assert.match(source, /requested_ai_mode === 'customer_byok' \? 1 : 2/);
  assert.match(source, /No owner Meta credential, personal WhatsApp, or secret is assigned to a customer/);
});

test('customer onboarding does not collect Meta, WhatsApp, or Gemini credential fields in the public signup form', async () => {
  const source = await readFile(new URL('../portal-worker.js', import.meta.url), 'utf8');
  const signupSection = source.slice(source.indexOf('function signupHTML('), source.indexOf('function customerOnboardingHTML('));
  assert.match(signupSection, /Customer Gemini BYOK/);
  assert.doesNotMatch(signupSection, /name="meta_access_token"/);
  assert.doesNotMatch(signupSection, /name="whatsapp_token"/);
  assert.doesNotMatch(signupSection, /name="gemini_api_key"/);
});

test('activation readiness is a pre-tenant, opt-in-aware record that never collects provider credentials', async () => {
  const source = await readFile(new URL('../portal-worker.js', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../backend/migration-011-customer-activation-readiness.sql', import.meta.url), 'utf8');
  const readinessSection = source.slice(source.indexOf('async function saveCustomerActivationReadiness'), source.indexOf('async function submitCustomerOnboardingPayment'));
  const onboardingTemplate = source.slice(source.indexOf('function customerOnboardingHTML('), source.indexOf('const MARKETING_PATHS'));
  assert.match(source, /\/api\/customer\/onboarding\/readiness/);
  assert.match(readinessSection, /editableStatuses/);
  assert.match(readinessSection, /opt_in_acknowledged !== true/);
  assert.match(readinessSection, /credential_collection: false/);
  assert.match(onboardingTemplate, /Maqtomate never asks for a Meta password, token, WhatsApp password, OTP, personal number, or Gemini API key/);
  assert.doesNotMatch(onboardingTemplate, /name="meta_access_token"/);
  assert.doesNotMatch(onboardingTemplate, /name="whatsapp_token"/);
  assert.doesNotMatch(onboardingTemplate, /name="gemini_api_key"/);
  assert.match(migration, /customer_activation_readiness/);
  assert.match(migration, /onboarding_request_id INTEGER NOT NULL UNIQUE/);
  assert.match(migration, /opt_in_acknowledged_at DATETIME NOT NULL/);
  assert.doesNotMatch(migration, /meta_access_token|whatsapp_token|gemini_api_key/);
});

test('customer activation and workspace surfaces use server-derived states without owner or fake-live automation claims', async () => {
  const source = await readFile(new URL('../portal-worker.js', import.meta.url), 'utf8');
  const onboardingTemplate = source.slice(source.indexOf('function customerOnboardingHTML('), source.indexOf('const MARKETING_PATHS'));
  const workspace = source.slice(source.indexOf('function customerWorkspaceHTML('), source.indexOf('function dashboardHTML('));
  assert.match(onboardingTemplate, /Your activation journey/);
  assert.match(onboardingTemplate, /Next permitted action/);
  assert.match(onboardingTemplate, /Official connection/);
  assert.match(workspace, /Tenant active/);
  assert.match(workspace, /Official go-live proof/);
  assert.match(workspace, /Conversations · pending proof/);
  assert.match(workspace, /Do not enter Meta tokens, app secrets, WhatsApp passwords, OTPs, personal numbers, or Gemini keys/);
  assert.doesNotMatch(workspace, /Owner Console/);
  assert.doesNotMatch(workspace, /Send controlled test/);
});

test('customer setup makes approved offer pricing visible and retains the seven-character password minimum', async () => {
  const source = await readFile(new URL('../portal-worker.js', import.meta.url), 'utf8');
  const setup = source.slice(source.indexOf('function customerOnboardingSetupHTML('), source.indexOf('function passwordResetHTML('));
  assert.match(setup, /Managed Launch — Rs 5,000 setup \+ Rs 2,000\/month/);
  assert.match(setup, /Custom Business Rollout — quote after review/);
  assert.match(setup, /at least 7 characters/);
  assert.match(setup, /minlength="7"/);
  assert.match(setup, /does not instantly activate a bot/);
});
