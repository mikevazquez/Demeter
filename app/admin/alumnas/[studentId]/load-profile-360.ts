import "server-only";

import { notFound } from "next/navigation";

import { resolveEnrollmentStatus } from "@/lib/assistant/enrollment-state";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { contactStage, renewalRecommended } from "@/lib/student-crm";
import { contactConversations } from "@/lib/student-crm-conversations";

import {
  formatDate,
  profileErrorCopy,
  formatMoney,
  localDateKey,
  scalarValue,
  structuralFieldKeys,
} from "./profile-format";
import { buildProfileHistory, type ProfileHistoryEvent } from "./build-history";
import { addDays, birthdayState, buildPendingItems } from "./profile-pending";
import { EMPTY_PROGRESS, readProgress } from "./read-progress";
import { summarizeSales, type StudentSaleHistory } from "./read-sales";
import { readClasses, type PackageClassEvent } from "./read-classes";
import { readTransfers } from "./read-transfers";
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
    student.user_id
      ? supabase.auth.admin.getUserById(student.user_id)
      : Promise.resolve({ data: { user: null } }),
  ]);

  const progressRead =
    tab === "progress" || tab === "activity"
      ? readProgress(supabase, studio.id, student.id, {
          rewards: canReadRewards,
          evaluations: canReadEvaluations,
        })
      : Promise.resolve(EMPTY_PROGRESS);

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
    authUserResult,
  ] = await secondaryReads;

  const lifecycleEvents = lifecycleEventsResult.data ?? [];
  const operatingCharges = operatingChargesResult.data ?? [];
  const pendingOperatingCharges = (operatingCharges ?? []).filter(
    (charge) => charge.status === "pending",
  );
  const {
    transferPurchaseRows,
    groupReceiptReviews,
    groupReceiptUrlMap,
    transferReceiptUrlMap,
    pendingTransferReviews,
  } = await readTransfers(supabase, studio.id, student.id, {
    canReadSales,
    withReceipts: canReadSales && tab === "packages",
  });
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

  const { packageClassEvents, generalClassEvents, nextClass } = canReadSchedule
    ? await readClasses(
        supabase,
        studio.id,
        reservationRowsResult.data ?? [],
        currentAcquisition?.id ?? null,
      )
    : {
        packageClassEvents: new Map<string, PackageClassEvent[]>(),
        generalClassEvents: [] as PackageClassEvent[],
        nextClass: null,
      };

  const { studentSalesHistory, historicalValueMinor, pendingBalanceMinor } = canReadSales
    ? await summarizeSales(supabase, studio.id, studentSalesResult.data ?? [])
    : {
        studentSalesHistory: [] as StudentSaleHistory[],
        historicalValueMinor: null as number | null,
        pendingBalanceMinor: 0,
      };

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

  const {
    levelTitle,
    rewardOnboarding,
    rewardsAvailable,
    technicalLevels,
    rewardAchievements,
    rewardLevelHistory,
    rewardInstancesDetail,
  } = await progressRead;

  const profileHistoryEvents: ProfileHistoryEvent[] =
    tab === "activity"
      ? buildProfileHistory({
          studentId: student.id,
          generalClassEvents,
          acquisitions,
          currentAcquisitionId: currentAcquisition?.id ?? null,
          productMap,
          transferPurchaseRows,
          rewardAchievements,
          lifecycleEvents,
          timeZone,
          locale,
          currency,
        })
      : [];

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
    errorCopy: profileErrorCopy,
    communications,
    contactMessages,
  };
}

export type Profile360Model = Awaited<ReturnType<typeof loadProfile360>>;
