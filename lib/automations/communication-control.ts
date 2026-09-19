import {
  AUTOMATION_COMBINATION_RULES,
  AUTOMATION_DOMINANCE_RULES,
  getAutomationTemplate,
  type AutomationCatalogCode,
  type AutomationDominanceTarget,
  type AutomationPriority,
} from "./catalog";
import type {
  AutomationInstanceRpcClient,
  AutomationInstanceRpcResult,
} from "./instances";

export type AutomationCommunicationDecision =
  | "send"
  | "defer"
  | "suppress"
  | "substitute"
  | "combine";

export interface AutomationCommunicationWindowState {
  open: boolean;
  nextOpenAt: string | null;
  timezone?: string | null;
  globalWindow?: string | null;
  automationWindow?: string | null;
  reasonCode?: string | null;
}

export interface AutomationCommunicationCandidate {
  key: string;
  catalogCode?: AutomationCatalogCode;
  externalKey?: string;
  priority?: AutomationPriority;
  promotional?: boolean;
  groupKey?: string;
  contextKeys?: readonly string[];
  targetKeys?: readonly string[];
  commercialLimitHit?: boolean;
  commercialNextAllowedAt?: string | null;
  window?: AutomationCommunicationWindowState;
}

export interface AutomationCommunicationResolution {
  scope: "aut05" | "internal";
  priority: AutomationPriority | null;
  decision: AutomationCommunicationDecision;
  reasonCode: string;
  reason: string;
  groupKey: string | null;
  dominantKey: string | null;
  deferredUntil: string | null;
  relatedCandidateKeys: string[];
  requiresRevalidation: boolean;
  details: Record<string, unknown>;
}

export interface RecordedAutomationCommunicationControl {
  controlId: string;
  decision: AutomationCommunicationDecision;
  created: boolean;
  requiresRevalidation: boolean;
  deferredUntil: string | null;
}

const PRIORITY_RANK: Record<AutomationPriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

function candidatePriority(
  candidate: AutomationCommunicationCandidate,
): AutomationPriority | null {
  if (candidate.catalogCode) {
    const template = getAutomationTemplate(candidate.catalogCode);
    if (template.priority.scope === "internal") return null;

    if (candidate.promotional && template.priority.promotionalOverride) {
      return template.priority.promotionalOverride;
    }

    return template.priority.communication;
  }

  if (!candidate.externalKey) {
    throw new Error("automation_communication_candidate_reference_required");
  }

  if (!candidate.priority) {
    throw new Error("automation_communication_external_priority_required");
  }

  return candidate.priority;
}

function candidateScope(
  candidate: AutomationCommunicationCandidate,
): "aut05" | "internal" {
  if (!candidate.catalogCode) return "aut05";
  return getAutomationTemplate(candidate.catalogCode).priority.scope;
}

function candidateTargetKeys(
  candidate: AutomationCommunicationCandidate,
): Set<string> {
  return new Set(
    [candidate.externalKey, ...(candidate.targetKeys ?? [])].filter(
      (value): value is string => Boolean(value),
    ),
  );
}

function targetMatches(
  target: AutomationDominanceTarget,
  candidate: AutomationCommunicationCandidate,
  priority: AutomationPriority,
): boolean {
  if (target.kind === "automation") {
    return candidate.catalogCode === target.code;
  }

  if (target.kind === "priority") {
    return target.priorities.includes(priority);
  }

  return candidateTargetKeys(candidate).has(target.key);
}

function automationSourcePresent(
  code: AutomationCatalogCode,
  related: readonly AutomationCommunicationCandidate[],
): AutomationCommunicationCandidate | undefined {
  return related.find((candidate) => candidate.catalogCode === code);
}

function contextSourcePresent(
  key: string,
  candidate: AutomationCommunicationCandidate,
): boolean {
  return (candidate.contextKeys ?? []).includes(key);
}

function relatedPriorities(
  related: readonly AutomationCommunicationCandidate[],
): Array<{
  candidate: AutomationCommunicationCandidate;
  priority: AutomationPriority;
}> {
  const values: Array<{
    candidate: AutomationCommunicationCandidate;
    priority: AutomationPriority;
  }> = [];

  for (const candidate of related) {
    const priority = candidatePriority(candidate);
    if (priority) values.push({ candidate, priority });
  }

  return values;
}

