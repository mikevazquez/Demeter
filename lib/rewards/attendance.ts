import {
  evaluateRewardConditions,
  recordRewardProgressEvaluation,
  type RewardConditionDefinition,
  type RewardFactValue,
  type RewardProgressEvaluationKind,
  type RewardProgressRecordResult,
  type RewardProgressRpcClient,
} from "./progress";

export interface RewardAttendanceDisciplineSummary {
  discipline_id: string;
  name: string;
  attendance_count: number;
}

export interface RewardAttendanceState {
  ruleId: string;
  versionNumber: number;
  studentId: string;
  asOfDate: string;
  windowStart: string;
  windowEnd: string;
  allowHistorical: boolean;
  attendanceMaxOnePerDay: boolean;
  rawAttendanceCount: number;
  countedAttendanceCount: number;
  distinctAttendanceDays: number;
  distinctAttendanceWeeks: number;
  distinctAttendanceMonths: number;
  distinctDisciplines: number;
  noShowCount: number;
  cancellationCount: number;
  attendedDates: string[];
  attendedWeeks: string[];
  attendedMonths: string[];
  noShowDates: string[];
  cancellationDates: string[];
  countedReservationIds: string[];
  disciplineCounts: Record<string, RewardAttendanceDisciplineSummary>;
}

interface RewardAttendanceStateRow {
  rule_id: string;
  version_number: number;
  student_id: string;
  as_of_date: string;
  window_start: string;
  window_end: string;
  allow_historical: boolean;
  attendance_max_one_per_day: boolean;
  raw_attendance_count: number;
  counted_attendance_count: number;
  distinct_attendance_days: number;
  distinct_attendance_weeks: number;
  distinct_attendance_months: number;
  distinct_disciplines: number;
  no_show_count: number;
  cancellation_count: number;
  attended_dates: string[];
  attended_weeks: string[];
  attended_months: string[];
  no_show_dates: string[];
  cancellation_dates: string[];
  counted_reservation_ids: string[];
  discipline_counts: Record<string, RewardAttendanceDisciplineSummary>;
}

export interface RewardAttendanceStreakOptions {
  noShowBreaksStreak?: boolean;
  cancellationBreaksStreak?: boolean;
}

type StreakCadence = "day" | "week" | "month";

function requiredText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

async function unwrapRpc<T>(
  resultPromise: Promise<{ data: T | null; error: { message: string } | null }>,
  emptyCode: string,
): Promise<T> {
  const result = await resultPromise;
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error(emptyCode);
  return result.data;
}

function parseIsoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("reward_attendance_date_invalid");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("reward_attendance_date_invalid");
  }
  return parsed;
}

function formatIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function startOfPeriod(value: string, cadence: StreakCadence): string {
  const date = parseIsoDate(value);

  if (cadence === "month") {
    date.setUTCDate(1);
    return formatIsoDate(date);
  }

  if (cadence === "week") {
    const day = date.getUTCDay();
    const daysSinceMonday = (day + 6) % 7;
    date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  }

  return formatIsoDate(date);
}

function addPeriod(value: string, cadence: StreakCadence, amount: number): string {
  const date = parseIsoDate(value);

  if (cadence === "month") {
    date.setUTCMonth(date.getUTCMonth() + amount, 1);
  } else {
    date.setUTCDate(date.getUTCDate() + amount * (cadence === "week" ? 7 : 1));
  }

  return formatIsoDate(date);
}

function calculateStreak(
  attendancePeriods: readonly string[],
  breakDates: readonly string[],
  asOfDate: string,
  cadence: StreakCadence,
): { current: number; best: number } {
  const breakPeriods = new Set(breakDates.map((date) => startOfPeriod(date, cadence)));
  const qualifyingPeriods = [
    ...new Set(attendancePeriods.map((date) => startOfPeriod(date, cadence))),
  ]
    .filter((period) => !breakPeriods.has(period))
    .sort();

  let best = 0;
  let running = 0;
  let previous: string | null = null;

  for (const period of qualifyingPeriods) {
    running = previous !== null && addPeriod(previous, cadence, 1) === period ? running + 1 : 1;
    best = Math.max(best, running);
    previous = period;
  }

  const currentPeriod = startOfPeriod(asOfDate, cadence);
  if (breakPeriods.has(currentPeriod)) {
    return { current: 0, best };
  }

  const latest = qualifyingPeriods.filter((period) => period <= currentPeriod).at(-1);
  if (!latest) return { current: 0, best };

  const previousOpenPeriod = addPeriod(currentPeriod, cadence, -1);
  if (latest !== currentPeriod && latest !== previousOpenPeriod) {
    return { current: 0, best };
  }

  let current = 1;
  let cursor = latest;
  const qualifyingSet = new Set(qualifyingPeriods);

  while (qualifyingSet.has(addPeriod(cursor, cadence, -1))) {
    cursor = addPeriod(cursor, cadence, -1);
    current += 1;
  }

  return { current, best };
}

