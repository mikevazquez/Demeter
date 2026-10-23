import "server-only";

import { notFound } from "next/navigation";

import { resolveEnrollmentStatus } from "@/lib/assistant/enrollment-state";
import { getTransferGroupReceiptReviews } from "@/lib/assistant/group-receipt-review";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { contactStage, renewalRecommended } from "@/lib/student-crm";
import { contactConversations } from "@/lib/student-crm-conversations";
import { createServiceClient } from "@/lib/supabase/service";

import {
  formatDate,
  formatDateTime,
  formatMoney,
  lifecycleCopy,
  localDateKey,
  scalarValue,
  structuralFieldKeys,
} from "./profile-format";
import { addDays, birthdayState, buildPendingItems } from "./profile-pending";
import { resolveActivityFilter, resolveProfileTab } from "./profile-tabs";

export type Profile360Query = {
  saved?: string;
  error?: string;
  alta?: string;
  sale?: string;
  lifecycle?: string;
  lifecycle_error?: string;
  evaluation_error?: string;
  document_result?: string;
  document_error?: string;
  transfer_review?: string;
  view?: string;
  f?: string;
};

/**
 * P360-V2-08 · Lectura del Perfil 360.
 *
 * Reúne en un solo lugar todo lo que el perfil necesita. Es la misma lectura que antes vivía
 * dentro de la página; las pestañas reciben el resultado y sólo se encargan de mostrarlo.
 */
