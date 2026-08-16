import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_MODES,
  getPlanEntitlement,
  getPlanLimit,
  hasPlanFeature,
  canUseTenantByok,
  canUsePlatformAiFallback,
} from '../../config/plans.js';
import {
  FEATURE_KEYS,
  getGlobalFeatureFlags,
  hasFeature,
  shouldProcessVoice,
} from '../../config/features.js';

test('DIY BYOK requires tenant-provided AI and cannot use shared fallback', () => {
  const diy = { client_mode: PLAN_MODES.DIY_BYOK };
  assert.equal(getPlanEntitlement(diy).key, 'diy_byok');
  assert.equal(canUseTenantByok(diy), true);
  assert.equal(canUsePlatformAiFallback(diy), false);
  assert.equal(hasPlanFeature(diy, FEATURE_KEYS.WHATSAPP_TEXT), true);
  assert.equal(getPlanLimit(diy, 'team_members'), 1);
});

test('Smart Pro allows managed AI but voice is not a plan entitlement during the paused phase', () => {
  const pro = { client_mode: PLAN_MODES.SMART_PRO, voice_notes_enabled: 1 };
  assert.equal(canUsePlatformAiFallback(pro), true);
  assert.equal(hasPlanFeature(pro, FEATURE_KEYS.WORKFLOWS), true);
  assert.equal(hasPlanFeature(pro, FEATURE_KEYS.VOICE_EMPLOYEE), false);
  assert.equal(shouldProcessVoice(pro, {
    VOICE_EMPLOYEE_ENABLED: 'true',
    VOICE_TRANSCRIPTION_ENABLED: 'true',
    VOICE_AUTO_PROCESSING_ENABLED: 'true',
  }), false);
});

test('voice flags are fail-closed when no environment value is configured', () => {
  const flags = getGlobalFeatureFlags({});
  assert.equal(flags[FEATURE_KEYS.VOICE_EMPLOYEE], false);
  assert.equal(flags[FEATURE_KEYS.VOICE_TRANSCRIPTION], false);
  assert.equal(flags[FEATURE_KEYS.VOICE_AUTO_PROCESSING], false);
});

test('Excel export is centrally allowed only when both plan and environment policy permit it', () => {
  const vip = { client_mode: PLAN_MODES.VIP_MANAGED };
  assert.equal(hasFeature(vip, FEATURE_KEYS.EXCEL_EXPORT, {}), true);
  assert.equal(hasFeature(vip, FEATURE_KEYS.EXCEL_EXPORT, { EXCEL_EXPORT_ENABLED: 'false' }), false);
});
