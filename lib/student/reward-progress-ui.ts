export type StudentConditionProgress = {
  key: string;
  metric: string;
  label: string;
  comparator: string;
  target: unknown;
  current: unknown;
  completed: boolean;
};

export function singleNumericProgress(conditions: StudentConditionProgress[]) {
  if (conditions.length !== 1) return null;
  const condition = conditions[0];
  if (
    !condition ||
    typeof condition.current !== "number" ||
    typeof condition.target !== "number" ||
    condition.target <= 0 ||
    !["gte", "gt"].includes(condition.comparator)
  ) {
    return null;
  }

  return {
    current: condition.current,
    target: condition.target,
    percent: Math.max(0, Math.min(100, Math.round((condition.current / condition.target) * 100))),
  };
}

export function exactMissingLabel(conditions: StudentConditionProgress[]) {
  const missing = conditions.find((condition) => !condition.completed);
  if (!missing) return "Meta completada";

  if (typeof missing.current === "number" && typeof missing.target === "number") {
    const remaining = Math.max(0, missing.target - missing.current);
    return remaining > 0
      ? `Te falta${remaining === 1 ? "" : "n"} ${remaining} · ${missing.label.toLowerCase()}`
      : missing.label;
  }

  return `Pendiente · ${missing.label}`;
}

export function isNearComplete(conditions: StudentConditionProgress[]) {
  if (!conditions.length || conditions.every((condition) => condition.completed)) return false;

  const numeric = singleNumericProgress(conditions);
  if (numeric) return numeric.percent >= 70;

  const completed = conditions.filter((condition) => condition.completed).length;
  return conditions.length > 1 && completed / conditions.length >= 0.66;
}