function resolution(
  candidate: AutomationCommunicationCandidate,
  related: readonly AutomationCommunicationCandidate[],
  input: Omit<
    AutomationCommunicationResolution,
    "scope" | "priority" | "groupKey" | "relatedCandidateKeys" | "requiresRevalidation"
  >,
): AutomationCommunicationResolution {
  const priority = candidatePriority(candidate);
  const scope = candidateScope(candidate);

  return {
    scope,
    priority,
    groupKey: candidate.groupKey ?? null,
    relatedCandidateKeys: related.map((item) => item.key),
    requiresRevalidation: input.decision === "defer",
    ...input,
  };
}

export function resolveAutomationCommunication(
  candidate: AutomationCommunicationCandidate,
  relatedCandidates: readonly AutomationCommunicationCandidate[] = [],
): AutomationCommunicationResolution {
  const scope = candidateScope(candidate);
  const priority = candidatePriority(candidate);

  if (scope === "internal") {
    return resolution(candidate, relatedCandidates, {
      decision: "send",
      reasonCode: "internal_communication_independent",
      reason: "La comunicación interna usa reglas independientes de AUT-05.",
      dominantKey: null,
      deferredUntil: null,
      details: { internal: true },
    });
  }

  if (!priority) {
    throw new Error("automation_communication_priority_required");
  }

  for (const rule of AUTOMATION_DOMINANCE_RULES) {
    let sourceKey: string | null = null;

    if (rule.source.kind === "automation") {
      const source = automationSourcePresent(rule.source.code, relatedCandidates);
      if (!source) continue;
      sourceKey = source.key;
    } else {
      if (!contextSourcePresent(rule.source.key, candidate)) continue;
      sourceKey = rule.source.key;
    }

    if (!targetMatches(rule.target, candidate, priority)) continue;

    if (rule.effect === "suppresses") {
      return resolution(candidate, relatedCandidates, {
        decision: "suppress",
        reasonCode: "context_suppressed",
        reason: rule.reason,
        dominantKey: sourceKey,
        deferredUntil: null,
        details: { dominance_rule: rule },
      });
    }

    return resolution(candidate, relatedCandidates, {
      decision: "substitute",
      reasonCode: "dominated_by_more_relevant_communication",
      reason: rule.reason,
      dominantKey: sourceKey,
      deferredUntil: null,
      details: { dominance_rule: rule },
    });
  }

  for (const rule of AUTOMATION_COMBINATION_RULES) {
    if (candidate.catalogCode === rule.secondary) {
      const primary = automationSourcePresent(rule.primary, relatedCandidates);
      if (primary) {
        return resolution(candidate, relatedCandidates, {
          decision: "substitute",
          reasonCode: "combined_into_primary_communication",
          reason: rule.reason,
          dominantKey: primary.key,
          deferredUntil: null,
          details: {
            combination_primary: rule.primary,
            combination_secondary: rule.secondary,
          },
        });
      }
    }
  }

  const higherPriority = relatedPriorities(relatedCandidates)
    .filter(
      ({ priority: relatedPriority }) =>
        PRIORITY_RANK[relatedPriority] < PRIORITY_RANK[priority],
    )
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])[0];

  if (higherPriority) {
    return resolution(candidate, relatedCandidates, {
      decision: "defer",
      reasonCode: "higher_priority_communication_active",
      reason: `Existe una comunicación ${higherPriority.priority} más prioritaria en el mismo contexto.`,
      dominantKey: higherPriority.candidate.key,
      deferredUntil: null,
      details: {
        dominant_priority: higherPriority.priority,
        candidate_priority: priority,
      },
    });
  }

  if (priority === "P3" && candidate.commercialLimitHit) {
    return resolution(candidate, relatedCandidates, {
      decision: "defer",
      reasonCode: "commercial_limit_deferred",
      reason: "La comunicación comercial se difiere por un límite comercial aplicable.",
      dominantKey: null,
      deferredUntil: candidate.commercialNextAllowedAt ?? null,
      details: { commercial_limit_hit: true },
    });
  }

  if (candidate.window && !candidate.window.open) {
    return resolution(candidate, relatedCandidates, {
      decision: "defer",
      reasonCode: candidate.window.reasonCode ?? "outside_send_window",
      reason: "La comunicación está fuera del horario de envío permitido.",
      dominantKey: null,
      deferredUntil: candidate.window.nextOpenAt,
      details: {
        timezone: candidate.window.timezone ?? null,
        global_window: candidate.window.globalWindow ?? null,
        automation_window: candidate.window.automationWindow ?? null,
      },
    });
  }

  for (const rule of AUTOMATION_COMBINATION_RULES) {
    if (candidate.catalogCode === rule.primary) {
      const secondary = automationSourcePresent(rule.secondary, relatedCandidates);
      if (secondary) {
        return resolution(candidate, relatedCandidates, {
          decision: "combine",
          reasonCode: "related_events_combined",
          reason: rule.reason,
          dominantKey: candidate.key,
          deferredUntil: null,
          details: {
            combination_primary: rule.primary,
            combination_secondary: rule.secondary,
            combined_with: secondary.key,
          },
        });
      }
    }
  }

  return resolution(candidate, relatedCandidates, {
    decision: "send",
    reasonCode: "communication_allowed",
    reason: "No existe una regla de horario, prioridad o dominancia que impida el envío.",
    dominantKey: null,
    deferredUntil: null,
    details: {
      priority,
      commercial_limit_ignored:
        priority !== "P3" && Boolean(candidate.commercialLimitHit),
    },
  });
}

