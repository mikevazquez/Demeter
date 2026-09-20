import "server-only";

import { cache } from "react";

import { getStudentPortalContext } from "./portal";

type NoticeVisibility = "high" | "light";

export type StudentRewardNotice = {
  sourceKey: string;
  kind: "available" | "automatic" | "automatic_pending" | "future" | "achievement";
  visibility: NoticeVisibility;
  title: string;
  body: string;
  href: string;
  occurredAt: string;
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function benefitLabel(kind: string, value: unknown) {
  const definition = asObject(value);

  if (kind === "percentage_discount") {
    return `${Number(definition.percent ?? 0)}% de descuento`;
  }
  if (kind === "fixed_discount") {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 0,
    }).format(Number(definition.amount_minor ?? 0) / 100);
  }
  if (kind === "credits") {
    const credits = Number(definition.credits ?? 0);
    return `${credits} crédito${credits === 1 ? "" : "s"}`;
  }
  if (kind === "validity_extension") {
    const days = Number(definition.days ?? 0);
    return `${days} día${days === 1 ? "" : "s"} extra${days === 1 ? "" : "s"}`;
  }
  if (kind === "surcharge_waiver") {
    return String(definition.label ?? "Sin recargo");
  }
  if (kind === "badge") {
    return String(definition.title ?? definition.label ?? "Nuevo logro");
  }

  return String(definition.label ?? definition.description ?? "Beneficio especial");
}

function noticeVisibility(
  communicationValue: unknown,
  defaultVisibility: NoticeVisibility,
): NoticeVisibility | "silent" {
  const communication = asObject(communicationValue);

  if (communication.unlock_notice === false || communication.unlock_visibility === "silent") {
    return "silent";
  }

  if (communication.unlock_visibility === "high") return "high";
  if (communication.unlock_visibility === "light") return "light";
  return defaultVisibility;
}

