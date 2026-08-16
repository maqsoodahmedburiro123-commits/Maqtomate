import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_MODES } from '../../config/plans.js';
import { resolvePlatformAiContext, resolveTenantAiContext } from '../../services/ai/router.js';

test('DIY tenant uses its own BYOK key and never falls back to platform AI', () => {
  const context = resolveTenantAiContext({ client_mode: PLAN_MODES.DIY_BYOK, gemini_api_key: 'tenant-key', gemini_model: 'gemini-1.5-flash' }, { GEMINI_API_KEY: 'platform-key' });
  assert.equal(context.scope, 'tenant');
  assert.equal(context.credentialSource, 'tenant_byok');
  assert.equal(context.apiKey, 'tenant-key');
});

test('DIY tenant without a key fails closed rather than consuming platform AI', () => {
  assert.throws(
    () => resolveTenantAiContext({ client_mode: PLAN_MODES.DIY_BYOK, gemini_api_key: null }, { GEMINI_API_KEY: 'platform-key' }),
    (error) => error.code === 'provider_key_unavailable',
  );
});

test('Smart Pro uses platform-managed AI when tenant BYOK is absent', () => {
  const context = resolveTenantAiContext({ client_mode: PLAN_MODES.SMART_PRO, gemini_api_key: null }, { GEMINI_API_KEY: 'platform-key' });
  assert.equal(context.credentialSource, 'platform_managed');
  assert.equal(context.apiKey, 'platform-key');
});

test('platform AI is a separate scope and prefers its dedicated secret', () => {
  const context = resolvePlatformAiContext({ PLATFORM_GEMINI_API_KEY: 'platform-internal-key', GEMINI_API_KEY: 'tenant-fallback-key' });
  assert.equal(context.scope, 'platform');
  assert.equal(context.apiKey, 'platform-internal-key');
});

test('unsupported provider is rejected before any provider request is attempted', () => {
  assert.throws(
    () => resolveTenantAiContext({ client_mode: PLAN_MODES.VIP_MANAGED }, { GEMINI_API_KEY: 'platform-key' }, { providerName: 'unsupported' }),
    (error) => error.code === 'provider_not_allowed_for_plan',
  );
});
