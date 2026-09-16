"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getStudentPortalContext } from "@/lib/student/portal";

function errorCode(error: { message?: string } | null, fallback: string) {
  if (!error?.message) return fallback;
  const known = [
    "forbidden",
    "session_not_found",
    "student_context_not_found",
    "date_range_invalid",
    "reservation_not_found",
    "first_name_required",
    "email_invalid",
  ];
  return known.find((item) => error.message?.includes(item)) ?? fallback;
}

function cancellationReturnPath(formData: FormData) {
  return String(formData.get("return_to") ?? "") === "/student"
    ? "/student"
    : "/student/mis-clases";
}

export async function bookStudentSessionAction(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "").trim();
  if (!sessionId) redirect("/student/reservar?error=session_required");

  const { supabase } = await getStudentPortalContext();
  const { data, error } = await supabase.rpc("student_book_session", {
    target_session_id: sessionId,
  });

  if (error) {
    redirect(`/student/reservar/${sessionId}?error=${errorCode(error, "booking_failed")}`);
  }

  const result = data as {
    eligible?: boolean;
    reason_code?: string | null;
    reservation_id?: string;
  } | null;

  if (!result?.eligible || !result.reservation_id) {
    redirect(
      `/student/reservar/${sessionId}?error=${encodeURIComponent(result?.reason_code ?? "booking_failed")}`,
    );
  }

  revalidatePath("/student");
  revalidatePath("/student/reservar");
  revalidatePath("/student/mis-clases");
  revalidatePath("/student/paquete");
  revalidatePath("/student/movimientos");

  redirect(
    `/student/reservar/confirmacion?session=${encodeURIComponent(sessionId)}&reservation=${encodeURIComponent(result.reservation_id)}`,
  );
}

export async function cancelStudentReservationAction(formData: FormData) {
  const reservationId = String(formData.get("reservation_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const returnPath = cancellationReturnPath(formData);
  if (!reservationId) redirect(`${returnPath}?error=reservation_required`);

  const { supabase } = await getStudentPortalContext();
  const { data, error } = await supabase.rpc("student_cancel_own_reservation", {
    target_reservation_id: reservationId,
    target_reason: reason,
  });

  if (error) {
    redirect(`${returnPath}?error=${errorCode(error, "cancel_failed")}`);
  }

  const result = data as { ok?: boolean; reason_code?: string | null; status?: string } | null;
  if (!result?.ok) {
    redirect(`${returnPath}?error=${encodeURIComponent(result?.reason_code ?? "cancel_failed")}`);
  }

  revalidatePath("/student");
  revalidatePath("/student/reservar");
  revalidatePath("/student/mis-clases");
  revalidatePath("/student/paquete");
  revalidatePath("/student/movimientos");

  redirect(`${returnPath}?cancelled=${encodeURIComponent(result.status ?? "cancelled")}`);
}

export async function updateStudentProfileAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim() || null;

  const { supabase, snapshot } = await getStudentPortalContext();
  const { error } = await supabase.rpc("student_update_own_profile", {
    target_first_name: snapshot.profile.first_name,
    target_last_name: snapshot.profile.last_name,
    target_email: email,
  });

  if (error) {
    redirect(`/student/perfil?error=${errorCode(error, "profile_update_failed")}`);
  }

  revalidatePath("/student");
  revalidatePath("/student/perfil");
  redirect("/student/perfil?updated=1");
}
