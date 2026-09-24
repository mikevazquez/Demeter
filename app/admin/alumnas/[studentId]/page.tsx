import Link from "next/link";
import PendingActionButton from "@/app/admin/components/PendingActionButton";
import StudentLifecycleActions from "./StudentLifecycleActions";
import StudentLifecycleNoticeDialog from "./StudentLifecycleNoticeDialog";
import Profile360Overview from "./Profile360Overview";
import StudentPackageCard from "./StudentPackageCard";
import StudentPortalAccessSection from "./StudentPortalAccessSection";
import StudentEvaluationsPanel from "./StudentEvaluationsPanel";
import StudentDocumentsPanel from "./StudentDocumentsPanel";
import { notFound } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import {
  unlockMedalsAccess,
  updateCommunicationPreferences,
  updateDynamicProfileFields,
  updateStudent,
} from "./actions";

const structuralFieldKeys = new Set(["first_name", "last_name", "phone", "email"]);

const lifecycleCopy: Record<string, string> = {
  active: "Activa",
  inactive: "Inactiva",
};

const acquisitionStatusCopy: Record<string, string> = {
  active: "Activa",
  expired: "Vencida",
  cancelled: "Cancelada",
};

const communicationOriginCopy: Record<string, string> = {
  admin: "Administración",
  student: "Alumna",
  system: "Sistema",
  integration: "Integración",
};

const communicationFieldCopy: Record<string, string> = {
  operational: "Operativas",
  reminders: "Recordatorios",
  retention: "Retención / seguimiento",
  promotions: "Promociones",
  whatsapp_blocked: "Bloqueo total de WhatsApp",
};

function optionValues(options: unknown): string[] {
  if (Array.isArray(options))
    return options.filter((value): value is string => typeof value === "string");

  if (options && typeof options === "object" && "choices" in options) {
    const choices = (options as { choices?: unknown }).choices;
    if (Array.isArray(choices)) {
      return choices.filter((value): value is string => typeof value === "string");
    }
  }

  return [];
}

function scalarValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Mexico_City",
  }).format(new Date(value));
}

function rewardStatusLabel(status: string) {
  const labels: Record<string, string> = {
    blocked: "Bloqueada",
    available: "Disponible",
    reserved: "Reservada",
    redeemed: "Usada",
    expired: "Vencida",
    revoked: "Revocada",
  };
  return labels[status] ?? status;
}

function rewardBenefitLabel(kind: string, benefit: unknown) {
  const data = benefit && typeof benefit === "object" ? (benefit as Record<string, unknown>) : {};
  if (kind === "credits" && typeof data.credits === "number") {
    return String(data.credits) + (data.credits === 1 ? " crédito" : " créditos");
  }
  if (kind === "percentage_discount" && typeof data.percentage === "number") {
    return String(data.percentage) + "% de descuento";
  }
  if (kind === "fixed_discount" && typeof data.amount_minor === "number") {
    return (
      new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: "MXN",
        maximumFractionDigits: 0,
      }).format(data.amount_minor / 100) + " de descuento"
    );
  }
  if (kind === "validity_extension" && typeof data.days === "number") {
    return String(data.days) + (data.days === 1 ? " día extra" : " días extra");
  }
  const labels: Record<string, string> = {
    surcharge_waiver: "Recargo bonificado",
    special_benefit: "Beneficio especial",
    badge: "Insignia",
    custom_manual: "Beneficio manual",
  };
  return labels[kind] ?? "Recompensa";
}

function localDateKey(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  return year + "-" + month + "-" + day;
}

