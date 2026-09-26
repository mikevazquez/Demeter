"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function field(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function changeStudioPlanAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login/studio");

  const { data: platformAdmin } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (!platformAdmin) redirect("/");

  const studioId = field(formData, "studio_id");
  const planId = field(formData, "plan_id");
  const reason = field(formData, "reason");

  if (!studioId || !planId) {
    redirect("/setup/planes?error=invalid_request");
  }

  const [{ data: targetPlan }, { data: currentAssignment }] = await Promise.all([
    supabase
      .from("saas_plans")
      .select("id,plan_key,name")
      .eq("id", planId)
      .eq("active", true)
      .maybeSingle(),
    supabase
      .from("studio_plan_assignments")
      .select("plan_id,metadata")
      .eq("studio_id", studioId)
      .maybeSingle(),
  ]);

  if (!targetPlan) {
    redirect("/setup/planes?error=invalid_plan");
  }

  if (currentAssignment?.plan_id === targetPlan.id) {
    redirect(
      `/setup/planes?saved=unchanged&studio=${encodeURIComponent(studioId)}`,
    );
  }

  const currentMetadata = isRecord(currentAssignment?.metadata)
    ? currentAssignment.metadata
    : {};
  const now = new Date().toISOString();

  const { error } = await supabase.from("studio_plan_assignments").upsert(
    {
      studio_id: studioId,
      plan_id: targetPlan.id,
      status: "active",
      starts_at: now,
      ends_at: null,
      metadata: {
        ...currentMetadata,
        assignment_source: "platform_admin_manual",
        change_reason: reason || "Cambio manual desde administración de plataforma",
      },
      updated_at: now,
    },
    { onConflict: "studio_id" },
  );

  if (error) {
    redirect("/setup/planes?error=save_failed");
  }

  revalidatePath("/setup/planes");
  redirect(
    `/setup/planes?saved=1&studio=${encodeURIComponent(studioId)}&plan=${encodeURIComponent(
      targetPlan.plan_key,
    )}`,
  );
}
