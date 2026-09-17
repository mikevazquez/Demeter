"use server";

import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { studentAuthEmailFromPhone } from "@/lib/auth/student-login-identifier";
import { normalizeMexicanPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

type LoginMode = "admin" | "coach" | "student";

function loginPath(mode: LoginMode) {
  if (mode === "student") return "/login/student";
  if (mode === "coach") return "/login/coach";
  return "/login/admin";
}

function passwordIntegrity(password: string) {
  return {
    passwordLength: password.length,
    hasOuterWhitespace: password !== password.trim(),
    asciiOnly: /^[\x20-\x7e]*$/.test(password),
    unicodeNormalizationChanged: password.normalize("NFKC") !== password,
  };
}

function authErrorSummary(error: { code?: string; status?: number; message?: string } | null) {
  if (!error) return null;
  return {
    code: error.code,
    status: error.status,
    message: error.message?.slice(0, 160),
  };
}

export async function signIn(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const requestedMode = String(formData.get("mode") ?? "");
  const mode: LoginMode =
    requestedMode === "student" ? "student" : requestedMode === "coach" ? "coach" : "admin";
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const phone = normalizeMexicanPhone(String(formData.get("phone") ?? ""));
  const studentAuthEmail = phone ? studentAuthEmailFromPhone(phone) : null;

  if (!password || (mode === "student" ? !phone || !studentAuthEmail : !email)) {
    redirect(`${loginPath(mode)}?error=missing`);
  }

  const supabase = await createClient();
  const credentials =
    mode === "student" ? { email: studentAuthEmail!, password } : { email, password };
  let { data, error } = await supabase.auth.signInWithPassword(credentials);
  let trimRetryAttempted = false;

  if (mode === "student" && error?.code === "invalid_credentials") {
    const trimmedPassword = password.trim();
    if (trimmedPassword && trimmedPassword !== password) {
      trimRetryAttempted = true;
      const retry = await supabase.auth.signInWithPassword({
        email: studentAuthEmail!,
        password: trimmedPassword,
      });
      if (!retry.error && retry.data.user) {
        data = retry.data;
        error = null;
      }
    }
  }

  if (error || !data.user) {
    if (error) {
      console.error("[auth.signIn] Supabase Auth rejected sign-in", {
        mode,
        code: error.code,
        status: error.status,
        name: error.name,
        message: error.message.slice(0, 160),
        ...(mode === "student"
          ? {
              ...passwordIntegrity(password),
              trimRetryAttempted,
            }
          : {}),
      });
    }

    if (error?.code === "invalid_credentials") {
      redirect(`${loginPath(mode)}?error=invalid`);
    }

    if (error?.status === 429) {
      redirect(`${loginPath(mode)}?error=rate`);
    }

    redirect(`${loginPath(mode)}?error=auth`);
  }

  // Recreate the SSR client after sign-in so post-login RLS checks read the
  // freshly persisted session cookies instead of the pre-auth request state.
  const accessClient = await createClient();
  const [accountResult, membershipResult] = await Promise.all([
    accessClient
      .from("user_accounts")
      .select("status, must_change_password")
      .eq("id", data.user.id)
      .maybeSingle(),
    accessClient
      .from("studio_memberships")
      .select("studio_id, role, active")
      .eq("user_id", data.user.id)
      .eq("active", true)
      .limit(1)
      .maybeSingle(),
  ]);

  if (accountResult.error || membershipResult.error) {
    console.error("[auth.signIn] Access context lookup failed", {
      mode,
      accountError: authErrorSummary(accountResult.error),
      membershipError: authErrorSummary(membershipResult.error),
    });
    await accessClient.auth.signOut();
    redirect(`${loginPath(mode)}?error=auth`);
  }

  const account = accountResult.data;
  const membership = membershipResult.data;

  if (!account || account.status !== "active") {
    await accessClient.auth.signOut();
    redirect(`${loginPath(mode)}?error=access`);
  }

  if (!membership) {
    await accessClient.auth.signOut();
    redirect(`${loginPath(mode)}?error=pending`);
  }

  const requiredCapability =
    mode === "student"
      ? CAPABILITIES.STUDENT_PORTAL
      : mode === "coach"
        ? CAPABILITIES.INSTRUCTOR_PORTAL
        : CAPABILITIES.ADMIN_PORTAL;
  const [studioResult, roleCapabilityResult] = await Promise.all([
    accessClient.from("studios").select("status").eq("id", membership.studio_id).maybeSingle(),
    accessClient
      .from("role_capabilities")
      .select("capability_key")
      .eq("role", membership.role)
      .eq("capability_key", requiredCapability)
      .maybeSingle(),
  ]);

  if (studioResult.error || roleCapabilityResult.error) {
    console.error("[auth.signIn] Portal capability lookup failed", {
      mode,
      studioError: authErrorSummary(studioResult.error),
      capabilityError: authErrorSummary(roleCapabilityResult.error),
    });
    await accessClient.auth.signOut();
    redirect(`${loginPath(mode)}?error=auth`);
  }

  const studio = studioResult.data;
  const roleCapability = roleCapabilityResult.data;

  if (!studio || studio.status !== "active" || !roleCapability) {
    await accessClient.auth.signOut();
    redirect(`${loginPath(mode)}?error=access`);
  }

  if (mode === "student" && account.must_change_password) {
    redirect("/login/student/activar");
  }
  if (mode === "coach" && account.must_change_password) {
    redirect("/login/coach/activar");
  }

  if (mode === "student") redirect("/student");
  if (mode === "coach") redirect("/coach");
  redirect("/admin");
}

export async function createInitialOwnerAccount(formData: FormData) {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!fullName || !email || password.length < 8) {
    redirect("/setup?error=invalid");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });

  if (error || !data.user) {
    redirect("/setup?error=signup");
  }

  await supabase.auth.signOut();
  redirect("/setup?created=1");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
