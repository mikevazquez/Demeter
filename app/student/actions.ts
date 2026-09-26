"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
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
    "resource_required",
    "resource_full",
    "resource_not_available",
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

async function edgeFunctionErrorCode(error: unknown, fallback: string) {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) return body.error;
    } catch {
      // Keep the safe fallback when the Edge Function response is not JSON.
    }
  }
  return fallback;
}

function approvedCheckoutOrigin(hostValue: string | null, protoValue: string | null) {
  const host = hostValue?.split(",")[0]?.trim().toLowerCase() ?? "";
  const proto = protoValue?.split(",")[0]?.trim().toLowerCase() || "https";
  if (!host || proto !== "https") return null;

  let url: URL;
  try {
    url = new URL(`${proto}://${host}`);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const approvedHost =
    hostname === "demeterbueno.vercel.app" ||
    (hostname.startsWith("demeterbueno-") && hostname.endsWith("-demeter3.vercel.app"));

  return approvedHost ? url.origin : null;
}

async function mercadoPagoReturnBaseUrl() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const proto = requestHeaders.get("x-forwarded-proto") ?? "https";

  return approvedCheckoutOrigin(host, proto);
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

export async function joinStudentWaitlistInlineAction(sessionId: string) {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return { ok: false as const, error: "session_required" };
  }

  const { supabase } = await getStudentPortalContext();
  const { data, error } = await supabase.rpc("student_join_waitlist", {
    target_session_id: normalizedSessionId,
  });

  if (error) {
    return { ok: false as const, error: errorCode(error, "waitlist_failed") };
  }

  const result = data as {
    ok?: boolean;
    reason_code?: string | null;
    waitlist_entry_id?: string;
    level_title?: string | null;
  } | null;

  if (!result?.ok || !result.waitlist_entry_id) {
    return {
      ok: false as const,
      error: result?.reason_code ?? "waitlist_failed",
    };
  }

  revalidateStudentBookingSurfaces();

  return {
    ok: true as const,
    waitlistEntryId: result.waitlist_entry_id,
    levelTitle: result.level_title ?? null,
  };
}

export async function bookStudentSessionInlineAction(sessionId: string, useRewardCredits = false) {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return { ok: false as const, error: "session_required" };
  }

  const { supabase } = await getStudentPortalContext();
  const { data, error } = useRewardCredits
    ? await supabase.rpc("student_book_session_with_reward_credits", {
        target_session_id: normalizedSessionId,
        target_resource_id: null,
      })
    : await supabase.rpc("student_book_session", {
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
  const rawDate = String(formData.get("date") ?? "").trim();
  const resourceId = String(formData.get("resource_id") ?? "").trim() || null;
  const useRewardCredits = String(formData.get("credit_source") ?? "") === "reward";
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : "";
  const dateQuery = selectedDate ? `&date=${encodeURIComponent(selectedDate)}` : "";

  if (!sessionId) redirect("/student/reservar?error=session_required");

  const { supabase } = await getStudentPortalContext();
  const { data, error } = useRewardCredits
    ? await supabase.rpc("student_book_session_with_reward_credits", {
        target_session_id: sessionId,
        target_resource_id: resourceId,
      })
    : resourceId
      ? await supabase.rpc("student_book_session_with_resource", {
          target_session_id: sessionId,
          target_resource_id: resourceId,
        })
      : await supabase.rpc("student_book_session", {
          target_session_id: sessionId,
        });

  if (error) {
    redirect(
      `/student/reservar/${sessionId}/confirmar?error=${errorCode(
        error,
        "booking_failed",
      )}${dateQuery}`,
    );
  }

  const result = data as BookingRpcResult;

  if (!result?.eligible || !result.reservation_id) {
    const reason = result?.reason_code ?? "booking_failed";
    if (["resource_required", "resource_full", "resource_not_available"].includes(reason)) {
      redirect(
        `/student/reservar/${sessionId}/recurso?error=${encodeURIComponent(reason)}${dateQuery}`,
      );
    }
    redirect(
      `/student/reservar/${sessionId}/confirmar?error=${encodeURIComponent(reason)}${dateQuery}`,
    );
  }

  revalidateStudentBookingSurfaces();

  redirect(
    `/student/reservar/confirmacion?session=${encodeURIComponent(
      sessionId,
    )}&reservation=${encodeURIComponent(result.reservation_id)}${dateQuery}`,
  );
}

function normalizeGuestIdentityName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("es-MX");
}

function normalizeMexicanPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 ? `+52${digits}` : null;
}

export async function createGuestInvitationAction(formData: FormData) {
  const reservationId = String(formData.get("reservation_id") ?? "").trim();
  const guestName = String(formData.get("guest_name") ?? "").trim();
  const guestPhoneInput = String(formData.get("guest_phone") ?? "").trim();

  if (!reservationId) redirect("/student/mis-clases?error=reservation_required");

  const detailPath = `/student/mis-clases/${reservationId}`;
  const guestPhone = normalizeMexicanPhone(guestPhoneInput);
  if (!guestPhone) {
    redirect(`${detailPath}?invite=1&invite_error=guest_phone_invalid`);
  }
  const { supabase } = await getStudentPortalContext();
  const { data: lookupData, error: lookupError } = await supabase.rpc(
    "student_guest_invitation_contact_lookup",
    { target_guest_phone: guestPhone },
  );

  if (lookupError) {
    redirect(
      `${detailPath}?invite=1&invite_error=${encodeURIComponent(
        errorCode(lookupError, "invite_failed"),
      )}`,
    );
  }

  const contactLookup = lookupData as {
    ok?: boolean;
    found?: boolean;
    person_id?: string;
    display_name?: string | null;
    lifecycle_status?: string | null;
    reason_code?: string | null;
  } | null;

  if (contactLookup?.ok === false) {
    redirect(
      `${detailPath}?invite=1&invite_error=${encodeURIComponent(
        contactLookup.reason_code ?? "invite_failed",
      )}`,
    );
  }

  if (contactLookup?.found && contactLookup.lifecycle_status === "student") {
    redirect(`${detailPath}?invite=1&invite_error=guest_already_student`);
  }

  if (
    contactLookup?.found &&
    contactLookup.person_id &&
    contactLookup.display_name &&
    normalizeGuestIdentityName(contactLookup.display_name) !== normalizeGuestIdentityName(guestName)
  ) {
    redirect(`${detailPath}?invite=1&contact_match=${encodeURIComponent(contactLookup.person_id)}`);
  }

  if (contactLookup?.found && contactLookup.person_id) {
    const { data, error } = await supabase.rpc("student_create_guest_invitation_existing", {
      target_host_reservation_id: reservationId,
      target_guest_person_id: contactLookup.person_id,
    });

    if (error) {
      redirect(
        `${detailPath}?invite=1&invite_error=${encodeURIComponent(
          errorCode(error, "invite_failed"),
        )}`,
      );
    }

    const result = data as {
      ok?: boolean;
      reason_code?: string | null;
      invitation_id?: string;
    } | null;

    if (!result?.ok || !result.invitation_id) {
      redirect(
        `${detailPath}?invite=1&invite_error=${encodeURIComponent(
          result?.reason_code ?? "invite_failed",
        )}`,
      );
    }

    revalidateStudentBookingSurfaces();
    revalidatePath(detailPath);
    redirect(detailPath);
  }

  const { data, error } = await supabase.rpc("student_create_guest_invitation", {
    target_host_reservation_id: reservationId,
    target_guest_full_name: guestName,
    target_guest_phone: guestPhone,
  });

  if (error) {
    redirect(
      `${detailPath}?invite=1&invite_error=${encodeURIComponent(
        errorCode(error, "invite_failed"),
      )}`,
    );
  }

  const result = data as {
    ok?: boolean;
    reason_code?: string | null;
    invitation_id?: string;
  } | null;

  if (!result?.ok || !result.invitation_id) {
    redirect(
      `${detailPath}?invite=1&invite_error=${encodeURIComponent(
        result?.reason_code ?? "invite_failed",
      )}`,
    );
  }

  revalidateStudentBookingSurfaces();
  revalidatePath(detailPath);
  redirect(detailPath);
}

