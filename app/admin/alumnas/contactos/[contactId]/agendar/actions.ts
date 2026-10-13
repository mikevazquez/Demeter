"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

function scheduleUrl(contactId: string, query?: string) {
  const base = `/admin/alumnas/contactos/${contactId}/agendar`;
  return query ? `${base}?${query}` : base;
}

export async function scheduleProspectTrial(formData: FormData) {
  const contactId = String(formData.get("contact_id") ?? "").trim();
  const sessionId = String(formData.get("session_id") ?? "").trim();
  const paymentMethod = String(formData.get("payment_method") ?? "").trim();
  if (!contactId || !sessionId) redirect(scheduleUrl(contactId, "error=invalid_request"));
  if (!["cash", "bank_transfer"].includes(paymentMethod)) {
    redirect(scheduleUrl(contactId, "error=payment_method_required"));
  }

  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  if (!can(CAPABILITIES.STUDENTS_WRITE)) {
    redirect(scheduleUrl(contactId, "error=forbidden"));
  }
  const { data, error } = await supabase.rpc("admin_schedule_prospect_trial", {
    target_studio_id: studio.id,
    target_contact_id: contactId,
    target_session_id: sessionId,
    target_payment_method: paymentMethod,
  });
  const result = data as { ok?: boolean } | null;
  if (error || result?.ok !== true) {
    const message = error?.message ?? "trial_booking_failed";
    const known = [
      "payment_method_required",
      "trial_not_eligible",
      "session_full",
      "already_reserved",
      "session_not_bookable",
      "forbidden",
    ].find((code) => message.includes(code));
    redirect(scheduleUrl(contactId, `error=${encodeURIComponent(known ?? "booking_failed")}`));
  }

  revalidatePath("/admin");
  revalidatePath("/admin/agenda");
  revalidatePath("/admin/alumnas");
  revalidatePath(`/admin/alumnas/contactos/${contactId}`);
  redirect(scheduleUrl(contactId, `created=${paymentMethod}`));
}
