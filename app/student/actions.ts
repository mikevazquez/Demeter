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

function revalidateStudentBookingSurfaces() {
  revalidatePath("/student");
  revalidatePath("/student/reservar");
  revalidatePath("/student/mis-clases");
  revalidatePath("/student/paquete");
  revalidatePath("/student/movimientos");
}

function mercadoPagoReturnBaseUrl() {
  const host =
    process.env.VERCEL_ENV === "production"
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL
      : (process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL);

  return host ? `https://${host}` : null;
}

type BookingRpcResult = {
  eligible?: boolean;
  reason_code?: string | null;
  reservation_id?: string;
} | null;

type MercadoPagoOrderResult = {
  ok?: boolean;
  attemptId?: string;
  orderId?: string;
  checkoutUrl?: string;
  status?: string;
  reused?: boolean;
  error?: string;
} | null;

export async function bookStudentSessionInlineAction(sessionId: string) {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return { ok: false as const, error: "session_required" };
  }

  const { supabase } = await getStudentPortalContext();
  const { data, error } = await supabase.rpc("student_book_session", {
    target_session_id: normalizedSessionId,
  });

  if (error) {
    return { ok: false as const, error: errorCode(error, "booking_failed") };
  }

  const result = data as BookingRpcResult;
  if (!result?.eligible || !result.reservation_id) {
    return {
      ok: false as const,
      error: result?.reason_code ?? "booking_failed",
    };
  }

  revalidateStudentBookingSurfaces();

  return {
    ok: true as const,
    reservationId: result.reservation_id,
  };
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

  const result = data as BookingRpcResult;

  if (!result?.eligible || !result.reservation_id) {
    redirect(
      `/student/reservar/${sessionId}?error=${encodeURIComponent(result?.reason_code ?? "booking_failed")}`,
    );
  }

  revalidateStudentBookingSurfaces();

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

  revalidateStudentBookingSurfaces();

  redirect(`${returnPath}?cancelled=${encodeURIComponent(result.status ?? "cancelled")}`);
}

export async function createMercadoPagoOrderAction(
  productTemplateId: string,
  clientRequestKey: string,
) {
  const normalizedProductId = productTemplateId.trim();
  const normalizedRequestKey = clientRequestKey.trim();
  const returnBaseUrl = mercadoPagoReturnBaseUrl();

  if (!normalizedProductId || !normalizedRequestKey || !returnBaseUrl) {
    return { ok: false as const, error: "invalid_request" };
  }

  const { supabase } = await getStudentPortalContext();
  const { data, error } = await supabase.functions.invoke("create-mercadopago-order", {
    body: {
      productTemplateId: normalizedProductId,
      clientRequestKey: normalizedRequestKey,
      returnBaseUrl,
    },
  });

  if (error) {
    return { ok: false as const, error: "checkout_failed" };
  }

  const result = data as MercadoPagoOrderResult;
  if (!result?.ok || !result.checkoutUrl || !result.orderId || !result.attemptId) {
    return { ok: false as const, error: result?.error ?? "checkout_failed" };
  }

  let checkoutUrl: URL;
  try {
    checkoutUrl = new URL(result.checkoutUrl);
  } catch {
    return { ok: false as const, error: "checkout_failed" };
  }

  if (checkoutUrl.protocol !== "https:") {
    return { ok: false as const, error: "checkout_failed" };
  }

  return {
    ok: true as const,
    checkoutUrl: checkoutUrl.toString(),
    attemptId: result.attemptId,
    orderId: result.orderId,
    reused: result.reused === true,
  };
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
