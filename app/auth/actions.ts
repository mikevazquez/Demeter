"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function loginPath(mode: "admin" | "student") {
  return mode === "admin" ? "/login/admin" : "/login/student";
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const mode = formData.get("mode") === "student" ? "student" : "admin";

  if (!email || !password) {
    redirect(`${loginPath(mode)}?error=missing`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    redirect(`${loginPath(mode)}?error=invalid`);
  }

  const { data: membership } = await supabase
    .from("studio_memberships")
    .select("role, active")
    .eq("user_id", data.user.id)
    .eq("active", true)
    .maybeSingle();

  if (!membership) {
    await supabase.auth.signOut();
    redirect(`${loginPath(mode)}?error=pending`);
  }

  if (mode === "admin" && !["owner", "admin", "coach"].includes(membership.role)) {
    await supabase.auth.signOut();
    redirect("/login/admin?error=access");
  }

  if (mode === "student" && membership.role !== "student") {
    await supabase.auth.signOut();
    redirect("/login/student?error=access");
  }

  redirect(mode === "admin" ? "/admin" : "/student");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
