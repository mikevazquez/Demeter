"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function completeStudentPasswordActivation(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("password_confirmation") ?? "");

  if (password.length < 8 || password !== confirmation) {
    redirect("/login/student/activar?error=invalid");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login/student");

  const [{ data: account }, { data: membership }] = await Promise.all([
    supabase
      .from("user_accounts")
      .select("status, must_change_password")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("studio_memberships")
      .select("studio_id, role, active")
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

  if (!account.must_change_password) redirect("/student");

  const { error: passwordError } = await supabase.auth.updateUser({ password });
  if (passwordError) redirect("/login/student/activar?error=password");

  const { error: activationError } = await supabase.rpc("student_complete_password_activation");
  if (activationError) redirect("/login/student/activar?error=save");

  redirect("/student");
}
