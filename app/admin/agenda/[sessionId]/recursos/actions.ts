"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

export async function saveSessionResourcesAction(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "").trim();
  const defaultUses = Number.parseInt(String(formData.get("default_uses") ?? "1"), 10);

  if (!sessionId || !Number.isInteger(defaultUses) || defaultUses < 1 || defaultUses > 20) {
    redirect(`/admin/agenda/${sessionId}/recursos?error=invalid`);
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id,space_id,requires_resource,status")
    .eq("id", sessionId)
    .eq("studio_id", studio.id)
    .maybeSingle();

  if (!session || !session.requires_resource || !session.space_id) {
    redirect(`/admin/agenda/${sessionId}?error=resource`);
  }

  if (session.status === "cancelled") {
    redirect(`/admin/agenda/${sessionId}/recursos?error=cancelled`);
  }

  const { data: resources } = await supabase
    .from("resources")
    .select("id")
    .eq("studio_id", studio.id)
    .eq("space_id", session.space_id);

  const settings = (resources ?? []).map((resource) => {
    const capacityRaw = String(formData.get(`capacity_${resource.id}`) ?? "").trim();
    const capacityOverride = capacityRaw ? Number.parseInt(capacityRaw, 10) : null;

    return {
      resource_id: resource.id,
      enabled: String(formData.get(`enabled_${resource.id}`) ?? "") === "1",
      capacity_override:
        capacityOverride && Number.isInteger(capacityOverride) && capacityOverride > 0
          ? capacityOverride
          : null,
    };
  });

  const { error } = await supabase.rpc("admin_save_session_resources", {
    p_session_id: sessionId,
    p_default_uses: defaultUses,
    p_resource_settings: settings,
  });

  if (error) {
    const code = error.message.includes("active_assignments")
      ? "assigned"
      : error.message.includes("resource_full")
        ? "assigned"
        : "save";
    redirect(`/admin/agenda/${sessionId}/recursos?error=${code}`);
  }

  revalidatePath(`/admin/agenda/${sessionId}/recursos`);
  revalidatePath(`/admin/agenda/${sessionId}`);
  revalidatePath("/student/reservar");
  redirect(`/admin/agenda/${sessionId}/recursos?saved=1`);
}

export async function reassignReservationResourceAction(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "").trim();
  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const targetResourceId = String(formData.get("target_resource_id") ?? "").trim();

  if (!sessionId || !assignmentId || !targetResourceId) {
    redirect(`/admin/agenda/${sessionId}/recursos?error=reassign`);
  }

  const { supabase } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { error } = await supabase.rpc("admin_reassign_reservation_resource", {
    p_assignment_id: assignmentId,
    p_target_resource_id: targetResourceId,
  });

  if (error) {
    const code = error.message.includes("resource_full")
      ? "reassign_full"
      : error.message.includes("resource_not_available")
        ? "reassign_unavailable"
        : "reassign";
    redirect(`/admin/agenda/${sessionId}/recursos?error=${code}`);
  }

  revalidatePath(`/admin/agenda/${sessionId}/recursos`);
  revalidatePath(`/admin/agenda/${sessionId}`);
  revalidatePath("/student/reservar");
  revalidatePath("/coach");
  redirect(`/admin/agenda/${sessionId}/recursos?reassigned=1`);
}

export async function restoreSessionResourceDefaultsAction(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "").trim();

  if (!sessionId) {
    redirect("/admin/agenda");
  }

  const { supabase } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { error } = await supabase.rpc("admin_restore_session_resource_defaults", {
    p_session_id: sessionId,
  });

  if (error) {
    const code = error.message.includes("resource_defaults_conflict")
      ? "restore_conflict"
      : error.message.includes("resource_session_requires_space")
        ? "restore_space"
        : "restore";
    redirect(`/admin/agenda/${sessionId}/recursos?error=${code}`);
  }

  revalidatePath(`/admin/agenda/${sessionId}/recursos`);
  revalidatePath(`/admin/agenda/${sessionId}`);
  revalidatePath("/student/reservar");
  redirect(`/admin/agenda/${sessionId}/recursos?restored=1`);
}
