export const PLAN_MODES = Object.freeze({
  DIY_BYOK: 1,
  SMART_PRO: 2,
  VIP_MANAGED: 3,
});

const UNLIMITED = null;

export const PLAN_ENTITLEMENTS = Object.freeze({
  [PLAN_MODES.DIY_BYOK]: Object.freeze({
    key: 'diy_byok',
    label: 'DIY BYOK',
    ai: Object.freeze({ mode: 'tenant_byok_required', allowedProviders: ['gemini'], allowTenantByok: true, allowPlatformFallback: false }),
    features: Object.freeze({
      whatsapp_text: true,
      excel_export: true,
      voice_employee: false,
      voice_transcription: false,
      voice_auto_processing: false,
      workflows: false,
      advanced_workflows: false,
      provider_fallback: false,
      detailed_analytics: false,
    }),
    limits: Object.freeze({ team_members: 1, monthly_messages: 500, monthly_ai_requests: 500, monthly_exports: 5, active_workflows: 0 }),
  }),
  [PLAN_MODES.SMART_PRO]: Object.freeze({
    key: 'smart_pro',
    label: 'Smart Pro',
    ai: Object.freeze({ mode: 'platform_managed', allowedProviders: ['gemini'], allowTenantByok: true, allowPlatformFallback: true }),
    features: Object.freeze({
      whatsapp_text: true,
      excel_export: true,
      voice_employee: false,
      voice_transcription: false,
      voice_auto_processing: false,
      workflows: true,
      advanced_workflows: false,
      provider_fallback: false,
      detailed_analytics: true,
    }),
    limits: Object.freeze({ team_members: 3, monthly_messages: 3000, monthly_ai_requests: 3000, monthly_exports: 30, active_workflows: 3 }),
  }),
  [PLAN_MODES.VIP_MANAGED]: Object.freeze({
    key: 'vip_managed',
    label: 'VIP Managed',
    ai: Object.freeze({ mode: 'platform_managed', allowedProviders: ['gemini'], allowTenantByok: true, allowPlatformFallback: true }),
    features: Object.freeze({
      whatsapp_text: true,
      excel_export: true,
      voice_employee: false,
      voice_transcription: false,
      voice_auto_processing: false,
      workflows: true,
      advanced_workflows: true,
      provider_fallback: false,
      detailed_analytics: true,
    }),
    limits: Object.freeze({ team_members: 10, monthly_messages: 10000, monthly_ai_requests: 10000, monthly_exports: UNLIMITED, active_workflows: 20 }),
  }),
});

export function normalizePlanMode(value) {
  const mode = Number(value);
  return PLAN_ENTITLEMENTS[mode] ? mode : PLAN_MODES.VIP_MANAGED;
}

export function getPlanEntitlement(tenantOrPlan) {
  const mode = typeof tenantOrPlan === 'object' ? tenantOrPlan?.client_mode : tenantOrPlan;
  return PLAN_ENTITLEMENTS[normalizePlanMode(mode)];
}

export function hasPlanFeature(tenantOrPlan, feature) {
  return getPlanEntitlement(tenantOrPlan).features[feature] === true;
}

export function getPlanLimit(tenantOrPlan, limit) {
  const value = getPlanEntitlement(tenantOrPlan).limits[limit];
  return value === undefined ? 0 : value;
}

export function getAiProviderPolicy(tenantOrPlan) {
  return getPlanEntitlement(tenantOrPlan).ai;
}

export function canUseTenantByok(tenantOrPlan) {
  return getAiProviderPolicy(tenantOrPlan).allowTenantByok === true;
}

export function canUsePlatformAiFallback(tenantOrPlan) {
  return getAiProviderPolicy(tenantOrPlan).allowPlatformFallback === true;
}