export async function confirmExistingGuestInvitationAction(formData: FormData) {
  const reservationId = String(formData.get("reservation_id") ?? "").trim();
  const guestPersonId = String(formData.get("guest_person_id") ?? "").trim();

  if (!reservationId || !guestPersonId) {
    redirect("/student/mis-clases?error=invitation_required");
  }

  const detailPath = `/student/mis-clases/${reservationId}`;
  const { supabase } = await getStudentPortalContext();
  const { data, error } = await supabase.rpc("student_create_guest_invitation_existing", {
    target_host_reservation_id: reservationId,
    target_guest_person_id: guestPersonId,
  });

  if (error) {
    redirect(
      `${detailPath}?invite=1&invite_error=${encodeURIComponent(
        errorCode(error, "invite_failed"),
      )}`,
    );
  }

  const result = data as {
    ok?: boolean;
    reason_code?: string | null;
    invitation_id?: string;
  } | null;

  if (!result?.ok || !result.invitation_id) {
    redirect(
      `${detailPath}?invite=1&invite_error=${encodeURIComponent(
        result?.reason_code ?? "invite_failed",
      )}`,
    );
  }

  revalidateStudentBookingSurfaces();
  revalidatePath(detailPath);
  redirect(detailPath);
}

export async function cancelGuestInvitationAction(formData: FormData) {
  const hostReservationId = String(formData.get("host_reservation_id") ?? "").trim();
  const invitationId = String(formData.get("invitation_id") ?? "").trim();

  if (!hostReservationId || !invitationId) {
    redirect("/student/mis-clases?error=invitation_required");
  }

  const detailPath = `/student/mis-clases/${hostReservationId}`;
  const { supabase } = await getStudentPortalContext();
  const { data, error } = await supabase.rpc("student_cancel_guest_invitation", {
    target_invitation_id: invitationId,
  });

  if (error) {
    redirect(`${detailPath}?invite_error=invite_cancel_failed`);
  }

  const result = data as {
    ok?: boolean;
    reason_code?: string | null;
    returned?: boolean;
  } | null;

  if (!result?.ok) {
    redirect(
      `${detailPath}?invite_error=${encodeURIComponent(
        result?.reason_code ?? "invite_cancel_failed",
      )}`,
    );
  }

  revalidateStudentBookingSurfaces();
  revalidatePath(detailPath);
  redirect(detailPath);
}

