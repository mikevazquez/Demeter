"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { parseBookingWindowForm } from "@/lib/booking-windows";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// NEB-01-38/39/40 · Reglas propias de una actividad. Vacío = usa la regla del estudio.
export async function saveActivityBookingRulesAction(formData: FormData) {
  const activityId = String(formData.get("activity_id") ?? "");
  if (!UUID.test(activityId)) redirect("/admin/actividades");
  const back = (state: string) => `/admin/actividades/${activityId}?reglas=${state}#reglas-reserva`;

  const ctx = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const parsed = parseBookingWindowForm(formData, "activity");
  if (!parsed.ok) redirect(back(`error_${parsed.error}`));
  const values = parsed.values;

  const { error } = await ctx.supabase.rpc("admin_update_activity_booking_rules", {
    p_template_id: activityId,
    p_cancellation_cutoff_minutes: values.cancellationCutoffMinutes,
    p_booking_close_minutes_before: values.bookingCloseMinutesBefore,
    p_booking_open_mode: values.bookingOpenMode,
    p_booking_open_minutes_before: values.bookingOpenMinutesBefore,
    p_booking_open_weekday: values.bookingOpenWeekday,
    p_booking_open_time: values.bookingOpenTime,
    p_checkin_opens_minutes_before: values.checkinOpensMinutesBefore,
    p_checkin_closes_minutes_after: values.checkinClosesMinutesAfter,
  });
  if (error) {
    console.error("[activities.booking_rules] update failed", {
      code: error.code,
      message: error.message.slice(0, 160),
    });
    redirect(back("error_save"));
  }

  revalidatePath(`/admin/actividades/${activityId}`);
  redirect(back("guardado"));
}
