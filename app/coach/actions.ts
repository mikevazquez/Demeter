"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getCoachContext } from "@/lib/auth/coach-context";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function setCoachAttendanceAction(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const reservationId = String(formData.get("reservation_id") ?? "");
  const status = String(formData.get("status") ?? "");

  if (
    !isUuid(sessionId) ||
    !isUuid(reservationId) ||
    (status !== "attended" && status !== "no_show")
  ) {
    redirect("/coach?error=access");
  }

  const { supabase } = await getCoachContext(CAPABILITIES.ATTENDANCE_WRITE);
  const { error } = await supabase.rpc("set_attendance_status", {
    target_reservation_id: reservationId,
    target_status: status,
    target_reason: null,
  });

  const rosterPath = `/coach/clases/${sessionId}/roster`;
  revalidatePath(rosterPath);
  revalidatePath(`/coach/clases/${sessionId}`);
  revalidatePath("/coach");

  if (error) redirect(`${rosterPath}?error=attendance`);
  redirect(`${rosterPath}?updated=1`);
}