async function unwrapRpc<T>(
  promise: Promise<AutomationInstanceRpcResult<T>>,
  emptyError: string,
): Promise<T> {
  const result = await promise;
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error(emptyError);
  return result.data;
}

export async function getAutomationCommunicationWindow(
  client: AutomationInstanceRpcClient,
  input: { instanceId: string; at?: string },
): Promise<AutomationCommunicationWindowState> {
  const data = await unwrapRpc<{
    open: boolean;
    next_open_at: string | null;
    timezone?: string | null;
    global_window?: string | null;
    automation_window?: string | null;
    reason_code?: string | null;
  }>(
    client.rpc("system_get_automation_communication_window", {
      p_instance_id: input.instanceId,
      ...(input.at ? { p_at: input.at } : {}),
    }),
    "automation_communication_window_empty_result",
  );

  return {
    open: data.open,
    nextOpenAt: data.next_open_at,
    timezone: data.timezone ?? null,
    globalWindow: data.global_window ?? null,
    automationWindow: data.automation_window ?? null,
    reasonCode: data.reason_code ?? null,
  };
}

export async function recordAutomationCommunicationControl(
  client: AutomationInstanceRpcClient,
  input: {
    eligibilityEvaluationId: string;
    resolution: AutomationCommunicationResolution;
    parentControlId?: string | null;
    extraDetails?: Record<string, unknown>;
  },
): Promise<RecordedAutomationCommunicationControl> {
  if (!input.resolution.priority) {
    throw new Error("automation_communication_internal_scope_not_recordable");
  }

  const data = await unwrapRpc<{
    control_id: string;
    decision: AutomationCommunicationDecision;
    created: boolean;
    requires_revalidation: boolean;
    deferred_until: string | null;
  }>(
    client.rpc("system_record_automation_communication_control", {
      p_eligibility_evaluation_id: input.eligibilityEvaluationId,
      p_priority: input.resolution.priority,
      p_decision: input.resolution.decision,
      p_reason_code: input.resolution.reasonCode,
      p_reason: input.resolution.reason,
      p_group_key: input.resolution.groupKey,
      p_dominant_key: input.resolution.dominantKey,
      p_deferred_until: input.resolution.deferredUntil,
      p_related_candidate_keys: input.resolution.relatedCandidateKeys,
      p_details: {
        ...input.resolution.details,
        ...(input.extraDetails ?? {}),
      },
      p_parent_control_id: input.parentControlId ?? null,
    }),
    "automation_communication_control_empty_result",
  );

  return {
    controlId: data.control_id,
    decision: data.decision,
    created: data.created,
    requiresRevalidation: data.requires_revalidation,
    deferredUntil: data.deferred_until,
  };
}
