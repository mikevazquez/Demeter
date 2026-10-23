import PendingActionButton from "@/app/admin/components/PendingActionButton";

import { resolveStudentChargeAction, waiveStudentPenaltyAction } from "./penalty-actions";

export type StudentPenaltyRow = {
  id: string;
  kind: string;
  events_count: number;
  window_days: number;
  ends_at: string;
};

export type PendingChargeRow = {
  id: string;
  charge_type: string;
  amount_minor: number;
  currency: string | null;
};

const NOTICES: Record<string, string> = {
  pausa_quitada: "Pausa quitada. La alumna ya puede reservar.",
  cargo_pagado: "Cargo marcado como pagado.",
  cargo_condonado: "Cargo condonado.",
  error: "No se pudo guardar. Intenta de nuevo.",
};

// NEB-01-41 · Pausa de reservas vigente y cargos pendientes, con acciones para recepción.
export default function StudentPenaltiesPanel({
  studentId,
  penalties,
  pendingCharges,
  canWaive,
  canResolveCharges,
  timeZone,
  locale,
  currency,
  notice,
}: {
  studentId: string;
  penalties: StudentPenaltyRow[];
  pendingCharges: PendingChargeRow[];
  canWaive: boolean;
  canResolveCharges: boolean;
  timeZone: string;
  locale: string;
  currency: string;
  notice?: string;
}) {
  if (!penalties.length && !pendingCharges.length && !notice) return null;
  const dateLabel = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  return (
    <div className="profile360-package-group" id="penalizaciones">
      <div className="profile360-package-group-heading">
        <strong>Reservas en pausa y adeudos</strong>
        <span>{penalties.length + pendingCharges.length} pendientes</span>
      </div>
      {notice && NOTICES[notice] ? (
        <p className="text-xs text-zinc-300" role="status">
          {NOTICES[notice]}
        </p>
      ) : null}
      <div className="grid gap-3">
        {penalties.map((penalty) => (
          <article
            key={penalty.id}
            className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-4"
          >
            <strong className="text-sm text-white">
              No puede reservar hasta {dateLabel(penalty.ends_at)}
            </strong>
            <p className="mt-1 text-xs text-zinc-400">
              {penalty.events_count}{" "}
              {penalty.kind === "no_show" ? "faltas" : "cancelaciones tardías"} en{" "}
              {penalty.window_days} días.
            </p>
            {canWaive ? (
              <form action={waiveStudentPenaltyAction} className="mt-3 grid gap-2">
                <input type="hidden" name="student_id" value={studentId} />
                <input type="hidden" name="penalty_id" value={penalty.id} />
                <input
                  name="note"
                  maxLength={300}
                  placeholder="Motivo (opcional)"
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                />
                <PendingActionButton className="secondary-button" pendingLabel="Quitando…">
                  Quitar pausa
                </PendingActionButton>
              </form>
            ) : null}
          </article>
        ))}
        {pendingCharges.map((charge) => (
          <article
            key={charge.id}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
          >
            <strong className="text-sm text-white">
              {charge.charge_type === "late_cancellation" ? "Cancelación tardía" : "Falta"} ·{" "}
              {new Intl.NumberFormat(locale, {
                style: "currency",
                currency: charge.currency ?? currency,
              }).format(Number(charge.amount_minor ?? 0) / 100)}
            </strong>
            <p className="mt-1 text-xs text-zinc-400">
              Mientras esté pendiente, la alumna no puede reservar en línea.
            </p>
            {canResolveCharges ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <form action={resolveStudentChargeAction}>
                  <input type="hidden" name="student_id" value={studentId} />
                  <input type="hidden" name="charge_id" value={charge.id} />
                  <input type="hidden" name="resolution" value="paid" />
                  <PendingActionButton className="primary-button" pendingLabel="Guardando…">
                    Marcar pagado
                  </PendingActionButton>
                </form>
                <form action={resolveStudentChargeAction}>
                  <input type="hidden" name="student_id" value={studentId} />
                  <input type="hidden" name="charge_id" value={charge.id} />
                  <input type="hidden" name="resolution" value="waived" />
                  <PendingActionButton className="secondary-button" pendingLabel="Guardando…">
                    Condonar
                  </PendingActionButton>
                </form>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
