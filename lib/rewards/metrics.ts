export interface RewardMetricInstance {
  status: string;
  kind: string;
  benefit_definition: unknown;
  redemption_context?: unknown;
}

export interface RewardMetricsSummary {
  granted: number;
  available: number;
  redeemed: number;
  expired: number;
  revoked: number;
  potentialValueMinor: number;
  realizedValueMinor: number;
  unvaluedPotentialCount: number;
  creditsGranted: number;
  creditsUsed: number;
  benefitsApplied: number;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function potentialValueMinor(reward: RewardMetricInstance): number | null {
  const definition = asObject(reward.benefit_definition);
  const explicit = nonNegativeNumber(
    definition.potential_value_minor ?? definition.value_minor ?? definition.amount_minor,
  );

  if (explicit !== null) return explicit;
  return null;
}

function realizedValueMinor(reward: RewardMetricInstance): number | null {
  if (reward.status !== "redeemed") return null;

  const context = asObject(reward.redemption_context);
  const candidates = [
    context.actual_savings_minor,
    context.actual_benefit_minor,
    context.applied_value_minor,
    context.discount_minor,
  ];

  for (const candidate of candidates) {
    const value = nonNegativeNumber(candidate);
    if (value !== null) return value;
  }

  return null;
}

function rewardCredits(reward: RewardMetricInstance): number {
  if (reward.kind !== "credits") return 0;
  const definition = asObject(reward.benefit_definition);
  const value = nonNegativeNumber(definition.credits);
  return value === null ? 0 : Math.floor(value);
}

export function summarizeRewardMetrics(
  rewards: readonly RewardMetricInstance[],
): RewardMetricsSummary {
  const summary: RewardMetricsSummary = {
    granted: rewards.length,
    available: 0,
    redeemed: 0,
    expired: 0,
    revoked: 0,
    potentialValueMinor: 0,
    realizedValueMinor: 0,
    unvaluedPotentialCount: 0,
    creditsGranted: 0,
    creditsUsed: 0,
    benefitsApplied: 0,
  };

  for (const reward of rewards) {
    if (reward.status === "available") summary.available += 1;
    if (reward.status === "redeemed") summary.redeemed += 1;
    if (reward.status === "expired") summary.expired += 1;
    if (reward.status === "revoked") summary.revoked += 1;

    if (reward.status !== "revoked") {
      const potential = potentialValueMinor(reward);
      if (potential === null) {
        if (reward.kind !== "credits" && reward.kind !== "badge") {
          summary.unvaluedPotentialCount += 1;
        }
      } else {
        summary.potentialValueMinor += potential;
      }

      summary.creditsGranted += rewardCredits(reward);
    }

    if (reward.status === "redeemed") {
      const realized = realizedValueMinor(reward);
      if (realized !== null) summary.realizedValueMinor += realized;
      summary.creditsUsed += rewardCredits(reward);
      if (reward.kind !== "badge") summary.benefitsApplied += 1;
    }
  }

  return summary;
}

export function formatRewardMoneyMinor(valueMinor: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(valueMinor / 100);
}
