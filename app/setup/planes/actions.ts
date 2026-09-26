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


const subscriptionStatuses = new Set([
  "trialing",
  "active",
  "past_due",
  "suspended",
  "cancelled",
]);

function utcDateTimeField(formData: FormData, key: string) {
  const value = field(formData, key);
  if (!value) return null;

  const parsed = new Date(value.endsWith("Z") ? value : `${value}:00Z`);
  if (Number.isNaN(parsed.getTime())) return "invalid";
  return parsed.toISOString();
}

export async function changeStudioSubscriptionAction(formData: FormData) {
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
  const status = field(formData, "status");
  const reason = field(formData, "billing_reason");
  const trialEndsAt = utcDateTimeField(formData, "trial_ends_at");
  const graceEndsAt = utcDateTimeField(formData, "grace_ends_at");
  const currentPeriodEnd = utcDateTimeField(formData, "current_period_end");
  const cancelAtPeriodEnd = formData.get("cancel_at_period_end") === "on";

  if (
    !studioId ||
    !subscriptionStatuses.has(status) ||
    trialEndsAt === "invalid" ||
    graceEndsAt === "invalid" ||
    currentPeriodEnd === "invalid"
  ) {
    redirect("/setup/planes?error=invalid_subscription");
  }

  if (cancelAtPeriodEnd && !currentPeriodEnd) {
    redirect("/setup/planes?error=cancel_period_required");
  }

  const { data: currentAssignment } = await supabase
    .from("studio_plan_assignments")
    .select(
      "metadata,current_period_start,current_period_end,billing_provider,provider_customer_id,provider_subscription_id",
    )
    .eq("studio_id", studioId)
    .maybeSingle();

  if (!currentAssignment) {
    redirect("/setup/planes?error=assignment_missing");
  }

  const currentMetadata = isRecord(currentAssignment.metadata)
    ? currentAssignment.metadata
    : {};
  const now = new Date().toISOString();

  const payload: Record<string, unknown> = {
    status,
    current_period_end: currentPeriodEnd ?? currentAssignment.current_period_end,
    cancel_at_period_end: status === "active" ? cancelAtPeriodEnd : false,
    metadata: {
      ...currentMetadata,
      billing_source: "platform_admin_manual",
      billing_reason: reason || `Estado de suscripción actualizado a ${status}`,
    },
    updated_at: now,
  };

  if (status === "active") {
    Object.assign(payload, {
      trial_ends_at: null,
      grace_ends_at: null,
      suspended_at: null,
      cancelled_at: null,
      last_payment_failure_at: null,
    });
  } else if (status === "trialing") {
    Object.assign(payload, {
      trial_ends_at: trialEndsAt,
      grace_ends_at: null,
      suspended_at: null,
      cancelled_at: null,
      last_payment_failure_at: null,
      cancel_at_period_end: false,
    });
  } else if (status === "past_due") {
    Object.assign(payload, {
      trial_ends_at: null,
      grace_ends_at: graceEndsAt,
      suspended_at: null,
      cancelled_at: null,
      last_payment_failure_at: now,
      cancel_at_period_end: false,
    });
  } else if (status === "suspended") {
    Object.assign(payload, {
      grace_ends_at: null,
      suspended_at: now,
      cancelled_at: null,
      cancel_at_period_end: false,
    });
  } else if (status === "cancelled") {
    Object.assign(payload, {
      grace_ends_at: null,
      suspended_at: null,
      cancelled_at: now,
      cancel_at_period_end: false,
    });
  }

  const { error } = await supabase
    .from("studio_plan_assignments")
    .update(payload)
    .eq("studio_id", studioId);

  if (error) {
    redirect("/setup/planes?error=subscription_save_failed");
  }

  revalidatePath("/setup/planes");
  revalidatePath("/admin/suscripcion");
  redirect(
    `/setup/planes?subscription_saved=1&studio=${encodeURIComponent(
      studioId,
    )}&subscription_status=${encodeURIComponent(status)}`,
  );
}
