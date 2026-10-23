import "server-only";

import type { getAdminContext } from "@/lib/auth/admin-context";

/**
 * P360-V2-08 · Progreso de la persona: medallas, logros, recompensas y nivel técnico.
 * Sólo se lee en las pestañas que lo muestran (Progreso y Actividad).
 */
export async function readProgress(
  supabase: Awaited<ReturnType<typeof getAdminContext>>["supabase"],
  studioId: string,
  studentId: string,
  flags: { rewards: boolean; evaluations: boolean },
) {
  const [
    statusMembershipResult,
    onboardingResult,
    rewardCountResult,
    achievementRowsResult,
    levelUnlockRowsResult,
    rewardRowsResult,
    studentLevelRowsResult,
  ] = await Promise.all([
    flags.rewards
      ? supabase
          .from("reward_status_memberships")
          .select("current_level_key")
          .eq("studio_id", studioId)
          .eq("student_id", studentId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    flags.rewards
      ? supabase
          .from("reward_onboarding")
          .select(
            "documents_completed_at,profile_completed_at,app_installed_at,notifications_enabled_at,first_reservation_at,first_attendance_at,access_unlocked_at,access_method,access_reason",
          )
          .eq("studio_id", studioId)
          .eq("student_id", studentId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    flags.rewards
      ? supabase
          .from("reward_instances")
          .select("id", { count: "exact", head: true })
          .eq("studio_id", studioId)
          .eq("student_id", studentId)
          .eq("status", "available")
      : Promise.resolve({ data: null, count: 0 }),
    flags.rewards
      ? supabase
          .from("reward_achievement_unlocks")
          .select("id,title_snapshot,achievement_key,level_key,unlocked_at")
          .eq("studio_id", studioId)
          .eq("student_id", studentId)
          .order("unlocked_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] }),
    flags.rewards
      ? supabase
          .from("reward_status_months")
          .select("id,resulting_level_key,closed_at,period_start")
          .eq("studio_id", studioId)
          .eq("student_id", studentId)
          .eq("is_closed", true)
          .not("resulting_level_key", "is", null)
          .order("period_start", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] }),
    flags.rewards
      ? supabase
          .from("reward_instances")
          .select("id,reward_key,status,kind,benefit_definition,expires_at,redeemed_at,created_at")
          .eq("studio_id", studioId)
          .eq("student_id", studentId)
          .order("created_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [] }),
    flags.evaluations
      ? supabase
          .from("student_discipline_levels")
          .select("discipline_id,discipline_technical_level_id")
          .eq("studio_id", studioId)
          .eq("student_id", studentId)
      : Promise.resolve({ data: [] }),
  ]);

  let levelTitle: string | null = null;
  let rewardOnboarding: {
    documentsCompletedAt: string | null;
    profileCompletedAt: string | null;
    appInstalledAt: string | null;
    notificationsEnabledAt: string | null;
    firstReservationAt: string | null;
    firstAttendanceAt: string | null;
    accessUnlockedAt: string | null;
    accessMethod: string | null;
    accessReason: string | null;
  } | null = null;
  let rewardsAvailable: number | null = null;
  let technicalLevels: Array<{ disciplineName: string; levelTitle: string }> = [];
  let rewardAchievements: Array<{
    id: string;
    title: string;
    levelKey: string | null;
    unlockedAt: string;
  }> = [];
  let rewardLevelHistory: Array<{
    id: string;
    title: string;
    levelOrder: number;
    unlockedAt: string;
  }> = [];
  let rewardInstancesDetail: Array<{
    id: string;
    rewardKey: string | null;
    status: string;
    kind: string;
    expiresAt: string | null;
    redeemedAt: string | null;
    createdAt: string;
    benefitDefinition: unknown;
  }> = [];
  if (flags.rewards) {
    const statusMembership = statusMembershipResult.data;
    const onboardingRow = onboardingResult.data;
    const achievementRows = achievementRowsResult.data ?? [];
    const levelUnlockRows = levelUnlockRowsResult.data ?? [];
    const rewardRows = rewardRowsResult.data ?? [];

    rewardOnboarding = onboardingRow
      ? {
          documentsCompletedAt: onboardingRow.documents_completed_at,
          profileCompletedAt: onboardingRow.profile_completed_at,
          appInstalledAt: onboardingRow.app_installed_at,
          notificationsEnabledAt: onboardingRow.notifications_enabled_at,
          firstReservationAt: onboardingRow.first_reservation_at,
          firstAttendanceAt: onboardingRow.first_attendance_at,
          accessUnlockedAt: onboardingRow.access_unlocked_at,
          accessMethod: onboardingRow.access_method,
          accessReason: onboardingRow.access_reason,
        }
      : null;

    if (statusMembership?.current_level_key) {
      const { data: statusLevel } = await supabase
        .from("reward_status_level_definitions")
        .select("title")
        .eq("studio_id", studioId)
        .eq("level_key", statusMembership.current_level_key)
        .maybeSingle();

      levelTitle = statusLevel?.title ?? null;
    }

    rewardsAvailable = rewardCountResult.count ?? 0;

    rewardAchievements = (achievementRows ?? []).map((item) => ({
      id: item.id,
      title: item.title_snapshot || item.achievement_key || "Logro",
      levelKey: item.level_key,
      unlockedAt: item.unlocked_at,
    }));
    const medalTitles: Record<string, { title: string; order: number }> = {
      bronze: { title: "Bronce", order: 1 },
      silver: { title: "Plata", order: 2 },
      gold: { title: "Oro", order: 3 },
      diamond: { title: "Diamante", order: 4 },
    };
    rewardLevelHistory = (levelUnlockRows ?? []).flatMap((item) => {
      const medal = item.resulting_level_key ? medalTitles[item.resulting_level_key] : null;
      if (!medal) return [];
      return [
        {
          id: item.id,
          title: medal.title,
          levelOrder: medal.order,
          unlockedAt: item.closed_at ?? `${item.period_start}T12:00:00Z`,
        },
      ];
    });
    rewardInstancesDetail = (rewardRows ?? []).map((item) => ({
      id: item.id,
      rewardKey: item.reward_key,
      status: item.status,
      kind: item.kind,
      expiresAt: item.expires_at,
      redeemedAt: item.redeemed_at,
      createdAt: item.created_at,
      benefitDefinition: item.benefit_definition,
    }));
  }

  if (flags.evaluations) {
    const studentLevelRows = studentLevelRowsResult.data ?? [];
    const disciplineIds = [
      ...new Set(studentLevelRows.map((item) => item.discipline_id).filter(Boolean)),
    ];
    const disciplineLevelIds = [
      ...new Set(
        studentLevelRows.map((item) => item.discipline_technical_level_id).filter(Boolean),
      ),
    ];

    const [{ data: disciplineRows }, { data: disciplineLevelRows }] = await Promise.all([
      disciplineIds.length
        ? supabase.from("disciplines").select("id,name").in("id", disciplineIds)
        : Promise.resolve({ data: [] }),
      disciplineLevelIds.length
        ? supabase
            .from("discipline_technical_levels")
            .select("id,technical_level_id")
            .in("id", disciplineLevelIds)
        : Promise.resolve({ data: [] }),
    ]);

    const technicalLevelIds = [
      ...new Set(
        (disciplineLevelRows ?? []).map((item) => item.technical_level_id).filter(Boolean),
      ),
    ];
    const { data: technicalLevelRows } = technicalLevelIds.length
      ? await supabase
          .from("technical_level_definitions")
          .select("id,title")
          .in("id", technicalLevelIds)
      : { data: [] };

    const disciplineNameMap = new Map((disciplineRows ?? []).map((item) => [item.id, item.name]));
    const disciplineTechnicalLevelMap = new Map(
      (disciplineLevelRows ?? []).map((item) => [item.id, item.technical_level_id]),
    );
    const technicalLevelTitleMap = new Map(
      (technicalLevelRows ?? []).map((item) => [item.id, item.title]),
    );

    technicalLevels = (studentLevelRows ?? [])
      .map((item) => {
        const technicalLevelId = disciplineTechnicalLevelMap.get(
          item.discipline_technical_level_id,
        );
        const disciplineName = disciplineNameMap.get(item.discipline_id);
        const technicalLevelTitle = technicalLevelId
          ? technicalLevelTitleMap.get(technicalLevelId)
          : null;
        return disciplineName && technicalLevelTitle
          ? { disciplineName, levelTitle: technicalLevelTitle }
          : null;
      })
      .filter((item): item is { disciplineName: string; levelTitle: string } => Boolean(item))
      .sort((left, right) => left.disciplineName.localeCompare(right.disciplineName, "es"));
  }

  return {
    levelTitle,
    rewardOnboarding,
    rewardsAvailable,
    technicalLevels,
    rewardAchievements,
    rewardLevelHistory,
    rewardInstancesDetail,
  };
}

export type ProfileProgress = Awaited<ReturnType<typeof readProgress>>;

export const EMPTY_PROGRESS: ProfileProgress = {
  levelTitle: null,
  rewardOnboarding: null,
  rewardsAvailable: null,
  technicalLevels: [],
  rewardAchievements: [],
  rewardLevelHistory: [],
  rewardInstancesDetail: [],
};