export const getPendingStudentRewardNotices = cache(async (): Promise<StudentRewardNotice[]> => {
  const portal = await getStudentPortalContext();
  const studioId = portal.membership.studio_id;
  const studentId = portal.snapshot.profile.student_id;

  const [eventsResult, achievementsResult, receiptsResult] = await Promise.all([
    portal.supabase
      .from("reward_instance_events")
      .select("id,reward_instance_id,event_type,occurred_at")
      .eq("studio_id", studioId)
      .in("event_type", ["created", "unlocked", "auto_applied"])
      .order("occurred_at", { ascending: false })
      .limit(40),
    portal.supabase
      .from("reward_achievement_unlocks")
      .select(
        "id,rule_id,version_number,title_snapshot,badge_snapshot,unlocked_at",
      )
      .eq("studio_id", studioId)
      .eq("student_id", studentId)
      .order("unlocked_at", { ascending: false })
      .limit(20),
    portal.supabase
      .from("reward_notice_receipts")
      .select("source_key")
      .eq("studio_id", studioId)
      .eq("student_id", studentId),
  ]);

  if (eventsResult.error || achievementsResult.error || receiptsResult.error) {
    return [];
  }

  const seen = new Set((receiptsResult.data ?? []).map((row) => row.source_key));
  const eventRows = eventsResult.data ?? [];
  const rewardIds = [...new Set(eventRows.map((row) => row.reward_instance_id))];

  const rewardsResult = rewardIds.length
    ? await portal.supabase
        .from("reward_instances")
        .select(
          "id,student_id,rule_id,version_number,kind,status,delivery_mode,benefit_definition,available_from,manually_granted",
        )
        .eq("studio_id", studioId)
        .eq("student_id", studentId)
        .in("id", rewardIds)
    : { data: [], error: null };

  if (rewardsResult.error) return [];

  const rewards = rewardsResult.data ?? [];
  const rewardMap = new Map(rewards.map((reward) => [reward.id, reward]));

  const ruleVersionKeys = [
    ...new Set(
      [
        ...rewards
          .filter((reward) => reward.rule_id && reward.version_number)
          .map((reward) => `${reward.rule_id}:${reward.version_number}`),
        ...(achievementsResult.data ?? []).map(
          (achievement) => `${achievement.rule_id}:${achievement.version_number}`,
        ),
      ],
    ),
  ];

  const ruleIds = [
    ...new Set(
      ruleVersionKeys.map((key) => key.split(":")[0]).filter((value): value is string => Boolean(value)),
    ),
  ];

  const versionsResult = ruleIds.length
    ? await portal.supabase
        .from("reward_rule_versions")
        .select("rule_id,version_number,name,communication_definition")
        .in("rule_id", ruleIds)
    : { data: [], error: null };

  if (versionsResult.error) return [];

  const versionMap = new Map(
    (versionsResult.data ?? []).map((version) => [
      `${version.rule_id}:${version.version_number}`,
      version,
    ]),
  );

  const notices: StudentRewardNotice[] = [];
  const handledRewards = new Set<string>();

  for (const event of eventRows) {
    const reward = rewardMap.get(event.reward_instance_id);
    if (!reward || handledRewards.has(reward.id)) continue;

    const sourceKey = `reward:${reward.id}`;
    if (seen.has(sourceKey)) {
      handledRewards.add(reward.id);
      continue;
    }

    if (
      event.event_type === "created" &&
      !reward.manually_granted &&
      reward.status !== "blocked"
    ) {
      continue;
    }

    const version =
      reward.rule_id && reward.version_number
        ? versionMap.get(`${reward.rule_id}:${reward.version_number}`)
        : null;
    const label = benefitLabel(reward.kind, reward.benefit_definition);

    let kind: StudentRewardNotice["kind"];
    let defaultVisibility: NoticeVisibility;
    let title: string;
    let body: string;

    if (event.event_type === "auto_applied") {
      kind = "automatic";
      defaultVisibility = "light";
      title = "Beneficio aplicado";
      body = `${label} ya se agregó automáticamente.`;
    } else if (reward.delivery_mode === "auto_apply" && reward.status === "blocked") {
      kind = "automatic_pending";
      defaultVisibility = "light";
      title = "Beneficio desbloqueado";
      body = `Ganaste ${label}. Estamos terminando de aplicarlo; todavía no aparece como utilizado.`;
    } else if (reward.status === "blocked") {
      kind = "future";
      defaultVisibility = "light";
      title = "Recompensa desbloqueada";
      body = `Ganaste ${label}. Estará disponible cuando abra su periodo de uso.`;
    } else if (["available", "reserved"].includes(reward.status)) {
      kind = "available";
      defaultVisibility = "high";
      title = "Nueva recompensa";
      body = `${label} ya está disponible en tu cuenta.`;
    } else {
      handledRewards.add(reward.id);
      continue;
    }

    const visibility = noticeVisibility(
      version?.communication_definition,
      defaultVisibility,
    );
    handledRewards.add(reward.id);

    if (visibility === "silent") continue;

    notices.push({
      sourceKey,
      kind,
      visibility,
      title,
      body,
      href: `/student/recompensas/${reward.id}`,
      occurredAt: event.occurred_at,
    });
  }

  for (const achievement of achievementsResult.data ?? []) {
    const sourceKey = `achievement:${achievement.id}`;
    if (seen.has(sourceKey)) continue;

    const version = versionMap.get(
      `${achievement.rule_id}:${achievement.version_number}`,
    );
    const visibility = noticeVisibility(version?.communication_definition, "light");

    if (visibility === "silent") continue;

    notices.push({
      sourceKey,
      kind: "achievement",
      visibility,
      title: "Nuevo logro",
      body: `Desbloqueaste “${achievement.title_snapshot}”.`,
      href: "/student/recompensas/logros",
      occurredAt: achievement.unlocked_at,
    });
  }

  return notices
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    .slice(0, 6);
});
