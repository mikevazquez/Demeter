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
  const { data, error } = await supabase.auth.signInWithPassword(credentials);

  if (error || !data.user) {
    if (error) {
      console.error("[auth.signIn] Supabase Auth rejected sign-in", {
        mode,
        code: error.code,
        status: error.status,
        name: error.name,
        message: error.message.slice(0, 160),
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

  const [{ data: account }, { data: membership }] = await Promise.all([
    supabase
      .from("user_accounts")
      .select("status, must_change_password")
      .eq("id", data.user.id)
      .maybeSingle(),
    supabase
      .from("studio_memberships")
      .select("studio_id, role, active")
      .eq("user_id", data.user.id)
      .eq("active", true)
      .limit(1)
      .maybeSingle(),
  ]);

  if (!account || account.status !== "active") {
    await supabase.auth.signOut();
    redirect(`${loginPath(mode)}?error=access`);
  }

  if (!membership) {
    await supabase.auth.signOut();
    redirect(`${loginPath(mode)}?error=pending`);
  }

  const requiredCapability =
    mode === "student"
      ? CAPABILITIES.STUDENT_PORTAL
      : mode === "coach"
        ? CAPABILITIES.INSTRUCTOR_PORTAL
        : CAPABILITIES.ADMIN_PORTAL;
  const [{ data: studio }, { data: roleCapability }] = await Promise.all([
    supabase.from("studios").select("status").eq("id", membership.studio_id).maybeSingle(),
    supabase
      .from("role_capabilities")
      .select("capability_key")
      .eq("role", membership.role)
      .eq("capability_key", requiredCapability)
      .maybeSingle(),
  ]);

  if (!studio || studio.status !== "active" || !roleCapability) {
    await supabase.auth.signOut();
    redirect(`${loginPath(mode)}?error=access`);
  }

  if (mode === "student" && account.must_change_password) {
    redirect("/login/student/activar");
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