export async function getRewardAttendanceState(
  client: RewardProgressRpcClient,
  input: {
    ruleId: string;
    versionNumber: number;
    studentId: string;
    asOfDate?: string | null;
    windowStart?: string | null;
    windowEnd?: string | null;
  },
): Promise<RewardAttendanceState> {
  if (!Number.isInteger(input.versionNumber) || input.versionNumber < 1) {
    throw new Error("reward_attendance_version_invalid");
  }

  const row = await unwrapRpc(
    client.rpc<RewardAttendanceStateRow>("system_compute_reward_attendance_state", {
      p_rule_id: requiredText(input.ruleId, "reward_attendance_rule_required"),
      p_version_number: input.versionNumber,
      p_student_id: requiredText(input.studentId, "reward_attendance_student_required"),
      p_as_of_date: input.asOfDate ?? null,
      p_window_start: input.windowStart ?? null,
      p_window_end: input.windowEnd ?? null,
    }),
    "reward_attendance_state_missing_result",
  );

  return {
    ruleId: row.rule_id,
    versionNumber: row.version_number,
    studentId: row.student_id,
    asOfDate: row.as_of_date,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    allowHistorical: row.allow_historical,
    attendanceMaxOnePerDay: row.attendance_max_one_per_day,
    rawAttendanceCount: row.raw_attendance_count,
    countedAttendanceCount: row.counted_attendance_count,
    distinctAttendanceDays: row.distinct_attendance_days,
    distinctAttendanceWeeks: row.distinct_attendance_weeks,
    distinctAttendanceMonths: row.distinct_attendance_months,
    distinctDisciplines: row.distinct_disciplines,
    noShowCount: row.no_show_count,
    cancellationCount: row.cancellation_count,
    attendedDates: row.attended_dates ?? [],
    attendedWeeks: row.attended_weeks ?? [],
    attendedMonths: row.attended_months ?? [],
    noShowDates: row.no_show_dates ?? [],
    cancellationDates: row.cancellation_dates ?? [],
    countedReservationIds: row.counted_reservation_ids ?? [],
    disciplineCounts: row.discipline_counts ?? {},
  };
}

export function attendanceProgressMetrics(
  state: RewardAttendanceState,
  options: RewardAttendanceStreakOptions = {},
): Readonly<Record<string, RewardFactValue>> {
  const breakDates = [
    ...(options.noShowBreaksStreak ? state.noShowDates : []),
    ...(options.cancellationBreaksStreak ? state.cancellationDates : []),
  ];

  const dayStreak = calculateStreak(state.attendedDates, breakDates, state.asOfDate, "day");
  const weekStreak = calculateStreak(state.attendedWeeks, breakDates, state.asOfDate, "week");
  const monthStreak = calculateStreak(state.attendedMonths, breakDates, state.asOfDate, "month");

  const metrics: Record<string, RewardFactValue> = {
    "attendance.count": state.countedAttendanceCount,
    "attendance.raw_count": state.rawAttendanceCount,
    "attendance.distinct_days": state.distinctAttendanceDays,
    "attendance.distinct_weeks": state.distinctAttendanceWeeks,
    "attendance.distinct_months": state.distinctAttendanceMonths,
    "attendance.distinct_disciplines": state.distinctDisciplines,
    "attendance.no_show_count": state.noShowCount,
    "attendance.cancellation_count": state.cancellationCount,
    "attendance.streak.days.current": dayStreak.current,
    "attendance.streak.days.best": dayStreak.best,
    "attendance.streak.weeks.current": weekStreak.current,
    "attendance.streak.weeks.best": weekStreak.best,
    "attendance.streak.months.current": monthStreak.current,
    "attendance.streak.months.best": monthStreak.best,
  };

  for (const [disciplineId, summary] of Object.entries(state.disciplineCounts)) {
    metrics[`attendance.discipline.${disciplineId}.count`] = summary.attendance_count;
  }

  return metrics;
}

export async function evaluateAndRecordAttendanceProgress(
  client: RewardProgressRpcClient,
  input: {
    ruleId: string;
    versionNumber: number;
    studentId: string;
    cycleKey: string;
    conditionDefinition: RewardConditionDefinition;
    candidateOccurredAt: string;
    idempotencyKey: string;
    evaluationKind?: RewardProgressEvaluationKind;
    asOfDate?: string | null;
    windowStart?: string | null;
    windowEnd?: string | null;
    eventId?: string | null;
    streakOptions?: RewardAttendanceStreakOptions;
  },
): Promise<{ state: RewardAttendanceState; progress: RewardProgressRecordResult }> {
  const state = await getRewardAttendanceState(client, input);
  const metrics = attendanceProgressMetrics(state, input.streakOptions);
  const evaluation = evaluateRewardConditions(input.conditionDefinition, metrics);

  const progress = await recordRewardProgressEvaluation(client, {
    ruleId: input.ruleId,
    versionNumber: input.versionNumber,
    studentId: input.studentId,
    cycleKey: requiredText(input.cycleKey, "reward_attendance_cycle_key_required"),
    idempotencyKey: input.idempotencyKey,
    evaluationKind: input.evaluationKind ?? "recalculation",
    outcome: input.evaluationKind === "event" ? "counted" : "recalculated",
    candidateOccurredAt: input.candidateOccurredAt,
    conditionResults: evaluation.conditions,
    progress: metrics,
    evidence: {
      source: "reservations_attended",
      as_of_date: state.asOfDate,
      window_start: state.windowStart,
      window_end: state.windowEnd,
      counted_reservation_ids: state.countedReservationIds,
    },
    eventId: input.eventId ?? null,
    fulfilled: evaluation.fulfilled,
    windowStartAt: `${state.windowStart}T00:00:00.000Z`,
    windowEndAt: `${state.windowEnd}T23:59:59.999Z`,
  });

  return { state, progress };
}
