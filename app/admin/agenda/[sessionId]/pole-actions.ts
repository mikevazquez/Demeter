"use server";

import { revalidatePath } from "next/cache";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { createServiceClient } from "@/lib/supabase/service";

type PoleResultEntry = {
  studentId: string;
  elementId: string;
};

export async function savePoleClassResultsAction(
  sessionId: string,
  entries: PoleResultEntry[],
): Promise<{ ok: true; saved: number }> {
  const normalizedSessionId = sessionId.trim();
  const normalizedEntries = entries
    .map((entry) => ({
      studentId: entry.studentId.trim(),
      elementId: entry.elementId.trim(),
    }))
    .filter((entry) => entry.studentId && entry.elementId);

  if (!normalizedSessionId) {
    throw new Error("pole_class_result_invalid");
  }

  const { supabase } = await getAdminContext(CAPABILITIES.EVALUATIONS_WRITE);

  for (const entry of normalizedEntries) {
    const { error } = await supabase.rpc("set_student_pole_figure_achievement", {
      p_student_id: entry.studentId,
      p_figure_element_id: entry.elementId,
      p_completed: true,
      p_class_session_id: normalizedSessionId,
    });

    if (error) {
      console.error("[catalog.class-combo] Could not save Pole class result", {
        code: error.code,
        message: error.message.slice(0, 160),
      });
      throw new Error("pole_class_result_save_failed");
    }

    revalidatePath(`/admin/alumnas/${entry.studentId}`);
  }

  revalidatePath(`/admin/agenda/${normalizedSessionId}`);
  revalidatePath("/admin");
  revalidatePath("/student/figuras");

  return { ok: true, saved: normalizedEntries.length };
}


export async function setProfessionalPoleAuthorizationAction(
  sessionId: string,
  studentId: string,
  elementId: string,
  authorized: boolean,
): Promise<{ ok: true }> {
  const normalizedSessionId = sessionId.trim();
  const normalizedStudentId = studentId.trim();
  const normalizedElementId = elementId.trim();

  if (!normalizedSessionId || !normalizedStudentId || !normalizedElementId) {
    throw new Error("pole_professional_authorization_invalid");
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.EVALUATIONS_WRITE);

  const [{ data: student }, { data: profile }] = await Promise.all([
    supabase
      .from("students")
      .select("id,studio_id,lifecycle_status")
      .eq("studio_id", studio.id)
      .eq("id", normalizedStudentId)
      .neq("lifecycle_status", "archived")
      .maybeSingle(),
    supabase
      .from("pole_figure_profiles")
      .select("element_id,discipline_id,catalog_level")
      .eq("studio_id", studio.id)
      .eq("element_id", normalizedElementId)
      .eq("catalog_level", "profesional")
      .maybeSingle(),
  ]);

  if (!student || !profile) {
    throw new Error("pole_professional_authorization_target_invalid");
  }

  const { data: levelAssignment } = await supabase
    .from("student_discipline_levels")
    .select("discipline_technical_level_id")
    .eq("studio_id", studio.id)
    .eq("student_id", normalizedStudentId)
    .eq("discipline_id", profile.discipline_id)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!levelAssignment?.discipline_technical_level_id) {
    throw new Error("pole_professional_authorization_level_required");
  }

  const { data: disciplineLevel } = await supabase
    .from("discipline_technical_levels")
    .select("technical_level_id")
    .eq("studio_id", studio.id)
    .eq("id", levelAssignment.discipline_technical_level_id)
    .maybeSingle();

  const { data: levelDefinition } = disciplineLevel?.technical_level_id
    ? await supabase
        .from("technical_level_definitions")
        .select("title")
        .eq("studio_id", studio.id)
        .eq("id", disciplineLevel.technical_level_id)
        .maybeSingle()
    : { data: null };

  if (!(levelDefinition?.title ?? "").toLowerCase().includes("avanz")) {
    throw new Error("pole_professional_authorization_advanced_only");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("pole_professional_authorization_actor_missing");

  const service = createServiceClient();
  const { data: existing } = await service
    .from("student_pole_authorizations")
    .select("id,revoked_at")
    .eq("studio_id", studio.id)
    .eq("student_id", normalizedStudentId)
    .eq("figure_element_id", normalizedElementId)
    .order("authorized_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (authorized) {
    if (existing) {
      const { error } = await service
        .from("student_pole_authorizations")
        .update({
          authorized_by: user.id,
          authorized_at: new Date().toISOString(),
          revoked_at: null,
        })
        .eq("id", existing.id);

      if (error) throw new Error("pole_professional_authorization_update_failed");
    } else {
      const { error } = await service.from("student_pole_authorizations").insert({
        studio_id: studio.id,
        student_id: normalizedStudentId,
        figure_element_id: normalizedElementId,
        authorized_by: user.id,
        authorized_at: new Date().toISOString(),
        revoked_at: null,
      });

      if (error) throw new Error("pole_professional_authorization_insert_failed");
    }
  } else if (existing && !existing.revoked_at) {
    const { error } = await service
      .from("student_pole_authorizations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", existing.id);

    if (error) throw new Error("pole_professional_authorization_revoke_failed");
  }

  revalidatePath(`/admin/agenda/${normalizedSessionId}`);
  revalidatePath(`/admin/alumnas/${normalizedStudentId}`);
  revalidatePath("/student/figuras");

  return { ok: true };
}
