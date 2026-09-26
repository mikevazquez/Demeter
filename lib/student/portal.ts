import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { STUDIO_CONTEXT_COOKIE } from "@/lib/auth/studio-context-cookie";
import { createClient } from "@/lib/supabase/server";

export type StudentProfile = {
  student_id: string;
  studio_id: string;
  studio_name: string;
  first_name: string;
  last_name: string | null;
  full_name: string;
  phone: string;
  email: string | null;
  profile_status: string;
  lifecycle_status: string;
};

export type StudentAcquisition = {
  id: string;
  product_id: string;
  name: string;
  product_type: string;
  package_term: string | null;
  status: string;
  starts_on: string;
  expires_on: string;
  unlimited: boolean;
  credit_limit: number | null;
  available_credits: number | null;
  reserved_credits: number;
  used_credits: number;
  active_now: boolean;
};

export type StudentUpcomingClass = {
  reservation_id: string;
  session_id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  activity: string;
  discipline: string;
  space: string | null;
  coach: string | null;
};

export type StudentMovement = {
  id: string;
  movement_type: string;
  quantity: number;
  note: string | null;
  created_at: string;
  product: string;
  reservation_id: string | null;
  activity: string | null;
  starts_at: string | null;
};

export type StudentPayment = {
  id: string;
  sale_id: string;
  folio: string;
  sale_status: string;
  kind: string;
  amount_minor: number;
  method: string;
  reference: string | null;
  created_at: string;
  currency: string;
};

export type StudentEnrollment = {
  id: string;
  status: string;
  starts_on: string;
  expires_on: string | null;
  active_now: boolean;
};

export type StudentSnapshot = {
  profile: StudentProfile;
  acquisitions: StudentAcquisition[];
  enrollment: StudentEnrollment | null;
  upcoming: StudentUpcomingClass[];
  stats: {
    attended_total: number;
    attended_this_month: number;
    favorite_activity: string | null;
    streak_days: number;
  };
  movements: StudentMovement[];
  payments: StudentPayment[];
};

export type StudentSession = {
  session_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  spots_available: number;
  activity: string;
  discipline_id: string;
  discipline: string;
  credit_cost: number;
  drop_in_price_minor: number | null;
  space: string | null;
  location: string | null;
  coach: string | null;
  description: string | null;
  requires_resource: boolean;
  resource_uses_per_item?: number;
  is_reserved?: boolean;
  reservation_id?: string | null;
  eligibility: {
    eligible: boolean;
    reason_code: string | null;
    acquisition_id?: string;
    unlimited?: boolean;
    available_credits?: number | null;
    credit_cost?: number;
    restrictions?: Array<{
      code: string;
      type: string;
      title: string;
      detail?: string | null;
      action_kind?: string | null;
      action_href?: string | null;
      action_label?: string | null;
      version_id?: string | null;
      document_id?: string | null;
      document_name?: string | null;
      restriction_id?: string | null;
    }>;
  };
};

export type StudentClassFeedItem = {
  reservation_id: string;
  session_id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  activity: string;
  discipline: string;
  space: string | null;
  coach: string | null;
  credits_held: number;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
};

export const getStudentPortalContext = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login/student");

  const [{ data: account }, { data: memberships }] = await Promise.all([
    supabase
      .from("user_accounts")
      .select("status, must_change_password")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("studio_memberships")
      .select("studio_id,role,active")
      .eq("user_id", user.id)
      .eq("role", "student")
      .eq("active", true),
  ]);

  if (!account || account.status !== "active" || !memberships?.length) {
    redirect("/login/student?error=access");
  }

  if (account.must_change_password) redirect("/login/student/activar");

  const cookieStore = await cookies();
  const selectedStudioId = cookieStore.get(STUDIO_CONTEXT_COOKIE)?.value;
  const selectedMembership = selectedStudioId
    ? memberships.find((item) => item.studio_id === selectedStudioId)
    : null;
  const membership = selectedMembership ?? (memberships.length === 1 ? memberships[0] : null);

  if (!membership) {
    redirect("/login/student/seleccionar");
  }

  const { data: studentRecord } = await supabase
    .from("students")
    .select("id")
    .eq("user_id", user.id)
    .eq("studio_id", membership.studio_id)
    .eq("active", true)
    .eq("lifecycle_status", "active")
    .maybeSingle();

  if (!studentRecord) {
    redirect("/login/student/seleccionar?error=access");
  }

  const [{ data: snapshot, error }, { data: studio }] = await Promise.all([
    supabase.rpc("student_portal_snapshot"),
    supabase.from("studios").select("name,timezone,locale,currency").eq("id", membership.studio_id).maybeSingle(),
  ]);

  if (error || !snapshot || !studio) redirect("/login/student?error=access");

  const baseSnapshot = snapshot as StudentSnapshot;
  const productIds = [...new Set(baseSnapshot.acquisitions.map((item) => item.product_id))];
  const { data: productTerms } = productIds.length
    ? await supabase
        .from("product_templates")
        .select("id,package_term")
        .eq("studio_id", membership.studio_id)
        .in("id", productIds)
    : { data: [] };
  const termMap = new Map((productTerms ?? []).map((item) => [item.id, item.package_term]));
  const enrichedSnapshot: StudentSnapshot = {
    ...baseSnapshot,
    acquisitions: baseSnapshot.acquisitions.map((item) => ({
      ...item,
      package_term: termMap.get(item.product_id) ?? null,
    })),
  };

  return {
    supabase,
    user,
    account,
    membership,
    studio,
    snapshot: enrichedSnapshot,
  };
});

export function localDateKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatDateTime(value: string, timeZone: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDate(value: string, timeZone: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
}

export function formatMoney(minor: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
}

export function bookingReasonCopy(reason?: string | null) {
  const messages: Record<string, string> = {
    session_full: "Clase llena",
    already_reserved: "Ya reservaste esta clase",
    no_active_product: "No tienes un paquete activo para esta fecha",
    outside_product: "Esta clase no está incluida en tu paquete",
    no_credits: "No tienes créditos suficientes para reservar esta clase",
    payment_pending: "Tienes un pago pendiente que debes resolver",
    enrollment_required: "Necesitas una inscripción vigente para reservar",
    session_not_bookable: "Esta clase ya no admite reservas",
    student_not_operable: "Tu perfil no está habilitado para reservar",
    document_required: "Tienes un documento pendiente",
    guardian_required: "Tu responsable debe completar un documento",
    birth_date_required: "Completa tu fecha de nacimiento para continuar",
    account_restricted: "Tu cuenta tiene un requisito pendiente",
  };
  return reason ? (messages[reason] ?? "No disponible") : "Disponible";
}
