"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function activationErrorUrl(
  tokenHash: string | null,
  type: string | null,
  entryKey: string | null,
  error: string,
) {
  const params = new URLSearchParams({ error });

  if (entryKey) params.set("entry", entryKey);
  if (tokenHash && type === "recovery") {
    params.set("token_hash", tokenHash);
    params.set("type", "recovery");
  }

  return `/login/student/activar?${params.toString()}`;
}

export async function completeStudentPasswordActivation(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("password_confirmation") ?? "");
  const tokenHash = String(formData.get("token_hash") ?? "").trim() || null;
  const type = String(formData.get("type") ?? "").trim() || null;
  const entryKey = String(formData.get("entry") ?? "").trim() || null;

  if (password.length < 8 || password !== confirmation) {
    redirect(activationErrorUrl(tokenHash, type, entryKey, "invalid"));
  }

  const supabase = await createClient();

  if (tokenHash) {
    if (type !== "recovery") {
      redirect(activationErrorUrl(null, null, entryKey, "link"));
    }

    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    });

    if (verifyError) {
      redirect(activationErrorUrl(tokenHash, type, entryKey, "link"));
    }
  }

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
  if (passwordError) {
    redirect(activationErrorUrl(tokenHash, type, entryKey, "password"));
  }

  const { error: activationError } = await supabase.rpc("student_complete_password_activation");
  if (activationError) {
    redirect(activationErrorUrl(tokenHash, type, entryKey, "save"));
  }

  redirect("/student");
}
