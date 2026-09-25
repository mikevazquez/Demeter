"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

const IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export async function saveDisciplineArtwork(formData: FormData) {
  const disciplineId = String(formData.get("discipline_id") ?? "");
  const entry = formData.get("cover_image");
  const removeImage = String(formData.get("remove_cover_image") ?? "") === "true";

  if (!disciplineId) redirect("/admin/disciplinas?error=invalid");

  const file = entry instanceof File && entry.size > 0 ? entry : null;
  if (!file && !removeImage) redirect("/admin/disciplinas?error=image_required");

  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { data: discipline } = await supabase
    .from("disciplines")
    .select("*")
    .eq("id", disciplineId)
    .eq("studio_id", studio.id)
    .maybeSingle();

  if (!discipline) redirect("/admin/disciplinas?error=invalid");

  const currentPath =
    typeof discipline.cover_image_path === "string" ? discipline.cover_image_path : null;
  let nextPath: string | null = removeImage ? null : currentPath;

  if (file) {
    const extension = IMAGE_TYPES.get(file.type);
    if (!extension) redirect("/admin/disciplinas?error=image_type");
    if (file.size > 8 * 1024 * 1024) redirect("/admin/disciplinas?error=image_size");

    nextPath = `${studio.id}/disciplines/${disciplineId}/${Date.now()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("class-artwork")
      .upload(nextPath, file, { contentType: file.type, upsert: false });

    if (uploadError) redirect("/admin/disciplinas?error=image_upload");
  }

  const { error: updateError } = await supabase
    .from("disciplines")
    .update({ cover_image_path: nextPath })
    .eq("id", disciplineId)
    .eq("studio_id", studio.id);

  if (updateError) {
    if (file && nextPath) await supabase.storage.from("class-artwork").remove([nextPath]);
    redirect("/admin/disciplinas?error=image_upload");
  }

  if (currentPath && currentPath !== nextPath) {
    await supabase.storage.from("class-artwork").remove([currentPath]);
  }

  revalidatePath("/admin/disciplinas");
  revalidatePath("/student");
  revalidatePath("/student/reservar");
  redirect("/admin/disciplinas?saved=1");
}
