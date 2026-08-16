import { hasFeature, FEATURE_KEYS } from '../../config/features.js';

function safeJson(value, fallback) {
  try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; }
}

function matchesConditions(conditions, event) {
  if (!conditions || typeof conditions !== 'object') return true;
  if (conditions.lead_status && conditions.lead_status !== event.lead_status) return false;
  if (conditions.min_interest_score != null && Number(event.interest_score || 0) < Number(conditions.min_interest_score)) return false;
  if (conditions.source_type && conditions.source_type !== event.source_type) return false;
  return true;
}

export async function emitAutomationEvent(env, tenant, event, { requestId = null } = {}) {
  const execution = await env.MAQVORA_DB.prepare(`
    INSERT INTO automation_executions (client_id, event_key, event_reference, status, request_id)
    VALUES (?, ?, ?, 'received', ?)
  `).bind(tenant.id, event.key, event.reference || null, requestId).run();
  const executionId = execution.meta.last_row_id;

  if (!hasFeature(tenant, FEATURE_KEYS.WORKFLOWS, env)) {
    await env.MAQVORA_DB.prepare(`UPDATE automation_executions SET status = 'skipped', outcome_json = ?, finished_at = datetime('now') WHERE id = ?`)
      .bind(JSON.stringify({ reason: 'workflow_feature_disabled' }), executionId).run();
    return { executionId, status: 'skipped' };
  }

  const rows = await env.MAQVORA_DB.prepare(`
    SELECT id, conditions_json, actions_json, plan_required_feature
    FROM automation_workflows
    WHERE client_id = ? AND trigger_event = ? AND enabled = 1
  `).bind(tenant.id, event.key).all();

  const outcomes = [];
  for (const workflow of rows.results || []) {
    if (workflow.plan_required_feature && !hasFeature(tenant, workflow.plan_required_feature, env)) {
      outcomes.push({ workflow_id: workflow.id, status: 'skipped', reason: 'plan_feature_not_available' });
      continue;
    }
    const conditions = safeJson(workflow.conditions_json, {});
    if (!matchesConditions(conditions, event)) {
      outcomes.push({ workflow_id: workflow.id, status: 'skipped', reason: 'conditions_not_met' });
      continue;
    }
    const actions = safeJson(workflow.actions_json, []);
    // V1.1 deliberately records eligible actions for review. Mutating actions are added only through owner-approved handlers.
    outcomes.push({ workflow_id: workflow.id, status: 'requires_review', actions: actions.map((action) => action?.type || 'unknown') });
  }

  await env.MAQVORA_DB.prepare(`
    UPDATE automation_executions SET status = ?, outcome_json = ?, finished_at = datetime('now') WHERE id = ?
  `).bind(outcomes.some((item) => item.status === 'requires_review') ? 'requires_review' : 'completed', JSON.stringify(outcomes), executionId).run();
  return { executionId, status: outcomes.some((item) => item.status === 'requires_review') ? 'requires_review' : 'completed', outcomes };
}
