import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_MODES } from '../../config/plans.js';
import { getUsagePolicy } from '../../services/usage/usage-service.js';

test('DIY usage policy has explicit message and AI request limits', () => {
  const tenant = { client_mode: PLAN_MODES.DIY_BYOK };
  const messages = getUsagePolicy(tenant, 'messages');
  const ai = getUsagePolicy(tenant, 'ai_requests');
  assert.equal(messages.limit, 500);
  assert.equal(messages.warningAt, 400);
  assert.equal(ai.limit, 500);
});

test('VIP export policy is explicitly unlimited rather than silently untracked', () => {
  const policy = getUsagePolicy({ client_mode: PLAN_MODES.VIP_MANAGED }, 'exports');
  assert.equal(policy.limit, null);
  assert.equal(policy.warningAt, null);
});

test('unknown usage metrics fail closed with a zero allowance', () => {
  const policy = getUsagePolicy({ client_mode: PLAN_MODES.SMART_PRO }, 'unknown_metric');
  assert.equal(policy.limit, 0);
  assert.equal(policy.warningAt, 0);
});
