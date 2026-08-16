import { getPlanLimit } from '../../config/plans.js';

function currentMonthPeriod(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export function getUsagePolicy(tenant, metricKey) {
  const map = {
    messages: 'monthly_messages',
    ai_requests: 'monthly_ai_requests',
    exports: 'monthly_exports',
    active_workflows: 'active_workflows',
    team_members: 'team_members',
  };
  const limitName = map[metricKey];
  if (!limitName) return { limit: 0, warningAt: 0 };
  const limit = getPlanLimit(tenant, limitName);
  return { limit, warningAt: limit == null ? null : Math.ceil(limit * 0.8) };
}

export async function canConsumeTenantUsage(env, tenant, metricKey, amount = 1, now = new Date()) {
  const { start } = currentMonthPeriod(now);
  const policy = getUsagePolicy(tenant, metricKey);
  const current = await env.MAQVORA_DB.prepare(`
    SELECT quantity FROM tenant_usage_periods WHERE client_id = ? AND period_start = ? AND metric_key = ?
  `).bind(tenant.id, start, metricKey).first();
  const nextQuantity = Number(current?.quantity || 0) + Math.max(0, Number(amount) || 0);
  return {
    allowed: policy.limit == null || nextQuantity <= policy.limit,
    quantity: Number(current?.quantity || 0),
    nextQuantity,
    limit: policy.limit,
    warningReached: policy.warningAt != null && nextQuantity >= policy.warningAt,
  };
}

export async function recordTenantUsage(env, tenant, metricKey, amount = 1, now = new Date()) {
  const { start, end } = currentMonthPeriod(now);
  const policy = getUsagePolicy(tenant, metricKey);
  const current = await env.MAQVORA_DB.prepare(`
    SELECT id, quantity, warning_80_sent_at, limit_reached_at
    FROM tenant_usage_periods
    WHERE client_id = ? AND period_start = ? AND metric_key = ?
  `).bind(tenant.id, start, metricKey).first();
  const nextQuantity = Number(current?.quantity || 0) + Math.max(0, Number(amount) || 0);
  const limitReached = policy.limit != null && nextQuantity >= policy.limit;
  const warningReached = policy.warningAt != null && nextQuantity >= policy.warningAt;

  await env.MAQVORA_DB.prepare(`
    INSERT INTO tenant_usage_periods (client_id, period_start, period_end, metric_key, quantity, warning_80_sent_at, limit_reached_at, updated_at)
    VALUES (?, ?, ?, ?, ?, CASE WHEN ? THEN datetime('now') ELSE NULL END, CASE WHEN ? THEN datetime('now') ELSE NULL END, datetime('now'))
    ON CONFLICT(client_id, period_start, metric_key) DO UPDATE SET
      quantity = excluded.quantity,
      warning_80_sent_at = COALESCE(tenant_usage_periods.warning_80_sent_at, excluded.warning_80_sent_at),
      limit_reached_at = COALESCE(tenant_usage_periods.limit_reached_at, excluded.limit_reached_at),
      updated_at = datetime('now')
  `).bind(tenant.id, start, end, metricKey, nextQuantity, warningReached, limitReached).run();

  return { periodStart: start, metricKey, quantity: nextQuantity, limit: policy.limit, warningReached, limitReached };
}

export async function getTenantUsageSummary(env, tenant, now = new Date()) {
  const { start } = currentMonthPeriod(now);
  const result = await env.MAQVORA_DB.prepare(`
    SELECT metric_key, quantity, warning_80_sent_at, limit_reached_at
    FROM tenant_usage_periods WHERE client_id = ? AND period_start = ?
  `).bind(tenant.id, start).all();
  return (result.results || []).map((row) => ({ ...row, limit: getUsagePolicy(tenant, row.metric_key).limit }));
}
