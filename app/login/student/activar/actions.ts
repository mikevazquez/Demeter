"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  STUDIO_CONTEXT_COOKIE,
  studioContextCookieOptions,
} from "@/lib/auth/studio-context-cookie";
import { createClient } from "@/lib/supabase/server";

function normalizeStudioSlug(value: FormDataEntryValue | null) {
  const slug = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : "";
}

function activationErrorUrl(
  tokenHash: string | null,
  type: string | null,
  studioSlug: string,
  error: string,
) {
  const params = new URLSearchParams({ error });

  if (tokenHash && type === "recovery") {
    params.set("token_hash", tokenHash);
    params.set("type", "recovery");
  }
  if (studioSlug) params.set("studio", studioSlug);

  return `/login/student/activar?${params.toString()}`;
}

async function setSelectedStudio(studioId: string) {
  const cookieStore = await cookies();
  cookieStore.set(STUDIO_CONTEXT_COOKIE, studioId, studioContextCookieOptions());
}

export async function completeStudentPasswordActivation(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("password_confirmation") ?? "");
  const tokenHash = String(formData.get("token_hash") ?? "").trim() || null;
  const type = String(formData.get("type") ?? "").trim() || null;
  const requestedStudioSlug = normalizeStudioSlug(formData.get("studio_slug"));

  if (password.length < 8 || password !== confirmation) {
    redirect(activationErrorUrl(tokenHash, type, requestedStudioSlug, "invalid"));
  }

  const supabase = await createClient();

  if (tokenHash) {
    if (type !== "recovery") {
      redirect(activationErrorUrl(null, null, requestedStudioSlug, "link"));
    }

    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    });

    if (verifyError) {
      redirect(activationErrorUrl(tokenHash, type, requestedStudioSlug, "link"));
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      requestedStudioSlug
        ? `/login/student?studio=${encodeURIComponent(requestedStudioSlug)}`
        : "/login/student",
    );
  }

  const [{ data: account }, { data: memberships }] = await Promise.all([
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
      .eq("active", true),
  ]);

  if (!account || account.status !== "active" || !memberships?.length) {
    await supabase.auth.signOut();
    redirect(
      requestedStudioSlug
        ? `/login/student?studio=${encodeURIComponent(requestedStudioSlug)}&error=access`
        : "/login/student?error=access",
    );
  }

  if (!account.must_change_password) {
    redirect("/login/student/seleccionar");
  }

  const { error: passwordError } = await supabase.auth.updateUser({ password });
  if (passwordError) {
    redirect(activationErrorUrl(tokenHash, type, requestedStudioSlug, "password"));
  }

  const { error: activationError } = await supabase.rpc("student_complete_password_activation");
  if (activationError) {
    redirect(activationErrorUrl(tokenHash, type, requestedStudioSlug, "save"));
  }

  if (requestedStudioSlug) {
    const membershipStudioIds = memberships.map((membership) => membership.studio_id);
    const { data: requestedStudio } = await supabase
      .from("studios")
      .select("id")
      .eq("slug", requestedStudioSlug)
      .eq("status", "active")
      .in("id", membershipStudioIds)
      .maybeSingle();

    if (requestedStudio) {
      const { data: student } = await supabase
        .from("students")
        .select("id")
        .eq("studio_id", requestedStudio.id)
        .eq("user_id", user.id)
        .eq("active", true)
        .eq("lifecycle_status", "active")
        .maybeSingle();

      if (student) {
        await setSelectedStudio(requestedStudio.id);
        redirect("/student");
      }
    }
  }

  redirect("/login/student/seleccionar");
}
