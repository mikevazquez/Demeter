import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import {
  BOOKING_WINDOW_DEFAULTS,
  bookingWindowValuesFromRow,
  type BookingWindowValues,
} from "@/lib/booking-windows";

import { BookingWindowsForm } from "./BookingWindowsForm";
import { PenaltyPolicyForm, type PenaltyPolicyValues } from "./PenaltyPolicyForm";
import { ReservationPolicyForm } from "./ReservationPolicyForm";
import "./reservas-v2.css";
import "../../components/booking-rules.css";

const errorCopy: Record<string, string> = {
  cutoff: "Revisa cuántas horas antes se puede cancelar sin penalización.",
  penalty: "Revisa los importes de penalización para ilimitados.",
  save: "No pudimos guardar los cambios.",
  window_close: "Revisa cuántos minutos antes se cierran las reservas (0 a 10,080).",
  window_open: "Revisa cuándo se abren las reservas: de 1 hora a 90 días antes, o un día y hora.",
  window_checkin: "Revisa los minutos del registro con QR (0 a 240).",
  window_cancel: "Revisa las horas para cancelar.",
  pause: "Revisa las pausas: de 1 a 20 eventos, en 1 a 365 días, por 1 a 90 días.",
};

function pickDefined(values: BookingWindowValues): Partial<BookingWindowValues> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== null),
  ) as Partial<BookingWindowValues>;
}

export default async function ReservationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const [params, ctx] = await Promise.all([
    searchParams,
    getAdminContext(CAPABILITIES.SETTINGS_WRITE),
  ]);

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  const { data: policy } = await ctx.supabase
    .from("studio_operating_policies")
    .select(
      "cancellation_cutoff_minutes,late_cancellation_consumes_credit,no_show_consumes_credit,unlimited_late_cancellation_penalty_minor,unlimited_no_show_penalty_minor",
    )
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  // NEB-01-39/40 · consulta aparte: si la migración aún no está aplicada, no rompe la página.
  const { data: windowRow, error: windowError } = await ctx.supabase
    .from("studio_operating_policies")
    .select(
      "booking_close_minutes_before,booking_open_mode,booking_open_minutes_before,booking_open_weekday,booking_open_time,checkin_opens_minutes_before,checkin_closes_minutes_after",
    )
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();
  const windowValues: BookingWindowValues | null = windowError
    ? null
    : { ...BOOKING_WINDOW_DEFAULTS, ...pickDefined(bookingWindowValuesFromRow(windowRow)) };

  // NEB-01-41 · consulta aparte: si la migración aún no está aplicada, no se muestra la sección.
  const { data: penaltyRow, error: penaltyError } = await ctx.supabase
    .from("studio_operating_policies")
    .select(
      "package_late_cancellation_penalty_minor,package_no_show_penalty_minor,pending_charge_blocks_booking,no_show_block_threshold,no_show_block_window_days,no_show_block_days,late_cancel_block_threshold,late_cancel_block_window_days,late_cancel_block_days",
    )
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();
  const penaltyValues: PenaltyPolicyValues | null = penaltyError
    ? null
    : {
        packageLateCancellationPenaltyMinor: penaltyRow?.package_late_cancellation_penalty_minor ?? 0,
        packageNoShowPenaltyMinor: penaltyRow?.package_no_show_penalty_minor ?? 0,
        pendingChargeBlocksBooking: penaltyRow?.pending_charge_blocks_booking ?? true,
        noShow: {
          threshold: penaltyRow?.no_show_block_threshold ?? null,
          windowDays: penaltyRow?.no_show_block_window_days ?? null,
          blockDays: penaltyRow?.no_show_block_days ?? null,
        },
        lateCancel: {
          threshold: penaltyRow?.late_cancel_block_threshold ?? null,
          windowDays: penaltyRow?.late_cancel_block_window_days ?? null,
          blockDays: penaltyRow?.late_cancel_block_days ?? null,
        },
      };

  return (
    <main className="reservations-v2">
      <header className="reservations-v2-header">
        <Link href="/admin/configuracion" className="reservations-v2-back">
          <span aria-hidden="true">←</span> Configuración
        </Link>
        <h1>Reservas</h1>
        <p>Configura cancelaciones, no-show, penalizaciones, apertura y cierre de reservas.</p>
      </header>

      {params.saved ? (
        <div className="reservations-v2-notice is-success">Cambios guardados correctamente.</div>
      ) : null}

      {params.error ? (
        <div className="reservations-v2-notice is-error">
          {errorCopy[params.error] ?? "No pudimos guardar los cambios."}
        </div>
      ) : null}

      <ReservationPolicyForm
        cancellationCutoffMinutes={policy?.cancellation_cutoff_minutes ?? 300}
        lateCancellationConsumesCredit={policy?.late_cancellation_consumes_credit ?? true}
        noShowConsumesCredit={policy?.no_show_consumes_credit ?? true}
        unlimitedLateCancellationPenaltyMinor={
          policy?.unlimited_late_cancellation_penalty_minor ?? 0
        }
        unlimitedNoShowPenaltyMinor={policy?.unlimited_no_show_penalty_minor ?? 0}
        currency={ctx.studio.currency}
      />

      {windowValues ? <BookingWindowsForm values={windowValues} /> : null}

      {penaltyValues ? (
        <PenaltyPolicyForm values={penaltyValues} currency={ctx.studio.currency} />
      ) : null}
    </main>
  );
}
