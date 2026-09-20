import {
  resolveAutomationCommunication,
  type AutomationCommunicationCandidate,
  type AutomationCommunicationResolution,
} from "../automations/communication-control";
import {
  resolvePersonCommunicationPreference,
  type PersonCommunicationPreferences,
} from "../automations/communication-preferences";
import type { DeliverAutomationMessageInput } from "../automations/messaging-provider";

export type RewardCommunicationKind =
  | "unlocked"
  | "near_progress"
  | "expiring"
  | "streak_reset";

export interface RewardCommunicationDefinition {
  unlock_notice?: boolean;
  near_progress_notice?: boolean;
  expiring_notice?: boolean;
  streak_reset_notice?: boolean;
}

export interface RewardCommunicationFact {
  key: string;
  kind: RewardCommunicationKind;
  studentId: string;
  occurredAt: string;
  title?: string | null;
  detail?: string | null;
  ruleId?: string | null;
  rewardInstanceId?: string | null;
  frequencyKey?: string | null;
  variables?: Record<string, unknown>;
}

export interface PreparedRewardCommunication {
  fact: RewardCommunicationFact;
  enabled: boolean;
  template: string;
  message: string;
  candidate: AutomationCommunicationCandidate;
  resolution: AutomationCommunicationResolution;
  variables: Record<string, unknown>;
}

export interface RewardCommunicationBatch {
  batchKey: string;
  studentId: string;
  frequencyKey: string | null;
  items: PreparedRewardCommunication[];
}

export const REWARD_UNLOCK_SOURCE_EVENT = "reward_instance_events:unlocked";

const TEMPLATES: Record<RewardCommunicationKind, string> = {
  unlocked: "reward_unlocked",
  near_progress: "reward_near_progress",
  expiring: "reward_expiring",
  streak_reset: "reward_streak_reset",
};

function enabledByDefinition(
  kind: RewardCommunicationKind,
  definition: RewardCommunicationDefinition,
): boolean {
  if (kind === "unlocked") return definition.unlock_notice !== false;
  if (kind === "expiring") return definition.expiring_notice !== false;
  if (kind === "near_progress") return definition.near_progress_notice === true;
  return definition.streak_reset_notice === true;
}

function messageForFact(fact: RewardCommunicationFact): string {
  if (fact.kind === "unlocked") {
    return fact.title
      ? `Desbloqueaste ${fact.title}. Ya puedes revisar tu recompensa en Studio Flow.`
      : "Desbloqueaste una nueva recompensa. Ya puedes revisarla en Studio Flow.";
  }

  if (fact.kind === "near_progress") {
    return fact.detail
      ? `Estás cerca de completar tu objetivo. ${fact.detail}`
      : "Estás cerca de completar tu objetivo. Tu progreso sigue avanzando.";
  }

  if (fact.kind === "expiring") {
    return fact.title
      ? `${fact.title} está próxima a vencer. Revísala antes de que termine su vigencia.`
      : "Tienes una recompensa próxima a vencer. Revísala antes de que termine su vigencia.";
  }

  return "Tu racha vuelve a empezar desde hoy. Cada clase cuenta para seguir construyendo tu progreso.";
}

function communicationKey(fact: RewardCommunicationFact): string {
  return `rewards:${fact.kind}:${fact.key}`;
}

function groupKey(fact: RewardCommunicationFact): string {
  return fact.frequencyKey
    ? `rewards:${fact.studentId}:${fact.frequencyKey}`
    : `rewards:${fact.studentId}:${fact.kind}:${fact.key}`;
}

function baseVariables(fact: RewardCommunicationFact): Record<string, unknown> {
  return {
    reward_communication_kind: fact.kind,
    reward_source_key: fact.key,
    reward_rule_id: fact.ruleId ?? null,
    reward_instance_id: fact.rewardInstanceId ?? null,
    reward_occurred_at: fact.occurredAt,
    reward_title: fact.title ?? null,
    reward_detail: fact.detail ?? null,
    ...(fact.variables ?? {}),
  };
}

export function prepareRewardCommunication(input: {
  fact: RewardCommunicationFact;
  definition?: RewardCommunicationDefinition;
  preferences?: PersonCommunicationPreferences;
  globalAllowed?: boolean;
  relatedCandidates?: readonly AutomationCommunicationCandidate[];
}): PreparedRewardCommunication {
  const definition = input.definition ?? {};
  const enabled = enabledByDefinition(input.fact.kind, definition);

  const preference = resolvePersonCommunicationPreference({
    category: "retention",
    preferences: input.preferences,
    globalAllowed: input.globalAllowed,
  });

  const candidate: AutomationCommunicationCandidate = {
    key: communicationKey(input.fact),
    externalKey: `rewards:${input.fact.kind}`,
    priority: "P2",
    promotional: false,
    groupKey: groupKey(input.fact),
    preference: enabled
      ? preference
      : {
          ...preference,
          decision: "suppress",
          reasonCode: "person_category_opt_out",
          reason: "La regla de Rewards no habilita este aviso.",
          personRestricted: false,
          globalRestricted: false,
        },
  };

  const resolution = resolveAutomationCommunication(
    candidate,
    input.relatedCandidates ?? [],
  );

  return {
    fact: input.fact,
    enabled,
    template: TEMPLATES[input.fact.kind],
    message: messageForFact(input.fact),
    candidate,
    resolution,
    variables: {
      ...baseVariables(input.fact),
      reward_message: messageForFact(input.fact),
    },
  };
}

export function groupRewardCommunications(
  communications: readonly PreparedRewardCommunication[],
): RewardCommunicationBatch[] {
  const groups = new Map<string, RewardCommunicationBatch>();

  for (const item of communications) {
    if (item.resolution.decision === "suppress") continue;

    const frequencyKey = item.fact.frequencyKey ?? null;
    const batchKey = frequencyKey
      ? `${item.fact.studentId}:${frequencyKey}`
      : `${item.fact.studentId}:${item.fact.kind}:${item.fact.key}`;

    const existing = groups.get(batchKey);
    if (existing) {
      existing.items.push(item);
      continue;
    }

    groups.set(batchKey, {
      batchKey,
      studentId: item.fact.studentId,
      frequencyKey,
      items: [item],
    });
  }

  return [...groups.values()];
}

export function buildRewardMessagingInput(input: {
  communication: PreparedRewardCommunication;
  executionId: string;
  eligibilityEvaluationId: string;
  recipient: string;
}): DeliverAutomationMessageInput {
  const decision = input.communication.resolution.decision;

  if (decision !== "send" && decision !== "combine") {
    throw new Error("reward_communication_not_ready_for_delivery");
  }

  return {
    executionId: input.executionId,
    eligibilityEvaluationId: input.eligibilityEvaluationId,
    recipient: input.recipient,
    template: input.communication.template,
    variables: input.communication.variables,
    metadata: {
      source: "rewards",
      reward_source_key: input.communication.fact.key,
      reward_communication_kind: input.communication.fact.kind,
      group_key: input.communication.candidate.groupKey ?? null,
      resolution: decision,
    },
  };
}
