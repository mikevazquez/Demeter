"use server";

import { redirect } from "next/navigation";

import {
  maskEmail,
  newPasswordError,
  phoneTail,
  sessionCameFromRecovery,
} from "@/lib/auth/password-recovery-core";
import {
  requestOrigin,
  requestStudentPasswordRecovery,
  requestStudioPasswordRecovery,
} from "@/lib/auth/password-recovery";
import { normalizeMexicanPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

export type RecoveryRequestState = {
  status: "idle" | "sent" | "invalid" | "unavailable";
  destination: string | null;
  identifier: string | null;
  previewLink: string | null;
  sentAt: number | null;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function state(partial: Partial<RecoveryRequestState>): RecoveryRequestState {
  return {
    status: "idle",
    destination: null,
    identifier: null,
    previewLink: null,
    sentAt: null,
    ...partial,
  };
}

export async function requestStudentRecoveryAction(
  _previous: RecoveryRequestState,
  formData: FormData,
): Promise<RecoveryRequestState> {
  const phone = normalizeMexicanPhone(String(formData.get("phone") ?? ""));
  if (!phone) return state({ status: "invalid" });

  const origin = await requestOrigin();
  if (!origin) return state({ status: "unavailable" });

  try {
    const result = await requestStudentPasswordRecovery(phone, origin);
    return state({
      status: "sent",
      destination: phoneTail(phone),
      identifier: phone,
      previewLink: result.previewLink,
      sentAt: Date.now(),
    });
  } catch (error) {
    console.error("[auth.recovery] student request failed", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return state({ status: "unavailable" });
  }
}

export async function requestStudioRecoveryAction(
  _previous: RecoveryRequestState,
  formData: FormData,
): Promise<RecoveryRequestState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) return state({ status: "invalid" });

  const origin = await requestOrigin();
  if (!origin) return state({ status: "unavailable" });

  try {
    await requestStudioPasswordRecovery(email, origin);
    return state({
      status: "sent",
      destination: maskEmail(email),
      identifier: email,
      sentAt: Date.now(),
    });
  } catch (error) {
    console.error("[auth.recovery] studio request failed", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return state({ status: "unavailable" });
  }
}

function studentNewPasswordUrl(tokenHash: string | null, error: string) {
  const params = new URLSearchParams({ error });
  if (tokenHash && error !== "link") params.set("token_hash", tokenHash);
  return `/login/student/recuperar/nueva?${params.toString()}`;
}

export async function completeStudentRecoveryAction(formData: FormData) {
  const tokenHash = String(formData.get("token_hash") ?? "").trim() || null;
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("password_confirmation") ?? "");

  if (!tokenHash) redirect(studentNewPasswordUrl(null, "link"));
  const passwordError = newPasswordError(password, confirmation);
  if (passwordError) redirect(studentNewPasswordUrl(tokenHash, passwordError));

  // The token is only spent here, on submit, so link previews cannot burn it.
  const supabase = await createClient("student");
  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "recovery",
  });
  if (verifyError) redirect(studentNewPasswordUrl(null, "link"));

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(studentNewPasswordUrl(null, "link"));

  const [{ data: account }, { data: membership }] = await Promise.all([
    supabase
      .from("user_accounts")
      .select("status, must_change_password")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("studio_memberships")
      .select("studio_id")
      .eq("user_id", user.id)
      .eq("role", "student")
      .eq("active", true)
      .limit(1)
      .maybeSingle(),
  ]);

  if (!account || account.status !== "active" || !membership) {
    await supabase.auth.signOut();
    redirect("/login/student?error=access");
  }

  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    // The token was already used; the student keeps this session and can retry from the form.
    console.error("[auth.recovery] student password update failed", { code: updateError.code });
    redirect("/login/student/recuperar/nueva?error=password&session=1");
  }

  if (account.must_change_password) {
    await supabase.rpc("student_complete_password_activation");
  }
  await supabase.auth.signOut({ scope: "others" });
  redirect("/login/student/recuperar/listo");
}

export async function retryStudentRecoveryPasswordAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("password_confirmation") ?? "");
  const passwordError = newPasswordError(password, confirmation);
  if (passwordError) redirect(`/login/student/recuperar/nueva?error=${passwordError}&session=1`);

  const supabase = await createClient("student");
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (
    !user ||
    !session ||
    !sessionCameFromRecovery(session.access_token, Math.floor(Date.now() / 1000))
  ) {
    redirect(studentNewPasswordUrl(null, "link"));
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect("/login/student/recuperar/nueva?error=password&session=1");

  const { data: account } = await supabase
    .from("user_accounts")
    .select("must_change_password")
    .eq("id", user.id)
    .maybeSingle();
  if (account?.must_change_password) await supabase.rpc("student_complete_password_activation");
  await supabase.auth.signOut({ scope: "others" });
  redirect("/login/student/recuperar/listo");
}

export async function completeStudioRecoveryAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("password_confirmation") ?? "");
  const passwordError = newPasswordError(password, confirmation);
  if (passwordError) redirect(`/login/studio/recuperar/nueva?error=${passwordError}`);

  const supabase = await createClient("admin");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // Only a session opened by a recovery link may set a password without the current one.
  if (
    !user ||
    !session ||
    !sessionCameFromRecovery(session.access_token, Math.floor(Date.now() / 1000))
  ) {
    redirect("/login/studio/recuperar/nueva?error=link");
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error("[auth.recovery] studio password update failed", { code: error.code });
    redirect("/login/studio/recuperar/nueva?error=password");
  }

  await supabase.auth.signOut({ scope: "others" });
  redirect("/login/studio/recuperar/listo");
}