export default async function StudentProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{
    saved?: string;
    error?: string;
    alta?: string;
    sale?: string;
    lifecycle?: string;
    lifecycle_error?: string;
    evaluation_error?: string;
    document_result?: string;
    document_error?: string;
    view?: string;
  }>;
}) {
  const { studentId } = await params;
  const query = await searchParams;
  const requestedView = String(query.view ?? "summary");
  const view = (
    [
      "summary",
      "packages",
      "rewards",
      "evaluations",
      "documents",
      "followup",
      "history",
      "profile",
    ].includes(requestedView)
      ? requestedView
      : "summary"
  ) as
    | "summary"
    | "packages"
    | "rewards"
    | "evaluations"
    | "documents"
    | "followup"
    | "history"
    | "profile";
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.STUDENTS_READ);

  const { data: student } = await supabase
    .from("students")
    .select(
      "id, person_id, user_id, full_name, email, phone, lifecycle_status, profile_status, created_at, archived_at",
    )
    .eq("id", studentId)
    .eq("studio_id", studio.id)
    .maybeSingle();

  if (!student || student.lifecycle_status === "archived") notFound();

  const canReadProducts = can(CAPABILITIES.PRODUCTS_READ);
  const canEditAcquisitions = can(CAPABILITIES.PRODUCTS_WRITE) || can(CAPABILITIES.SALES_WRITE);

  const [
    { data: person },
    { data: contacts },
    { data: definitions },
    { data: fieldValues },
    acquisitionResult,
    communicationPreferencesResult,
    communicationPreferenceEventsResult,
  ] = await Promise.all([
    student.person_id
      ? supabase
          .from("persons")
          .select("id, first_name, last_name")
          .eq("id", student.person_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    student.person_id
      ? supabase
          .from("person_contacts")
          .select("kind, value, is_primary")
          .eq("person_id", student.person_id)
          .order("kind")
      : Promise.resolve({ data: [] }),
    supabase
      .from("profile_field_definitions")
      .select("id, key, label, field_type, required, options, sort_order")
      .eq("studio_id", studio.id)
      .eq("entity_type", "student")
      .eq("active", true)
      .order("sort_order")
      .order("label"),
    student.person_id
      ? supabase
          .from("profile_field_values")
          .select("definition_id, value")
          .eq("person_id", student.person_id)
      : Promise.resolve({ data: [] }),
    canReadProducts
      ? supabase
          .from("product_acquisitions")
          .select(
            "id,product_template_id,status,starts_on,expires_on,unlimited,credit_limit,refunded_at,created_at,activation_mode,access_blocked,validity_days_snapshot,sale_line_id",
          )
          .eq("student_id", student.id)
          .eq("studio_id", studio.id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    student.person_id
      ? supabase
          .from("person_communication_preferences")
          .select(
            "operational_enabled,reminders_enabled,retention_enabled,promotions_enabled,whatsapp_blocked,updated_origin,updated_at",
          )
          .eq("studio_id", studio.id)
          .eq("person_id", student.person_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    student.person_id
      ? supabase
          .from("person_communication_preference_events")
          .select("id,origin,changed_fields,reason,created_at")
          .eq("studio_id", studio.id)
          .eq("person_id", student.person_id)
          .order("created_at", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] }),
  ]);

  const acquisitions = acquisitionResult.data ?? [];
  const acquisitionIds = acquisitions.map((item) => item.id);
  const productIds = [...new Set(acquisitions.map((item) => item.product_template_id))];
  const [{ data: acquisitionProducts }, { data: ledgerRows }] = canReadProducts
    ? await Promise.all([
        productIds.length
          ? supabase
              .from("product_templates")
              .select("id,name,package_term")
              .eq("studio_id", studio.id)
              .in("id", productIds)
          : Promise.resolve({ data: [] }),
        acquisitionIds.length
          ? supabase
              .from("credit_ledger")
              .select("acquisition_id,quantity")
              .eq("studio_id", studio.id)
              .in("acquisition_id", acquisitionIds)
          : Promise.resolve({ data: [] }),
      ])
    : [{ data: [] }, { data: [] }];

  const productMap = new Map((acquisitionProducts ?? []).map((item) => [item.id, item]));
  const balanceMap = new Map<string, number>();
  for (const row of ledgerRows ?? []) {
    balanceMap.set(row.acquisition_id, (balanceMap.get(row.acquisition_id) ?? 0) + row.quantity);
  }

  const phone = contacts?.find((item) => item.kind === "phone")?.value ?? student.phone;
  const email = contacts?.find((item) => item.kind === "email")?.value ?? student.email ?? "";
  const firstName = person?.first_name ?? student.full_name.split(" ")[0] ?? "";
  const lastName = person?.last_name ?? student.full_name.split(" ").slice(1).join(" ");
  const communicationPreferenceRow = communicationPreferencesResult.data;
  const communicationPreferences = {
    operational: communicationPreferenceRow?.operational_enabled ?? true,
    reminders: communicationPreferenceRow?.reminders_enabled ?? true,
    retention: communicationPreferenceRow?.retention_enabled ?? true,
    promotions: communicationPreferenceRow?.promotions_enabled ?? true,
    whatsappBlocked: communicationPreferenceRow?.whatsapp_blocked ?? false,
  };
  const communicationPreferenceEvents = communicationPreferenceEventsResult.data ?? [];
  const canEdit = can(CAPABILITIES.STUDENTS_WRITE);
  const canReadSchedule = can(CAPABILITIES.SCHEDULE_READ);
  const canReadSales = can(CAPABILITIES.SALES_READ);
  const canReadRewards = can(CAPABILITIES.REWARDS_READ);
  const canManageRewards = can(CAPABILITIES.REWARDS_MANAGE);
  const canReadEvaluations = can(CAPABILITIES.EVALUATIONS_READ);
  const canReadDocuments = can(CAPABILITIES.DOCUMENTS_READ);
  const canArchive = can(CAPABILITIES.STUDENTS_ARCHIVE);
  const lifecycleEventsResult = canArchive
    ? await supabase
        .from("student_lifecycle_events")
        .select("id, from_status, to_status, created_at")
        .eq("student_id", student.id)
        .eq("studio_id", studio.id)
        .order("created_at", { ascending: false })
        .limit(12)
    : { data: [] };
  const lifecycleEvents = lifecycleEventsResult.data ?? [];
  const timeZone = studio.timezone ?? "America/Mexico_City";
  const today = localDateKey(timeZone);
  const liveAcquisitions = acquisitions.filter(
    (item) => item.status === "active" && !item.refunded_at,
  );
  const currentAcquisition =
    liveAcquisitions
      .filter(
        (item) =>
          (!item.starts_on || item.starts_on <= today) &&
          (!item.expires_on || item.expires_on >= today),
      )
      .sort((a, b) =>
        String(b.starts_on ?? b.created_at).localeCompare(String(a.starts_on ?? a.created_at)),
      )[0] ?? null;
  const scheduledAcquisitions = liveAcquisitions
    .filter((item) => Boolean(item.starts_on && item.starts_on > today))
    .sort((a, b) => String(a.starts_on).localeCompare(String(b.starts_on)));
  const scheduledAcquisition = scheduledAcquisitions[0] ?? null;
  const scheduledAcquisitionIds = new Set(scheduledAcquisitions.map((item) => item.id));
  const historicalAcquisitions = acquisitions.filter(
    (item) => item.id !== currentAcquisition?.id && !scheduledAcquisitionIds.has(item.id),
  );

  const dynamicDefinitions = (definitions ?? []).filter(
    (definition) => !structuralFieldKeys.has(definition.key),
  );
  const valueMap = new Map((fieldValues ?? []).map((item) => [item.definition_id, item.value]));
  const birthDateDefinition = (definitions ?? []).find(
    (definition) => definition.key === "birth_date",
  );
  const birthDateValue = birthDateDefinition ? valueMap.get(birthDateDefinition.id) : null;
  const birthDate = typeof birthDateValue === "string" ? birthDateValue : null;

  type PackageClassEvent = {
    id: string;
    acquisitionId: string | null;
    status: string;
    className: string;
    startsAt: string;
    cancelledAt: string | null;
    creditsHeld: number;
  };
  const packageClassEvents = new Map<string, PackageClassEvent[]>();
  const generalClassEvents: PackageClassEvent[] = [];

  let nextClass: { name: string; startsAt: string } | null = null;
  if (canReadSchedule) {
    const { data: reservationRows } = await supabase
      .from("reservations")
      .select("id,session_id,acquisition_id,status,credits_held,cancelled_at")
      .eq("studio_id", studio.id)
      .eq("student_id", student.id)
      .order("booked_at", { ascending: false });

    const allSessionIds = [...new Set((reservationRows ?? []).map((item) => item.session_id))];
    const { data: sessionRows } = allSessionIds.length
      ? await supabase
          .from("class_sessions")
          .select("id,template_id,starts_at")
          .eq("studio_id", studio.id)
          .in("id", allSessionIds)
      : { data: [] };

    const templateIds = [...new Set((sessionRows ?? []).map((item) => item.template_id))];
    const { data: templateRows } = templateIds.length
      ? await supabase
          .from("class_templates")
          .select("id,name")
          .eq("studio_id", studio.id)
          .in("id", templateIds)
      : { data: [] };

    const sessionMap = new Map((sessionRows ?? []).map((item) => [item.id, item]));
    const templateNameMap = new Map((templateRows ?? []).map((item) => [item.id, item.name]));

    for (const reservation of reservationRows ?? []) {
      const session = sessionMap.get(reservation.session_id);
      if (!session) continue;
      const event: PackageClassEvent = {
        id: reservation.id,
        acquisitionId: reservation.acquisition_id,
        status: reservation.status,
        className: templateNameMap.get(session.template_id) ?? "Clase",
        startsAt: session.starts_at,
        cancelledAt: reservation.cancelled_at,
        creditsHeld: reservation.credits_held ?? 0,
      };
      generalClassEvents.push(event);
      if (reservation.acquisition_id) {
        const list = packageClassEvents.get(reservation.acquisition_id) ?? [];
        list.push(event);
        packageClassEvents.set(reservation.acquisition_id, list);
      }
    }

    for (const events of packageClassEvents.values()) {
      events.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
    }
    generalClassEvents.sort((a, b) => b.startsAt.localeCompare(a.startsAt));

    if (currentAcquisition) {
      const upcoming = (packageClassEvents.get(currentAcquisition.id) ?? [])
        .filter((event) => event.status === "reserved" && new Date(event.startsAt) > new Date())
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
      if (upcoming) {
        nextClass = { name: upcoming.className, startsAt: upcoming.startsAt };
      }
    }
  }

  let historicalValueMinor: number | null = null;
  let pendingBalanceMinor = 0;
  if (canReadSales) {
    const { data: confirmedSales } = await supabase
      .from("sales")
      .select("id,total_minor,status")
      .eq("studio_id", studio.id)
      .eq("student_id", student.id)
      .eq("status", "confirmed");
    const saleIds = (confirmedSales ?? []).map((sale) => sale.id);
    const { data: payments } = saleIds.length
      ? await supabase
          .from("payments")
          .select("sale_id,kind,amount_minor")
          .eq("studio_id", studio.id)
          .in("sale_id", saleIds)
      : { data: [] };
    const paidBySale = new Map<string, number>();
    for (const payment of payments ?? []) {
      const signedAmount = payment.kind === "refund" ? -payment.amount_minor : payment.amount_minor;
      paidBySale.set(payment.sale_id, (paidBySale.get(payment.sale_id) ?? 0) + signedAmount);
    }
    historicalValueMinor = [...paidBySale.values()].reduce((sum, amount) => sum + amount, 0);
    pendingBalanceMinor = (confirmedSales ?? []).reduce(
      (sum, sale) => sum + Math.max(0, sale.total_minor - (paidBySale.get(sale.id) ?? 0)),
      0,
    );
  }

  const { data: enrollmentRows } = await supabase
    .from("student_enrollments")
    .select("id,status,starts_on,expires_on,created_at")
    .eq("studio_id", studio.id)
    .eq("student_id", student.id)
    .order("created_at", { ascending: false });
  const enrollment =
    (enrollmentRows ?? []).find(
      (item) =>
        item.status === "active" &&
        (!item.starts_on || item.starts_on <= today) &&
        (!item.expires_on || item.expires_on >= today),
    ) ??
    (enrollmentRows ?? [])[0] ??
    null;

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
  if (canReadRewards) {
    const [{ data: statusMembership }, { data: onboardingRow }] = await Promise.all([
      supabase
        .from("reward_status_memberships")
        .select("current_level_key")
        .eq("studio_id", studio.id)
        .eq("student_id", student.id)
        .maybeSingle(),
      supabase
        .from("reward_onboarding")
        .select(
          "documents_completed_at,profile_completed_at,app_installed_at,notifications_enabled_at,first_reservation_at,first_attendance_at,access_unlocked_at,access_method,access_reason",
        )
        .eq("studio_id", studio.id)
        .eq("student_id", student.id)
        .maybeSingle(),
    ]);

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
        .eq("studio_id", studio.id)
        .eq("level_key", statusMembership.current_level_key)
        .maybeSingle();

      levelTitle = statusLevel?.title ?? null;
    }

    const rewardCountResult = await supabase
      .from("reward_instances")
      .select("id", { count: "exact", head: true })
      .eq("studio_id", studio.id)
      .eq("student_id", student.id)
      .eq("status", "available");
    rewardsAvailable = rewardCountResult.count ?? 0;

    const [{ data: achievementRows }, { data: levelUnlockRows }, { data: rewardRows }] =
      await Promise.all([
        supabase
          .from("reward_achievement_unlocks")
          .select("id,title_snapshot,achievement_key,level_key,unlocked_at")
          .eq("studio_id", studio.id)
          .eq("student_id", student.id)
          .order("unlocked_at", { ascending: false })
          .limit(20),
        supabase
          .from("reward_program_level_unlocks")
          .select("id,title_snapshot,level_order_snapshot,unlocked_at")
          .eq("studio_id", studio.id)
          .eq("student_id", student.id)
          .order("unlocked_at", { ascending: false })
          .limit(20),
        supabase
          .from("reward_instances")
          .select("id,reward_key,status,kind,benefit_definition,expires_at,redeemed_at,created_at")
          .eq("studio_id", studio.id)
          .eq("student_id", student.id)
          .order("created_at", { ascending: false })
          .limit(30),
      ]);

    rewardAchievements = (achievementRows ?? []).map((item) => ({
      id: item.id,
      title: item.title_snapshot || item.achievement_key || "Logro",
      levelKey: item.level_key,
      unlockedAt: item.unlocked_at,
    }));
    rewardLevelHistory = (levelUnlockRows ?? []).map((item) => ({
      id: item.id,
      title: item.title_snapshot || "Nivel",
      levelOrder: item.level_order_snapshot,
      unlockedAt: item.unlocked_at,
    }));
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

  if (canReadEvaluations) {
    const { data: studentLevelRows } = await supabase
      .from("student_discipline_levels")
      .select("discipline_id,discipline_technical_level_id")
      .eq("studio_id", studio.id)
      .eq("student_id", student.id);

    const disciplineIds = [
      ...new Set((studentLevelRows ?? []).map((item) => item.discipline_id).filter(Boolean)),
    ];
    const disciplineLevelIds = [
      ...new Set(
        (studentLevelRows ?? []).map((item) => item.discipline_technical_level_id).filter(Boolean),
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

  type ProfileHistoryEvent = {
    id: string;
    at: string;
    kind: "class" | "package" | "reward" | "status";
    title: string;
    detail: string;
  };
  const profileHistoryEvents: ProfileHistoryEvent[] = [];

  for (const event of generalClassEvents) {
    const classTitleMap: Record<string, string> = {
      reserved: "Clase reservada",
      attended: "Asistió a clase",
      cancelled_on_time: "Canceló clase a tiempo",
      cancelled_late: "Cancelación tardía",
      no_show: "No show",
      cancelled_by_studio: "Clase cancelada por el estudio",
    };
    const isCancellation = ["cancelled_on_time", "cancelled_late", "cancelled_by_studio"].includes(
      event.status,
    );
    profileHistoryEvents.push({
      id: "class:" + event.id,
      at: isCancellation && event.cancelledAt ? event.cancelledAt : event.startsAt,
      kind: "class",
      title: classTitleMap[event.status] ?? "Actividad de clase",
      detail: isCancellation
        ? `${event.className} · clase programada ${formatDateTime(event.startsAt)}`
        : event.className,
    });
  }

  for (const acquisition of acquisitions) {
    profileHistoryEvents.push({
      id: "package:" + acquisition.id,
      at: acquisition.created_at,
      kind: "package",
      title: acquisition.id === currentAcquisition?.id ? "Paquete actual" : "Paquete registrado",
      detail: productMap.get(acquisition.product_template_id)?.name ?? "Paquete",
    });
  }

  for (const achievement of rewardAchievements) {
    profileHistoryEvents.push({
      id: "reward:" + achievement.id,
      at: achievement.unlockedAt,
      kind: "reward",
      title: "Logro desbloqueado",
      detail: achievement.title,
    });
  }

  for (const event of lifecycleEvents) {
    profileHistoryEvents.push({
      id: "status:" + event.id,
      at: event.created_at,
      kind: "status",
      title: "Cambio de estado",
      detail:
        (lifecycleCopy[event.from_status] ?? event.from_status) +
        " → " +
        (lifecycleCopy[event.to_status] ?? event.to_status),
    });
  }

  profileHistoryEvents.sort((a, b) => b.at.localeCompare(a.at));

  const currentPackageView = currentAcquisition
    ? {
        name: productMap.get(currentAcquisition.product_template_id)?.name ?? "Paquete",
        unlimited: currentAcquisition.unlimited,
        availableCredits: currentAcquisition.unlimited
          ? null
          : (balanceMap.get(currentAcquisition.id) ?? 0),
        creditLimit: currentAcquisition.credit_limit,
        startsOn: currentAcquisition.starts_on,
        expiresOn: currentAcquisition.expires_on,
      }
    : null;

  const alerts: Array<{ title: string; detail: string }> = [];
  if (student.lifecycle_status === "active" && !currentAcquisition && !scheduledAcquisition) {
    const latestRelevant = acquisitions.find((item) => !item.refunded_at && item.expires_on);
    alerts.push({
      title: latestRelevant?.expires_on ? "Paquete vencido" : "Sin paquete activo",
      detail: latestRelevant?.expires_on
        ? "El último paquete venció " + formatDate(latestRelevant.expires_on) + "."
        : "No hay un paquete vigente o programado.",
    });
  }
  if (
    currentAcquisition &&
    !currentAcquisition.unlimited &&
    (balanceMap.get(currentAcquisition.id) ?? 0) <= 0
  ) {
    alerts.push({
      title: "Sin créditos disponibles",
      detail: "El paquete continúa registrado, pero ya no tiene créditos disponibles.",
    });
  }
  if (currentAcquisition && !nextClass) {
    alerts.push({
      title: "Sin próxima clase",
      detail: "No hay una reserva futura asociada al paquete actual.",
    });
  }
  if (currentAcquisition?.access_blocked || pendingBalanceMinor > 0) {
    alerts.push({
      title: "Saldo pendiente",
      detail:
        pendingBalanceMinor > 0
          ? "Quedan $" + (pendingBalanceMinor / 100).toLocaleString("es-MX") + " MXN por cobrar."
          : "El paquete está bloqueado por una condición de pago pendiente.",
    });
  }
  if (enrollment && enrollment.status !== "active") {
    alerts.push({
      title: "Inscripción no vigente",
      detail: enrollment.expires_on
        ? "La última inscripción terminó " + formatDate(enrollment.expires_on) + "."
        : "Revisa el estado de inscripción de la alumna.",
    });
  }

  const errorCopy: Record<string, string> = {
    phone_exists: "Ese teléfono ya pertenece a otra alumna.",
    profile_fields: "No se pudieron guardar los campos adicionales. Revisa sus valores.",
    acquisition_forbidden: "Tu rol no puede modificar adquisiciones.",
    acquisition_not_found: "La adquisición ya no está disponible.",
    acquisition_date_invalid: "Selecciona una fecha de inicio válida.",
    credits_invalid: "Indica créditos disponibles válidos y un motivo obligatorio.",
    adjustment_reason_required: "El motivo del ajuste de créditos es obligatorio.",
    unlimited_acquisition: "Una adquisición ilimitada no admite ajuste manual de créditos.",
    acquisition_not_editable: "Esta adquisición ya no puede modificarse.",
    communication_preferences:
      "No se pudieron guardar las preferencias de comunicación. Inténtalo de nuevo.",
  };

  return (
    <main className="dashboard-shell profile360-page admin-ux04-profile360">
      <Profile360Overview
        activeView={view}
        student={{
          id: student.id,
          userId: student.user_id,
          fullName: student.full_name,
          lifecycleStatus: student.lifecycle_status,
          phone,
          email: email || null,
          createdAt: student.created_at,
        }}
        birthDate={birthDate}
        levelTitle={levelTitle}
        rewardsAvailable={rewardsAvailable}
        technicalLevels={technicalLevels}
        showEvaluations={canReadEvaluations}
        showDocuments={canReadDocuments}
        currentPackage={currentPackageView}
        nextClass={nextClass}
        historicalValueMinor={historicalValueMinor}
        enrollment={
          enrollment
            ? {
                status: enrollment.status,
                startsOn: enrollment.starts_on,
                expiresOn: enrollment.expires_on,
              }
            : null
        }
        alerts={alerts}
        timeZone={timeZone}
      />

      <StudentLifecycleNoticeDialog
        result={
          query.lifecycle === "active" || query.lifecycle === "inactive"
            ? query.lifecycle
            : undefined
        }
        error={query.lifecycle_error}
      />

      {query.error ? (
        <div className="notice error">
          {errorCopy[query.error] ?? "No se pudo guardar el cambio."}
        </div>
      ) : null}

      {query.alta === "finalizada" || query.alta === "sin_paquete" ? (
        <div className="notice success">
          {query.alta === "finalizada"
            ? "Alta registrada. La alumna, su compra y sus condiciones quedaron vinculadas al mismo expediente."
            : "Alta registrada sin paquete. El expediente queda disponible para operar cuando corresponda."}
          {query.sale ? (
            <div className="toolbar-actions mt-3">
              <Link className="ghost-button" href={`/admin/ventas/${query.sale}`}>
                Ver venta
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      {query.alta === "reserva_realizada" ? (
        <div className="notice success">
          Primera reserva registrada. Demeter mantuvo la misma alumna y aplicó las reglas reales de
          paquete, inscripción, créditos y cupo.
        </div>
      ) : null}

      {view === "profile" ? (
        <>
          <details id="datos-personales" className="profile360-detail scroll-mt-6">
            <summary>
              <span>
                <strong>Datos y contacto</strong>
                <small>Ver o editar información personal</small>
              </span>
              <span aria-hidden="true">›</span>
            </summary>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">EXPEDIENTE</p>
                  <h2>Datos generales</h2>
                </div>
                <span className="count-badge">
                  {student.profile_status === "complete" ? "Completo" : "Incompleto"}
                </span>
              </div>

              {canEdit ? (
                <form action={updateStudent} className="compact-form">
                  <input type="hidden" name="student_id" value={student.id} />
                  <div className="form-split">
                    <input
                      name="first_name"
                      required
                      defaultValue={firstName}
                      placeholder="Nombre"
                    />
                    <input name="last_name" defaultValue={lastName ?? ""} placeholder="Apellido" />
                  </div>
                  <input
                    name="phone"
                    type="tel"
                    required
                    defaultValue={phone}
                    placeholder="Teléfono"
                  />
                  <input name="email" type="email" defaultValue={email} placeholder="Correo" />
                  <PendingActionButton className="primary-button" pendingLabel="Guardando…">
                    Guardar cambios
                  </PendingActionButton>
                </form>
              ) : (
                <div className="student-list">
                  <div className="student-row">
                    <div>
                      <strong>{student.full_name}</strong>
                      <span>{phone}</span>
                      {email ? <span>{email}</span> : null}
                    </div>
                  </div>
                </div>
              )}
            </section>
          </details>

          {student.person_id ? (
            <details id="comunicacion" className="profile360-detail scroll-mt-6">
              <summary>
                <span>
                  <strong>Preferencias de comunicación</strong>
                  <small>WhatsApp, recordatorios y promociones</small>
                </span>
                <span aria-hidden="true">›</span>
              </summary>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">COMUNICACIÓN · AUT-05</p>
                    <h2>Preferencias de comunicación</h2>
                    <p>
                      Estas preferencias pertenecen a la persona y prevalecen sobre una
                      configuración global más permisiva. Un teléfono inválido se trata por separado
                      como error de datos.
                    </p>
                  </div>
                  <span className="status-pill">
                    {communicationPreferences.whatsappBlocked
                      ? "WhatsApp bloqueado"
                      : "WhatsApp permitido"}
                  </span>
                </div>

                {canEdit ? (
                  <form action={updateCommunicationPreferences} className="compact-form">
                    <input type="hidden" name="student_id" value={student.id} />
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <span className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            name="operational_enabled"
                            value="true"
                            defaultChecked={communicationPreferences.operational}
                          />
                          <strong>Operativas</strong>
                        </span>
                        <small>Reservas, cancelaciones, pagos y activaciones.</small>
                      </label>
                      <label className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <span className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            name="reminders_enabled"
                            value="true"
                            defaultChecked={communicationPreferences.reminders}
                          />
                          <strong>Recordatorios</strong>
                        </span>
                        <small>Recordatorios relacionados con reservas futuras.</small>
                      </label>
                      <label className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <span className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            name="retention_enabled"
                            value="true"
                            defaultChecked={communicationPreferences.retention}
                          />
                          <strong>Retención / seguimiento</strong>
                        </span>
                        <small>Seguimientos de experiencia, vencimiento e inactividad.</small>
                      </label>
                      <label className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <span className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            name="promotions_enabled"
                            value="true"
                            defaultChecked={communicationPreferences.promotions}
                          />
                          <strong>Promociones</strong>
                        </span>
                        <small>Beneficios, campañas y comunicaciones comerciales.</small>
                      </label>
                    </div>

                    <label className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <span className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          name="whatsapp_blocked"
                          value="true"
                          defaultChecked={communicationPreferences.whatsappBlocked}
                        />
                        <strong>Bloquear todas las comunicaciones por WhatsApp</strong>
                      </span>
                      <small>Este bloqueo prevalece sobre las cuatro categorías anteriores.</small>
                    </label>

                    <label className="grid gap-1 text-sm text-zinc-300">
                      Motivo del cambio (opcional)
                      <input
                        type="text"
                        name="reason"
                        maxLength={1000}
                        placeholder="Ej. La alumna solicitó no recibir promociones"
                        className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
                      />
                    </label>

                    <PendingActionButton
                      className="primary-button"
                      pendingLabel="Guardando preferencias…"
                    >
                      Guardar preferencias
                    </PendingActionButton>
                  </form>
                ) : (
                  <div className="student-list">
                    {[
                      ["Operativas", communicationPreferences.operational],
                      ["Recordatorios", communicationPreferences.reminders],
                      ["Retención / seguimiento", communicationPreferences.retention],
                      ["Promociones", communicationPreferences.promotions],
                    ].map(([label, enabled]) => (
                      <div className="student-row" key={String(label)}>
                        <div>
                          <strong>{String(label)}</strong>
                          <span>{enabled ? "Permitidas" : "Desactivadas"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-6">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">AUDITORÍA</p>
                      <h3>Últimos cambios</h3>
                    </div>
                    <span className="count-badge">{communicationPreferenceEvents.length}</span>
                  </div>

                  {!communicationPreferenceEvents.length ? (
                    <div className="empty-state">
                      No hay cambios registrados. Se aplican las preferencias permitidas por
                      defecto.
                    </div>
                  ) : (
                    <div className="student-list">
                      {communicationPreferenceEvents.map((event) => {
                        const changedFields = Array.isArray(event.changed_fields)
                          ? event.changed_fields
                              .map(
                                (field) => communicationFieldCopy[String(field)] ?? String(field),
                              )
                              .join(", ")
                          : "Preferencias";

                        return (
                          <div className="student-row" key={event.id}>
                            <div>
                              <strong>{changedFields}</strong>
                              <span>
                                {communicationOriginCopy[event.origin] ?? event.origin} ·{" "}
                                {formatDateTime(event.created_at)}
                              </span>
                              {event.reason ? <span>{event.reason}</span> : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            </details>
          ) : null}
        </>
      ) : null}

      {view === "packages" && canReadProducts ? (
        <section id="paquetes-y-creditos" className="profile360-packages-view">
          <div className="profile360-view-heading">
            <div>
              <p className="eyebrow">PAQUETES</p>
              <h2>Paquetes de la alumna</h2>
              <p>
                El paquete actual puede ajustarse. Los paquetes vencidos conservan su historia y
                permanecen en sólo lectura.
              </p>
            </div>
          </div>

          {currentAcquisition ? (
            <StudentPackageCard
              studentId={student.id}
              kind="current"
              acquisition={{
                id: currentAcquisition.id,
                name: productMap.get(currentAcquisition.product_template_id)?.name ?? "Paquete",
                statusLabel: "Activo",
                startsOn: currentAcquisition.starts_on,
                expiresOn: currentAcquisition.expires_on,
                unlimited: currentAcquisition.unlimited,
                availableCredits: currentAcquisition.unlimited
                  ? null
                  : (balanceMap.get(currentAcquisition.id) ?? 0),
                accessBlocked: currentAcquisition.access_blocked,
                activationMode: currentAcquisition.activation_mode,
              }}
              classes={packageClassEvents.get(currentAcquisition.id) ?? []}
              editable={canEditAcquisitions && !currentAcquisition.refunded_at}
              timeZone={timeZone}
            />
          ) : (
            <div className="empty-state">No hay paquete actual.</div>
          )}

          {scheduledAcquisitions.length ? (
            <div className="profile360-package-group">
              <div className="profile360-package-group-heading">
                <strong>Próximos paquetes</strong>
                <span>{scheduledAcquisitions.length}</span>
              </div>
              {scheduledAcquisitions.map((acquisition) => (
                <StudentPackageCard
                  key={acquisition.id}
                  studentId={student.id}
                  kind="scheduled"
                  acquisition={{
                    id: acquisition.id,
                    name: productMap.get(acquisition.product_template_id)?.name ?? "Paquete",
                    statusLabel: "Programado",
                    startsOn: acquisition.starts_on,
                    expiresOn: acquisition.expires_on,
                    unlimited: acquisition.unlimited,
                    availableCredits: acquisition.unlimited
                      ? null
                      : (balanceMap.get(acquisition.id) ?? 0),
                    accessBlocked: acquisition.access_blocked,
                    activationMode: acquisition.activation_mode,
                  }}
                  classes={packageClassEvents.get(acquisition.id) ?? []}
                  editable={false}
                  timeZone={timeZone}
                />
              ))}
            </div>
          ) : null}

          <div className="profile360-package-group">
            <div className="profile360-package-group-heading">
              <strong>Historial de paquetes</strong>
              <span>{historicalAcquisitions.length}</span>
            </div>
            {historicalAcquisitions.length ? (
              historicalAcquisitions.map((acquisition) => {
                const isExpiredByDate =
                  Boolean(acquisition.expires_on) && String(acquisition.expires_on) < today;
                const statusLabel = acquisition.refunded_at
                  ? "Reembolsado"
                  : isExpiredByDate
                    ? "Vencido"
                    : (acquisitionStatusCopy[acquisition.status] ?? "Histórico");
                return (
                  <StudentPackageCard
                    key={acquisition.id}
                    studentId={student.id}
                    kind="historical"
                    acquisition={{
                      id: acquisition.id,
                      name: productMap.get(acquisition.product_template_id)?.name ?? "Paquete",
                      statusLabel,
                      startsOn: acquisition.starts_on,
                      expiresOn: acquisition.expires_on,
                      unlimited: acquisition.unlimited,
                      availableCredits: acquisition.unlimited
                        ? null
                        : (balanceMap.get(acquisition.id) ?? 0),
                      accessBlocked: acquisition.access_blocked,
                      activationMode: acquisition.activation_mode,
                    }}
                    classes={packageClassEvents.get(acquisition.id) ?? []}
                    editable={false}
                    timeZone={timeZone}
                  />
                );
              })
            ) : (
              <div className="empty-state">Todavía no hay paquetes anteriores.</div>
            )}
          </div>
        </section>
      ) : null}

      {view === "rewards" ? (
        <section className="profile360-view-panel">
          <div className="profile360-view-heading">
            <div>
              <p className="eyebrow">REWARDS</p>
              <h2>Progreso, logros y recompensas</h2>
              <p>
                Las medallas representan progreso y beneficios de Rewards; son independientes de los
                niveles técnicos por disciplina.
              </p>
            </div>
          </div>

          {rewardOnboarding ? (
            <div className="mb-5 rounded-3xl border border-fuchsia-500/20 bg-fuchsia-500/[0.04] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">ACTIVACIÓN DE MEDALLAS</p>
                  <h3 className="mt-1 text-lg font-semibold text-white">
                    {rewardOnboarding.accessUnlockedAt
                      ? "Acceso a Medallas habilitado"
                      : "Activando Medallas"}
                  </h3>
                  <p className="mt-1 text-xs text-zinc-400">
                    {
                      [
                        rewardOnboarding.documentsCompletedAt,
                        rewardOnboarding.profileCompletedAt,
                        rewardOnboarding.appInstalledAt,
                        rewardOnboarding.notificationsEnabledAt,
                        rewardOnboarding.firstReservationAt,
                        rewardOnboarding.firstAttendanceAt,
                      ].filter(Boolean).length
                    }{" "}
                    de 6 pasos completados
                  </p>
                </div>
                <span className="status-pill">
                  {rewardOnboarding.accessUnlockedAt ? "Acceso activo" : "En activación"}
                </span>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {[
                  ["Documentos", rewardOnboarding.documentsCompletedAt],
                  ["Perfil", rewardOnboarding.profileCompletedAt],
                  ["App instalada", rewardOnboarding.appInstalledAt],
                  ["Notificaciones Push", rewardOnboarding.notificationsEnabledAt],
                  ["Primera reserva", rewardOnboarding.firstReservationAt],
                  ["Primera asistencia", rewardOnboarding.firstAttendanceAt],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-3.5 py-3"
                  >
                    <span className="text-sm font-medium text-white">{label}</span>
                    <span className={value ? "text-xs text-emerald-300" : "text-xs text-zinc-500"}>
                      {value ? "✓ " + formatDateTime(String(value)) : "Pendiente"}
                    </span>
                  </div>
                ))}
              </div>

              {rewardOnboarding.accessUnlockedAt ? (
                <p className="mt-3 text-xs text-zinc-500">
                  Acceso habilitado por{" "}
                  {rewardOnboarding.accessMethod === "admin"
                    ? "excepción administrativa"
                    : rewardOnboarding.accessMethod === "legacy"
                      ? "migración del sistema anterior"
                      : "onboarding"}
                  {rewardOnboarding.accessReason ? " · " + rewardOnboarding.accessReason : ""}
                </p>
              ) : canManageRewards ? (
                <form
                  action={unlockMedalsAccess}
                  className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3.5"
                >
                  <input type="hidden" name="student_id" value={student.id} />
                  <label className="block text-xs font-medium text-zinc-300">
                    Habilitar acceso a Medallas manualmente
                    <textarea
                      name="reason"
                      required
                      rows={2}
                      placeholder="Motivo de la excepción"
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-fuchsia-500/50"
                    />
                  </label>
                  <PendingActionButton
                    pendingLabel="Habilitando…"
                    className="mt-3 min-h-10 rounded-xl border border-fuchsia-500/40 bg-fuchsia-500/[0.08] px-4 text-xs font-semibold text-fuchsia-200"
                  >
                    Habilitar acceso a Medallas
                  </PendingActionButton>
                  <p className="mt-2 text-[11px] text-zinc-500">
                    Esta acción es excepcional y queda registrada con motivo y administrador.
                  </p>
                </form>
              ) : null}
            </div>
          ) : null}

          <div className="profile360-approved-indicators">
            <article>
              <span>Medalla actual</span>
              <strong>
                {levelTitle
                  ? "Medalla " + levelTitle
                  : rewardOnboarding?.accessUnlockedAt
                    ? "Sin medalla"
                    : "En activación"}
              </strong>
            </article>
            <article>
              <span>Recompensas disponibles</span>
              <strong>{rewardsAvailable ?? 0}</strong>
            </article>
            <article>
              <span>Logros obtenidos</span>
              <strong>{rewardAchievements.length}</strong>
            </article>
            <article>
              <span>Medallas obtenidas</span>
              <strong>{rewardLevelHistory.length}</strong>
            </article>
          </div>

          <div className="profile360-rewards-section">
            <div className="profile360-package-group-heading">
              <strong>Recompensas</strong>
              <span>{rewardInstancesDetail.length}</span>
            </div>
            {rewardInstancesDetail.length ? (
              <div className="profile360-reward-list">
                {rewardInstancesDetail.map((reward) => (
                  <article key={reward.id}>
                    <div>
                      <strong>{rewardBenefitLabel(reward.kind, reward.benefitDefinition)}</strong>
                      <span>
                        {reward.expiresAt
                          ? "Vence " + formatDateTime(reward.expiresAt)
                          : "Sin vencimiento registrado"}
                      </span>
                    </div>
                    <span className="status-pill">{rewardStatusLabel(reward.status)}</span>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">No hay recompensas registradas.</div>
            )}
          </div>

          <div className="profile360-rewards-section">
            <div className="profile360-package-group-heading">
              <strong>Logros</strong>
              <span>{rewardAchievements.length}</span>
            </div>
            {rewardAchievements.length ? (
              <div className="profile360-history-list">
                {rewardAchievements.map((achievement) => (
                  <article key={achievement.id}>
                    <div className="profile360-history-dot is-reward" aria-hidden="true" />
                    <div>
                      <strong>{achievement.title}</strong>
                      <span>{formatDateTime(achievement.unlockedAt)}</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">Todavía no hay logros desbloqueados.</div>
            )}
          </div>

          {rewardLevelHistory.length ? (
            <div className="profile360-rewards-section">
              <div className="profile360-package-group-heading">
                <strong>Trayectoria de medallas</strong>
                <span>{rewardLevelHistory.length}</span>
              </div>
              <div className="profile360-history-list">
                {rewardLevelHistory.map((level) => (
                  <article key={level.id}>
                    <div className="profile360-history-dot is-level" aria-hidden="true" />
                    <div>
                      <strong>{level.title}</strong>
                      <span>
                        Medalla {level.levelOrder} · {formatDateTime(level.unlockedAt)}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {view === "evaluations" && canReadEvaluations ? (
        <StudentEvaluationsPanel
          studentId={student.id}
          timeZone={timeZone}
          error={query.evaluation_error}
        />
      ) : null}

      {view === "documents" && canReadDocuments ? (
        <StudentDocumentsPanel
          studentId={student.id}
          timeZone={timeZone}
          result={query.document_result}
          error={query.document_error}
        />
      ) : null}

      {view === "followup" ? (
        <section className="profile360-view-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">SEGUIMIENTO</p>
              <h2>Situaciones actuales</h2>
            </div>
            <span className="count-badge">{alerts.length}</span>
          </div>
          {alerts.length ? (
            <div className="profile360-approved-alert-list">
              {alerts.map((alert) => (
                <div key={alert.title + alert.detail}>
                  <strong>{alert.title}</strong>
                  <span>{alert.detail}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">Sin seguimiento pendiente.</div>
          )}
        </section>
      ) : null}
      {view === "history" ? (
        <section className="profile360-view-panel">
          <div className="profile360-view-heading">
            <div>
              <p className="eyebrow">HISTORIAL</p>
              <h2>Actividad de la alumna</h2>
              <p>
                Cronología derivada de clases, paquetes, Rewards y cambios de estado. Cada fuente
                conserva su propio detalle.
              </p>
            </div>
            <span className="count-badge">{profileHistoryEvents.length}</span>
          </div>

          {profileHistoryEvents.length ? (
            <div className="profile360-history-list">
              {profileHistoryEvents.slice(0, 60).map((event) => (
                <article key={event.id}>
                  <div className={"profile360-history-dot is-" + event.kind} aria-hidden="true" />
                  <div>
                    <strong>{event.title}</strong>
                    <span>{event.detail}</span>
                    <small>{formatDateTime(event.at)}</small>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">Todavía no hay actividad histórica para mostrar.</div>
          )}
        </section>
      ) : null}

      {view === "profile" ? (
        <>
          <details id="campos-adicionales" className="profile360-detail scroll-mt-6">
            <summary>
              <span>
                <strong>Información adicional</strong>
                <small>Campos configurables del expediente</small>
              </span>
              <span aria-hidden="true">›</span>
            </summary>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">CAMPOS ADICIONALES</p>
                  <h2>Información configurable</h2>
                </div>
                <span className="count-badge">{dynamicDefinitions.length}</span>
              </div>

              {dynamicDefinitions.length === 0 ? (
                <div className="empty-state">
                  No hay campos adicionales configurados para alumnas. El expediente base ya usa
                  nombre, apellido, teléfono y correo.
                </div>
              ) : canEdit ? (
                <form action={updateDynamicProfileFields} className="compact-form">
                  <input type="hidden" name="student_id" value={student.id} />
                  {dynamicDefinitions.map((definition) => {
                    const fieldName = `field_${definition.id}`;
                    const currentValue = valueMap.get(definition.id);
                    const options = optionValues(definition.options);

                    if (definition.field_type === "long_text") {
                      return (
                        <label key={definition.id}>
                          <span>
                            {definition.label}
                            {definition.required ? " *" : ""}
                          </span>
                          <textarea
                            name={fieldName}
                            required={definition.required}
                            defaultValue={scalarValue(currentValue)}
                          />
                        </label>
                      );
                    }

                    if (definition.field_type === "boolean") {
                      return (
                        <label key={definition.id} className="checkbox-field">
                          <input
                            name={fieldName}
                            type="checkbox"
                            value="true"
                            defaultChecked={currentValue === true}
                          />
                          <span>{definition.label}</span>
                        </label>
                      );
                    }

                    if (definition.field_type === "single_select") {
                      return (
                        <label key={definition.id}>
                          <span>
                            {definition.label}
                            {definition.required ? " *" : ""}
                          </span>
                          <select
                            name={fieldName}
                            required={definition.required}
                            defaultValue={scalarValue(currentValue)}
                          >
                            <option value="">Seleccionar</option>
                            {options.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    }

                    if (definition.field_type === "multi_select") {
                      const selected = Array.isArray(currentValue)
                        ? currentValue.filter((value): value is string => typeof value === "string")
                        : [];
                      return (
                        <label key={definition.id}>
                          <span>
                            {definition.label}
                            {definition.required ? " *" : ""}
                          </span>
                          <select
                            name={fieldName}
                            multiple
                            required={definition.required}
                            defaultValue={selected}
                          >
                            {options.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    }

                    return (
                      <label key={definition.id}>
                        <span>
                          {definition.label}
                          {definition.required ? " *" : ""}
                        </span>
                        <input
                          name={fieldName}
                          type={
                            definition.field_type === "number" ? "number" : definition.field_type
                          }
                          required={definition.required}
                          defaultValue={scalarValue(currentValue)}
                        />
                      </label>
                    );
                  })}
                  <PendingActionButton className="primary-button" pendingLabel="Guardando…">
                    Guardar campos adicionales
                  </PendingActionButton>
                </form>
              ) : (
                <div className="student-list">
                  {dynamicDefinitions.map((definition) => {
                    const currentValue = valueMap.get(definition.id);
                    const displayValue = Array.isArray(currentValue)
                      ? currentValue.join(", ")
                      : typeof currentValue === "boolean"
                        ? currentValue
                          ? "Sí"
                          : "No"
                        : scalarValue(currentValue) || "Sin dato";

                    return (
                      <div className="student-row" key={definition.id}>
                        <div>
                          <strong>{definition.label}</strong>
                          <span>{displayValue}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </details>
        </>
      ) : null}

      {view === "profile" ? <StudentPortalAccessSection studentId={student.id} /> : null}

      {view === "profile" && canArchive ? (
        <details id="estado-alumna" className="profile360-detail scroll-mt-6">
          <summary>
            <span>
              <strong>Estado e historial</strong>
              <small>Administración del ciclo de la alumna</small>
            </span>
            <span aria-hidden="true">›</span>
          </summary>
          <section className="panel">
            <p className="eyebrow">ADMINISTRACIÓN</p>
            <h2>Estado de la alumna</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              {student.lifecycle_status === "active"
                ? "Inactivar conserva el expediente y las reservas futuras existentes, pero deshabilita el acceso y bloquea nuevas reservas."
                : "Reactivar recupera el mismo expediente y vuelve a habilitar el acceso y las nuevas reservas."}
            </p>

            <StudentLifecycleActions
              studentId={student.id}
              status={student.lifecycle_status === "inactive" ? "inactive" : "active"}
            />

            <div id="historial" className="mt-6 scroll-mt-6 border-t border-white/10 pt-5">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">HISTORIAL</p>
                  <h3>Cambios de estado</h3>
                </div>
                <span className="count-badge">{lifecycleEvents.length}</span>
              </div>

              {lifecycleEvents.length === 0 ? (
                <div className="empty-state">Todavía no hay cambios de estado registrados.</div>
              ) : (
                <div className="grid gap-2">
                  {lifecycleEvents.map((event) => (
                    <div
                      key={event.id}
                      className={[
                        "flex flex-wrap items-center justify-between gap-3 rounded-xl",
                        "border border-white/10 bg-white/[0.03] px-4 py-3",
                      ].join(" ")}
                    >
                      <strong className="text-sm text-white">
                        {lifecycleCopy[event.from_status] ?? event.from_status} →{" "}
                        {lifecycleCopy[event.to_status] ?? event.to_status}
                      </strong>
                      <span className="text-xs text-zinc-500">
                        {formatDateTime(event.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </details>
      ) : null}
    </main>
  );
}
