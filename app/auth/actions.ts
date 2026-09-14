"use server";

import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { normalizeMexicanPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

function loginPath(mode: "admin" | "student") {
  return mode === "admin" ? "/login/admin" : "/login/student";
}

export async function signIn(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const mode = formData.get("mode") === "student" ? "student" : "admin";
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const phone = normalizeMexicanPhone(String(formData.get("phone") ?? ""));

  if (!password || (mode === "admin" ? !email : !phone)) {
    redirect(`${loginPath(mode)}?error=missing`);
  }

  const supabase = await createClient();
  const credentials = mode === "admin" ? { email, password } : { phone: phone!, password };
  const { data, error } = await supabase.auth.signInWithPassword(credentials);

  if (error || !data.user) {
    redirect(`${loginPath(mode)}?error=invalid`);
  }

  const { data: membership } = await supabase
    .from("studio_memberships")
    .select("studio_id, role, active")
    .eq("user_id", data.user.id)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (!membership) {
    await supabase.auth.signOut();
    redirect(`${loginPath(mode)}?error=pending`);
  }

  const requiredCapability =
    mode === "admin" ? CAPABILITIES.ADMIN_PORTAL : CAPABILITIES.STUDENT_PORTAL;
  const { data: roleCapability } = await supabase
    .from("role_capabilities")
    .select("capability_key")
    .eq("role", membership.role)
    .eq("capability_key", requiredCapability)
    .maybeSingle();

  if (!roleCapability) {
    await supabase.auth.signOut();
    redirect(`${loginPath(mode)}?error=access`);
  }

  redirect(mode === "admin" ? "/admin" : "/student");
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
