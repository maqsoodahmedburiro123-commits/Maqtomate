import { hasPlanFeature } from './plans.js';

export const FEATURE_KEYS = Object.freeze({
  VOICE_EMPLOYEE: 'voice_employee',
  VOICE_TRANSCRIPTION: 'voice_transcription',
  VOICE_AUTO_PROCESSING: 'voice_auto_processing',
  WHATSAPP_TEXT: 'whatsapp_text',
  EXCEL_EXPORT: 'excel_export',
  WORKFLOWS: 'workflows',
  ADVANCED_WORKFLOWS: 'advanced_workflows',
  DETAILED_ANALYTICS: 'detailed_analytics',
});

const TRUE = new Set(['1', 'true', 'yes', 'on']);

function isExplicitlyEnabled(value) {
  return TRUE.has(String(value || '').trim().toLowerCase());
}

export function getGlobalFeatureFlags(env = {}) {
  return Object.freeze({
    [FEATURE_KEYS.VOICE_EMPLOYEE]: isExplicitlyEnabled(env.VOICE_EMPLOYEE_ENABLED),
    [FEATURE_KEYS.VOICE_TRANSCRIPTION]: isExplicitlyEnabled(env.VOICE_TRANSCRIPTION_ENABLED),
    [FEATURE_KEYS.VOICE_AUTO_PROCESSING]: isExplicitlyEnabled(env.VOICE_AUTO_PROCESSING_ENABLED),
    [FEATURE_KEYS.WHATSAPP_TEXT]: env.WHATSAPP_TEXT_ENABLED !== 'false',
    [FEATURE_KEYS.EXCEL_EXPORT]: env.EXCEL_EXPORT_ENABLED !== 'false',
    [FEATURE_KEYS.WORKFLOWS]: isExplicitlyEnabled(env.WORKFLOWS_ENABLED),
    [FEATURE_KEYS.ADVANCED_WORKFLOWS]: isExplicitlyEnabled(env.ADVANCED_WORKFLOWS_ENABLED),
    [FEATURE_KEYS.DETAILED_ANALYTICS]: env.DETAILED_ANALYTICS_ENABLED !== 'false',
  });
}

export function hasFeature(tenant, feature, env = {}) {
  return hasPlanFeature(tenant, feature) && getGlobalFeatureFlags(env)[feature] === true;
}

export function getVoiceFeatureState(tenant, env = {}) {
  const global = getGlobalFeatureFlags(env);
  const tenantVoiceEnabled = Number(tenant?.voice_notes_enabled ?? 1) === 1;
  const voiceEmployeeEnabled = tenantVoiceEnabled && hasPlanFeature(tenant, FEATURE_KEYS.VOICE_EMPLOYEE) && global[FEATURE_KEYS.VOICE_EMPLOYEE];
  const transcriptionEnabled = voiceEmployeeEnabled && hasPlanFeature(tenant, FEATURE_KEYS.VOICE_TRANSCRIPTION) && global[FEATURE_KEYS.VOICE_TRANSCRIPTION];
  const autoProcessingEnabled = transcriptionEnabled && hasPlanFeature(tenant, FEATURE_KEYS.VOICE_AUTO_PROCESSING) && global[FEATURE_KEYS.VOICE_AUTO_PROCESSING];
  return Object.freeze({ voiceEmployeeEnabled, transcriptionEnabled, autoProcessingEnabled });
}

export function shouldProcessVoice(tenant, env = {}) {
  const state = getVoiceFeatureState(tenant, env);
  return state.voiceEmployeeEnabled && state.transcriptionEnabled && state.autoProcessingEnabled;
}