export async function cancelStudentReservationAction(formData: FormData) {
  const reservationId = String(formData.get("reservation_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const returnPath = cancellationReturnPath(formData);
  if (!reservationId) redirect(`${returnPath}?error=reservation_required`);

  const { supabase } = await getStudentPortalContext();
  const { data: previewData } = await supabase.rpc("student_cancellation_preview", {
    target_reservation_id: reservationId,
  });
  const preview = previewData as {
    ok?: boolean;
    uses_credits?: boolean;
  } | null;

  const { data, error } = await supabase.rpc("student_cancel_own_reservation", {
    target_reservation_id: reservationId,
    target_reason: reason,
  });

  if (error) {
    redirect(
      `/student/mis-clases/${reservationId}/cancelar?error=${errorCode(error, "cancel_failed")}`,
    );
  }

  const result = data as { ok?: boolean; reason_code?: string | null; status?: string } | null;
  if (!result?.ok) {
    redirect(
      `/student/mis-clases/${reservationId}/cancelar?error=${encodeURIComponent(
        result?.reason_code ?? "cancel_failed",
      )}`,
    );
  }

  revalidateStudentBookingSurfaces();

  const creditResult =
    preview?.ok && preview.uses_credits
      ? result.status === "cancelled_late"
        ? "lost"
        : "returned"
      : "na";

  redirect(
    `${returnPath}?cancelled=${encodeURIComponent(result.status ?? "cancelled")}&credit=${creditResult}`,
  );
}

export async function createSingleClassMercadoPagoOrderAction(
  sessionId: string,
  clientRequestKey: string,
  evaluationContext?: { invitationId: string; sessionId: string },
) {
  const normalizedSessionId = sessionId.trim();
  const normalizedRequestKey = clientRequestKey.trim();
  const returnBaseUrl = await mercadoPagoReturnBaseUrl();

  if (!normalizedSessionId || !normalizedRequestKey || !returnBaseUrl) {
    return { ok: false as const, error: "invalid_request" };
  }

  const { supabase } = await getStudentPortalContext();
  const { data, error } = await supabase.functions.invoke("create-mercadopago-order", {
    body: {
      sessionId: normalizedSessionId,
      clientRequestKey: normalizedRequestKey,
      returnBaseUrl,
      evaluationInvitationId: evaluationContext?.invitationId,
      evaluationSessionId: evaluationContext?.sessionId,
    },
  });

  if (error) {
    return { ok: false as const, error: await edgeFunctionErrorCode(error, "checkout_failed") };
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

export async function createMercadoPagoOrderAction(
  productTemplateId: string,
  clientRequestKey: string,
  evaluationContext?: { invitationId: string; sessionId: string },
) {
  const normalizedProductId = productTemplateId.trim();
  const normalizedRequestKey = clientRequestKey.trim();
  const returnBaseUrl = await mercadoPagoReturnBaseUrl();

  if (!normalizedProductId || !normalizedRequestKey || !returnBaseUrl) {
    return { ok: false as const, error: "invalid_request" };
  }

  const { supabase } = await getStudentPortalContext();
  const { data, error } = await supabase.functions.invoke("create-mercadopago-order", {
    body: {
      productTemplateId: normalizedProductId,
      clientRequestKey: normalizedRequestKey,
      returnBaseUrl,
      evaluationInvitationId: evaluationContext?.invitationId,
      evaluationSessionId: evaluationContext?.sessionId,
    },
  });

  if (error) {
    return { ok: false as const, error: await edgeFunctionErrorCode(error, "checkout_failed") };
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

export async function finalizeStudentAvatarAction(avatarPath: string) {
  const { supabase, user, snapshot } = await getStudentPortalContext();
  const expectedAvatarPath = `${user.id}/avatar`;

  if (avatarPath.trim() !== expectedAvatarPath) {
    return { ok: false as const, error: "invalid_avatar_path" };
  }

  const { data: uploadedObjects, error: storageError } = await supabase.storage
    .from("profile-avatars")
    .list(user.id, {
      limit: 1,
      search: "avatar",
    });

  if (storageError || !uploadedObjects?.some((object) => object.name === "avatar")) {
    return { ok: false as const, error: "avatar_upload_missing" };
  }

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      full_name: snapshot.profile.full_name,
      phone: snapshot.profile.phone,
      avatar_url: expectedAvatarPath,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  if (profileError) {
    return { ok: false as const, error: "avatar_profile_update_failed" };
  }

  revalidatePath("/student");
  revalidatePath("/student/perfil");
  revalidatePath("/student/recompensas");

  return { ok: true as const };
}

export async function updateStudentProfileAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim() || null;
  const birthDate = String(formData.get("birth_date") ?? "").trim();

  if (!birthDate) {
    redirect("/student/perfil?edit=1&error=birth_date_required");
  }

  const { supabase } = await getStudentPortalContext();
  const { error } = await supabase.rpc("student_update_reward_onboarding_profile", {
    target_email: email,
    target_birth_date: birthDate,
  });

  if (error) {
    redirect(`/student/perfil?edit=1&error=${errorCode(error, "profile_update_failed")}`);
  }

  revalidatePath("/student");
  revalidatePath("/student/perfil");
  revalidatePath("/student/recompensas");
  redirect("/student/perfil?updated=1");
}