export async function loadProfile360(studentId: string, query: Profile360Query) {
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.STUDENTS_READ);
  const tab = resolveProfileTab(query.view);
  const activityFilter = resolveActivityFilter(query.f, query.view);
  const { data: student } = await supabase
    .from("students")
    .select(
      "id, person_id, user_id, full_name, email, phone, lifecycle_status, profile_status, student_type, trial_status, created_at, archived_at",
    )
    .eq("id", studentId)
    .eq("studio_id", studio.id)
    .maybeSingle();

  if (!student || student.lifecycle_status === "archived") notFound();

  const canEdit = can(CAPABILITIES.STUDENTS_WRITE);
  const canReadSchedule = can(CAPABILITIES.SCHEDULE_READ);
  const canReadSales = can(CAPABILITIES.SALES_READ);
  const canManageSales = can(CAPABILITIES.SALES_WRITE);
  const canReadRewards = can(CAPABILITIES.REWARDS_READ);
  const canManageRewards = can(CAPABILITIES.REWARDS_MANAGE);
  const canReadEvaluations = can(CAPABILITIES.EVALUATIONS_READ);
  const canReadDocuments = can(CAPABILITIES.DOCUMENTS_READ);
  const canArchive = can(CAPABILITIES.STUDENTS_ARCHIVE);
  const canReadProducts = can(CAPABILITIES.PRODUCTS_READ);
  const canEditAcquisitions = can(CAPABILITIES.PRODUCTS_WRITE) || can(CAPABILITIES.SALES_WRITE);

  const secondaryReads = Promise.all([
    canArchive
      ? supabase
          .from("student_lifecycle_events")
          .select("id, from_status, to_status, created_at")
          .eq("student_id", student.id)
          .eq("studio_id", studio.id)
          .order("created_at", { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [] }),
    canReadSales
      ? supabase
          .from("student_operating_charges")
          .select(
            "id,charge_type,amount_minor,currency,status,created_at,resolved_at,resolution_note,reservation_id",
          )
          .eq("studio_id", studio.id)
          .eq("student_id", student.id)
          .order("created_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [] }),
    canReadSchedule
      ? supabase
          .from("reservations")
          .select("id,session_id,acquisition_id,status,credits_held,cancelled_at")
          .eq("studio_id", studio.id)
          .eq("student_id", student.id)
          .order("booked_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    canReadSales
      ? supabase
          .from("sales")
          .select("id,folio,total_minor,status,created_at")
          .eq("studio_id", studio.id)
          .eq("student_id", student.id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase
      .from("student_enrollments")
      .select("id,status,starts_on,expires_on,created_at")
      .is("refunded_at", null)
      .eq("studio_id", studio.id)
      .eq("student_id", student.id)
      .order("created_at", { ascending: false }),
    canReadRewards
      ? supabase
          .from("reward_status_memberships")
          .select("current_level_key")
          .eq("studio_id", studio.id)
          .eq("student_id", student.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    canReadRewards
      ? supabase
          .from("reward_onboarding")
          .select(
            "documents_completed_at,profile_completed_at,app_installed_at,notifications_enabled_at,first_reservation_at,first_attendance_at,access_unlocked_at,access_method,access_reason",
          )
          .eq("studio_id", studio.id)
          .eq("student_id", student.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    canReadRewards
      ? supabase
          .from("reward_instances")
          .select("id", { count: "exact", head: true })
          .eq("studio_id", studio.id)
          .eq("student_id", student.id)
          .eq("status", "available")
      : Promise.resolve({ data: null, count: 0 }),
    canReadRewards
      ? supabase
          .from("reward_achievement_unlocks")
          .select("id,title_snapshot,achievement_key,level_key,unlocked_at")
          .eq("studio_id", studio.id)
          .eq("student_id", student.id)
          .order("unlocked_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] }),
    canReadRewards
      ? supabase
          .from("reward_status_months")
          .select("id,resulting_level_key,closed_at,period_start")
          .eq("studio_id", studio.id)
          .eq("student_id", student.id)
          .eq("is_closed", true)
          .not("resulting_level_key", "is", null)
          .order("period_start", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] }),
    canReadRewards
      ? supabase
          .from("reward_instances")
          .select("id,reward_key,status,kind,benefit_definition,expires_at,redeemed_at,created_at")
          .eq("studio_id", studio.id)
          .eq("student_id", student.id)
          .order("created_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [] }),
    canReadEvaluations
      ? supabase
          .from("student_discipline_levels")
          .select("discipline_id,discipline_technical_level_id")
          .eq("studio_id", studio.id)
          .eq("student_id", student.id)
      : Promise.resolve({ data: [] }),
    student.user_id
      ? supabase.auth.admin.getUserById(student.user_id)
      : Promise.resolve({ data: { user: null } }),
  ]);

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
              .select("id,name,package_term,price_minor")
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

  const phone = contacts?.find((item) => item.kind === "phone")?.value ?? student.phone ?? "";
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
  const [
    lifecycleEventsResult,
    operatingChargesResult,
    reservationRowsResult,
    studentSalesResult,
    enrollmentRowsResult,
    statusMembershipResult,
    onboardingResult,
    rewardCountResult,
    achievementRowsResult,
    levelUnlockRowsResult,
    rewardRowsResult,
    studentLevelRowsResult,
    authUserResult,
  ] = await secondaryReads;

  const lifecycleEvents = lifecycleEventsResult.data ?? [];
  const operatingCharges = operatingChargesResult.data ?? [];
  const pendingOperatingCharges = (operatingCharges ?? []).filter(
    (charge) => charge.status === "pending",
  );
  const { data: transferPurchases } = canReadSales
    ? await supabase
        .from("assistant_transfer_purchase_intents")
        .select(
          "id,status,product_template_id,amount_minor,currency,receipt_received_at,receipt_storage_path,receipt_mime_type,receipt_file_size,receipt_stored_at,created_at,validated_at,rejected_at,review_note,sale_id,acquisition_id",
        )
        .eq("studio_id", studio.id)
        .eq("student_id", student.id)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [] };
  const transferPurchaseRows = transferPurchases ?? [];
  const groupReceiptReviews = await getTransferGroupReceiptReviews(
    supabase,
    studio.id,
    canReadSales ? transferPurchaseRows.map((p) => p.id) : [],
  );
  const groupReceiptUrlMap = new Map<string, string>();
  if (canReadSales && tab === "packages" && groupReceiptReviews.available) {
    const paths = [
      ...new Set(
        [...groupReceiptReviews.byIntent.values()].flatMap((g) => g.documents.map((d) => d.path)),
      ),
    ];
    if (paths.length) {
      const service = createServiceClient();
      const signed = await Promise.all(
        paths.map(async (path) => {
          const { data, error } = await service.storage
            .from("transfer-receipts")
            .createSignedUrl(path, 600);
          return { path, url: error ? null : data?.signedUrl };
        }),
      );
      for (const document of signed)
        if (document.url) groupReceiptUrlMap.set(document.path, document.url);
    }
  }
  const transferReceiptUrlMap = new Map<string, string>();
  if (canReadSales && tab === "packages") {
    const receiptRows = transferPurchaseRows.filter(
      (item) => typeof item.receipt_storage_path === "string" && item.receipt_storage_path,
    );
    if (receiptRows.length) {
      const serviceClient = createServiceClient();
      const signed = await Promise.all(
        receiptRows.map(async (item) => {
          const path = String(item.receipt_storage_path);
          const { data, error } = await serviceClient.storage
            .from("transfer-receipts")
            .createSignedUrl(path, 600);
          return {
            id: item.id,
            signedUrl: error ? null : (data?.signedUrl ?? null),
          };
        }),
      );

      for (const item of signed) {
        if (item.signedUrl) transferReceiptUrlMap.set(item.id, item.signedUrl);
      }
    }
  }
  const pendingTransferReviews = transferPurchaseRows.filter(
    (item) => item.status === "provisional_active",
  );
  const timeZone = studio.timezone;
  const locale = studio.locale;
  const currency = studio.currency;
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
    const reservationRows = reservationRowsResult.data ?? [];
    const allSessionIds = [...new Set(reservationRows.map((item) => item.session_id))];
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

    for (const reservation of reservationRows) {
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

  type StudentSaleHistory = {
    id: string;
    folio: string;
    totalMinor: number;
    status: string;
    createdAt: string;
    netPaidMinor: number;
    balanceMinor: number;
    stateLabel: string;
  };

  let historicalValueMinor: number | null = null;
  let pendingBalanceMinor = 0;
  let studentSalesHistory: StudentSaleHistory[] = [];

  if (canReadSales) {
    const studentSales = studentSalesResult.data ?? [];
    const saleIds = studentSales.map((sale) => sale.id);
    const { data: payments } = saleIds.length
      ? await supabase
          .from("payments")
          .select("sale_id,kind,amount_minor")
          .eq("studio_id", studio.id)
          .in("sale_id", saleIds)
      : { data: [] };

    const grossPaidBySale = new Map<string, number>();
    const refundsBySale = new Map<string, number>();

    for (const payment of payments ?? []) {
      const target = payment.kind === "refund" ? refundsBySale : grossPaidBySale;
      target.set(payment.sale_id, (target.get(payment.sale_id) ?? 0) + payment.amount_minor);
    }

    studentSalesHistory = studentSales.map((sale) => {
      const grossPaid = grossPaidBySale.get(sale.id) ?? 0;
      const refunded = refundsBySale.get(sale.id) ?? 0;
      const netPaidMinor = grossPaid - refunded;
      const balanceMinor = Math.max(0, sale.total_minor - netPaidMinor);
      const stateLabel =
        sale.status === "voided"
          ? "Anulada"
          : refunded > 0
            ? refunded >= grossPaid && grossPaid > 0
              ? "Reembolsada"
              : "Con reembolso"
            : netPaidMinor <= 0
              ? "Pendiente"
              : netPaidMinor < sale.total_minor
                ? "Parcial"
                : "Pagada";

      return {
        id: sale.id,
        folio: sale.folio,
        totalMinor: sale.total_minor,
        status: sale.status,
        createdAt: sale.created_at,
        netPaidMinor,
        balanceMinor,
        stateLabel,
      };
    });

    const confirmedSales = studentSalesHistory.filter((sale) => sale.status === "confirmed");
    historicalValueMinor = confirmedSales.reduce((sum, sale) => sum + sale.netPaidMinor, 0);
    pendingBalanceMinor = confirmedSales.reduce((sum, sale) => sum + sale.balanceMinor, 0);
  }

  if (enrollmentRowsResult.error) throw new Error("crm_enrollment_unavailable");
  const enrollmentRows = enrollmentRowsResult.data ?? [];
  const enrollment =
    enrollmentRows.find(
      (item) =>
        item.status === "active" &&
        (!item.starts_on || item.starts_on <= today) &&
        (!item.expires_on || item.expires_on >= today),
    ) ??
    enrollmentRows[0] ??
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
        .eq("studio_id", studio.id)
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

  if (canReadEvaluations) {
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

  type ProfileHistoryEvent = {
    id: string;
    at: string;
    kind: "class" | "package" | "sale" | "reward" | "status";
    title: string;
    detail: string;
    href?: string;
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
        ? `${event.className} · clase programada ${formatDateTime(event.startsAt, timeZone, locale)}`
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

  for (const transfer of transferPurchaseRows) {
    const amount = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: transfer.currency ?? currency,
    }).format(Number(transfer.amount_minor ?? 0) / 100);
    const packageName = productMap.get(transfer.product_template_id)?.name ?? "Paquete";
    const title =
      transfer.status === "validated"
        ? "Transferencia validada"
        : transfer.status === "rejected"
          ? "Transferencia rechazada"
          : transfer.status === "provisional_active"
            ? "Comprobante de transferencia recibido"
            : transfer.status === "awaiting_receipt"
              ? "Transferencia pendiente de comprobante"
              : "Movimiento de transferencia";

    profileHistoryEvents.push({
      id: "transfer:" + transfer.id,
      at:
        transfer.validated_at ??
        transfer.rejected_at ??
        transfer.receipt_received_at ??
        transfer.created_at,
      kind: "sale",
      title,
      detail: `${packageName} · ${amount}`,
      href: `/admin/alumnas/${student.id}?view=packages#transferencias`,
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
        priceMinor: productMap.get(currentAcquisition.product_template_id)?.price_minor ?? null,
        unlimited: currentAcquisition.unlimited,
        availableCredits: currentAcquisition.unlimited
          ? null
          : (balanceMap.get(currentAcquisition.id) ?? 0),
        creditLimit: currentAcquisition.credit_limit,
        startsOn: currentAcquisition.starts_on,
        expiresOn: currentAcquisition.expires_on,
      }
    : null;

  const portalEntered = Boolean(authUserResult.data?.user?.last_sign_in_at);

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
    transfer_review: "No se pudo actualizar la validación de la transferencia.",
  };

  const communications = await contactConversations(
    supabase,
    studio.id,
    [student.id],
    [],
    can(CAPABILITIES.SETTINGS_WRITE),
  );
  const contactMessages = communications.messages.get(student.id) ?? [];

  const stage = contactStage({
    ...student,
    enrollment_status: resolveEnrollmentStatus(enrollmentRows, today),
  });
  const internalNoteDefinition = (definitions ?? []).find((item) =>
    ["notes", "internal_note", "notas", "nota_interna"].includes(item.key),
  );
  const internalNote = internalNoteDefinition
    ? scalarValue(valueMap.get(internalNoteDefinition.id)) || null
    : null;
  const canSell = can(CAPABILITIES.SALES_WRITE);
  const canBook = can(CAPABILITIES.SCHEDULE_WRITE);
  const canManageAccess = can(CAPABILITIES.SETTINGS_WRITE);
  const enrollmentActive = resolveEnrollmentStatus(enrollmentRows, today) === "active";
  const renewalDue =
    canReadProducts &&
    renewalRecommended(stage, currentAcquisition?.expires_on, today, addDays(today, 7));
  const lastPackageExpiredOn =
    acquisitions.find((item) => !item.refunded_at && item.expires_on)?.expires_on ?? null;
  const pendingItems = buildPendingItems({
    studentId: student.id,
    lifecycleStatus: student.lifecycle_status,
    canSell,
    canReadProducts,
    canReadSales,
    canManageAccess,
    pendingTransfers: pendingTransferReviews.length,
    pendingCharges: {
      count: pendingOperatingCharges.length,
      amountMinor: pendingOperatingCharges.reduce(
        (sum, charge) => sum + Number(charge.amount_minor ?? 0),
        0,
      ),
    },
    pendingBalanceMinor,
    accessBlocked: Boolean(currentAcquisition?.access_blocked),
    currentPackage: currentPackageView,
    hasScheduledPackage: Boolean(scheduledAcquisition),
    lastPackageExpiredOn,
    renewalDue,
    enrollment: enrollment ? { active: enrollmentActive, expiresOn: enrollment.expires_on } : null,
    enrollmentExpiringSoon: Boolean(
      enrollmentActive && enrollment?.expires_on && enrollment.expires_on <= addDays(today, 15),
    ),
    hasNextClass: Boolean(nextClass),
    hasPortalAccount: Boolean(student.user_id),
    birthday: birthdayState(birthDate, today),
    money: (minor) => formatMoney(minor, locale, currency, 2),
    date: (value) => formatDate(value, locale),
  });

  return {
    tab,
    activityFilter,
    query,
    studio,
    can,
    student,
    stage,
    internalNote,
    canEdit,
    canSell,
    canBook,
    canManageAccess,
    canReadSchedule,
    canReadSales,
    canManageSales,
    canReadRewards,
    canManageRewards,
    canReadEvaluations,
    canReadDocuments,
    canArchive,
    canReadProducts,
    canEditAcquisitions,
    phone,
    email,
    firstName,
    lastName,
    communicationPreferences,
    communicationPreferenceEvents,
    lifecycleEvents,
    operatingCharges,
    pendingOperatingCharges,
    transferPurchaseRows,
    groupReceiptReviews,
    groupReceiptUrlMap,
    transferReceiptUrlMap,
    pendingTransferReviews,
    timeZone,
    locale,
    currency,
    today,
    acquisitions,
    currentAcquisition,
    scheduledAcquisitions,
    historicalAcquisitions,
    productMap,
    balanceMap,
    dynamicDefinitions,
    valueMap,
    birthDate,
    packageClassEvents,
    nextClass,
    studentSalesHistory,
    historicalValueMinor,
    pendingBalanceMinor,
    enrollment,
    enrollmentActive,
    levelTitle,
    rewardOnboarding,
    rewardsAvailable,
    technicalLevels,
    rewardAchievements,
    rewardLevelHistory,
    rewardInstancesDetail,
    profileHistoryEvents,
    currentPackageView,
    pendingItems,
    portalEntered,
    errorCopy,
    communications,
    contactMessages,
  };
}

export type Profile360Model = Awaited<ReturnType<typeof loadProfile360>>;
