import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { ReservationPolicyForm } from "./ReservationPolicyForm";
import "./reservas-v2.css";

const errorCopy: Record<string, string> = {
  cutoff: "Revisa cuántas horas antes se puede cancelar sin penalización.",
  penalty: "Revisa los importes de penalización para ilimitados.",
  save: "No pudimos guardar los cambios.",
};

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

  return (
    <main className="reservations-v2">
      <header className="reservations-v2-header">
        <Link href="/admin/configuracion" className="reservations-v2-back">
          <span aria-hidden="true">←</span> Configuración
        </Link>
        <h1>Reservas</h1>
        <p>Configura cancelaciones, no-show y penalizaciones del estudio.</p>
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
    </main>
  );
}
