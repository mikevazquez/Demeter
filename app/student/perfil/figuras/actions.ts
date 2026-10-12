"use server";

import { revalidatePath } from "next/cache";

import { POLE_PHOTO_BUCKET } from "@/lib/pole/constants";
import { getStudentShellContext } from "@/lib/student/portal";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StudentPoleActionResult = { ok: true } | { ok: false; error: string };

function errorCode(error: { message?: string } | null) {
  return error?.message?.match(/pole_[a-z_]+/)?.[0] ?? "pole_action_failed";
}

function refresh() {
  revalidatePath("/student/perfil/figuras");
}

export async function markPoleFigureAction(elementId: string): Promise<StudentPoleActionResult> {
  if (!UUID.test(elementId)) return { ok: false, error: "pole_invalid_input" };
  const { supabase } = await getStudentShellContext();
  const { error } = await supabase.rpc("student_mark_pole_figure", { p_element_id: elementId });
  if (error) return { ok: false, error: errorCode(error) };
  refresh();
  return { ok: true };
}

export async function unmarkPoleFigureAction(elementId: string): Promise<StudentPoleActionResult> {
  if (!UUID.test(elementId)) return { ok: false, error: "pole_invalid_input" };
  const { supabase } = await getStudentShellContext();
  const { data, error } = await supabase.rpc("student_unmark_pole_figure", {
    p_element_id: elementId,
  });
  if (error) return { ok: false, error: errorCode(error) };

  const photoPath = (data as { photo_path?: string | null } | null)?.photo_path;
  if (photoPath) {
    await supabase.storage.from(POLE_PHOTO_BUCKET).remove([photoPath]);
  }
  refresh();
  return { ok: true };
}

/** Asocia una foto ya subida (o la quita con null) y borra la anterior de Storage. */
export async function setPolePhotoAction(
  elementId: string,
  photoPath: string | null,
): Promise<StudentPoleActionResult> {
  if (!UUID.test(elementId)) return { ok: false, error: "pole_invalid_input" };
  const { supabase, user } = await getStudentShellContext();

  if (photoPath !== null) {
    const prefix = `${user.id}/${elementId}/`;
    if (!photoPath.startsWith(prefix) || photoPath.includes("..")) {
      return { ok: false, error: "pole_photo_invalid_path" };
    }
  }

  const { data, error } = await supabase.rpc("student_set_pole_photo", {
    p_element_id: elementId,
    p_photo_path: photoPath,
  });
  if (error) return { ok: false, error: errorCode(error) };

  const previous = (data as { previous_photo_path?: string | null } | null)?.previous_photo_path;
  if (previous && previous !== photoPath) {
    await supabase.storage.from(POLE_PHOTO_BUCKET).remove([previous]);
  }
  refresh();
  return { ok: true };
}
