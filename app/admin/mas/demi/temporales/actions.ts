"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

export type TemporaryInformationActionState = { error?: string };

const path = "/admin/mas/demi/temporales";
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string) {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function saveDemiTemporaryInformation(
  _previousState: TemporaryInformationActionState,
  formData: FormData,
): Promise<TemporaryInformationActionState> {
  const { supabase, studio, user } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const id = String(formData.get("id") ?? "").trim();
  const title = String(formData.get("title") ?? "")
    .trim()
    .slice(0, 160);
  const kind = String(formData.get("kind") ?? "");
  const discipline =
    String(formData.get("discipline") ?? "")
      .trim()
      .slice(0, 120) || null;
  const details = String(formData.get("details") ?? "")
    .trim()
    .slice(0, 5000);
  const promotionStartsOn = String(formData.get("promotion_starts_on") ?? "");
  const eventStartsOn = String(formData.get("event_starts_on") ?? "");
  const eventEndsOn = String(formData.get("event_ends_on") ?? "");
  const registrationDeadline = String(formData.get("registration_deadline") ?? "").trim() || null;
  const status = String(formData.get("status") ?? "draft");

  if (
    !title ||
    title.length < 2 ||
    details.length < 1 ||
    !["workshop", "promotion", "event"].includes(kind)
  ) {
    return { error: "Completa el título, el tipo y la información que Demi debe responder." };
  }
  if (
    !validDate(promotionStartsOn) ||
    !validDate(eventStartsOn) ||
    !validDate(eventEndsOn) ||
    (registrationDeadline != null && !validDate(registrationDeadline))
  ) {
    return {
      error: "Revisa las fechas. Usa fechas válidas para el periodo de anuncio y el evento.",
    };
  }
  if (
    eventStartsOn > eventEndsOn ||
    promotionStartsOn > eventEndsOn ||
    (registrationDeadline != null &&
      (registrationDeadline < promotionStartsOn || registrationDeadline > eventEndsOn))
  ) {
    return {
      error: "El periodo de promoción, el evento y el cierre de inscripciones no coinciden.",
    };
  }
  if (!["draft", "published", "archived"].includes(status)) {
    return { error: "Selecciona un estado válido." };
  }

  const payload = {
    title,
    kind,
    discipline,
    details,
    promotion_starts_on: promotionStartsOn,
    event_starts_on: eventStartsOn,
    event_ends_on: eventEndsOn,
    registration_deadline: registrationDeadline,
    status,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };

  if (id) {
    const { data, error } = await supabase
      .from("demi_temporary_information")
      .update(payload)
      .eq("studio_id", studio.id)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error || !data) return { error: "No se pudo actualizar la información. Intenta de nuevo." };
  } else {
    const { error } = await supabase.from("demi_temporary_information").insert({
      ...payload,
      studio_id: studio.id,
      created_by: user.id,
    });
    if (error) return { error: "No se pudo guardar la información. Intenta de nuevo." };
  }

  revalidatePath(path);
  revalidatePath("/admin/mas/demi");
  redirect(`${path}?guardado=1`);
}

export async function archiveDemiTemporaryInformation(formData: FormData) {
  const { supabase, studio, user } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const id = String(formData.get("id") ?? "").trim();
  if (!id) redirect(path);

  const { error } = await supabase
    .from("demi_temporary_information")
    .update({
      status: "archived",
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("studio_id", studio.id)
    .eq("id", id);
  if (error) redirect(`${path}?error=guardar`);

  revalidatePath(path);
  redirect(path);
}
