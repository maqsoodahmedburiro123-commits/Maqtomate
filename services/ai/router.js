import { canUsePlatformAiFallback, canUseTenantByok, getAiProviderPolicy } from '../../config/plans.js';
import { GeminiAdapter } from './gemini-adapter.js';

const ADAPTERS = Object.freeze({ gemini: GeminiAdapter });

function safeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function getProviderAdapter(providerName) {
  const adapter = ADAPTERS[String(providerName || '').toLowerCase()];
  if (!adapter) throw safeError('provider_not_supported');
  return adapter;
}

export function resolveTenantAiContext(tenant, env, { providerName = null, modelName = null } = {}) {
  const policy = getAiProviderPolicy(tenant);
  if (Number(tenant.ai_provider_active ?? 1) !== 1) throw safeError('provider_disabled_for_tenant');
  const provider = String(providerName || tenant.ai_provider_name || 'gemini').toLowerCase();
  if (!policy.allowedProviders.includes(provider)) throw safeError('provider_not_allowed_for_plan');

  const credentialMode = tenant.ai_credential_mode || policy.mode;
  const tenantKey = tenant.gemini_api_key || null;
  const requiresTenantByok = policy.mode === 'tenant_byok_required' || credentialMode === 'tenant_byok';
  const useTenantByok = requiresTenantByok && canUseTenantByok(tenant) && Boolean(tenantKey);
  const usePlatformFallback = !requiresTenantByok && canUsePlatformAiFallback(tenant) && Boolean(env.GEMINI_API_KEY);
  if (!useTenantByok && !usePlatformFallback) throw safeError('provider_key_unavailable');

  return Object.freeze({
    scope: 'tenant',
    provider,
    model: modelName || tenant.ai_model_name || tenant.gemini_model || 'gemini-1.5-flash',
    credentialSource: useTenantByok ? 'tenant_byok' : 'platform_managed',
    apiKey: useTenantByok ? tenantKey : env.GEMINI_API_KEY,
  });
}

export function resolvePlatformAiContext(env, { providerName = 'gemini', modelName = 'gemini-1.5-flash' } = {}) {
  const provider = String(providerName).toLowerCase();
  if (provider !== 'gemini') throw safeError('platform_provider_not_supported');
  if (!env.PLATFORM_GEMINI_API_KEY && !env.GEMINI_API_KEY) throw safeError('platform_provider_key_unavailable');
  return Object.freeze({
    scope: 'platform',
    provider,
    model: modelName,
    credentialSource: 'platform_managed',
    apiKey: env.PLATFORM_GEMINI_API_KEY || env.GEMINI_API_KEY,
  });
}

export async function generateTenantText(tenant, env, request) {
  const context = resolveTenantAiContext(tenant, env, request);
  const adapter = getProviderAdapter(context.provider);
  return adapter.generateText({ ...request, apiKey: context.apiKey, model: context.model });
}

export async function transcribeTenantAudio(tenant, env, request) {
  const context = resolveTenantAiContext(tenant, env, request);
  const adapter = getProviderAdapter(context.provider);
  return adapter.transcribeAudio({ ...request, apiKey: context.apiKey, model: context.model });
}

export async function generatePlatformText(env, request) {
  const context = resolvePlatformAiContext(env, request);
  const adapter = getProviderAdapter(context.provider);
  return adapter.generateText({ ...request, apiKey: context.apiKey, model: context.model });
}
