"use client";

import { useActionState } from "react";

import PendingActionButton from "@/app/admin/components/PendingActionButton";

import {
  addCoachExistingWalkinAction,
  createCoachWalkinAction,
  findCoachWalkinAction,
  type CoachWalkinLookupState,
} from "../../../actions";

const initialState: CoachWalkinLookupState = { status: "idle" };

export function CoachWalkinForm({ sessionId }: { sessionId: string }) {
  const [lookup, lookupAction, pending] = useActionState(findCoachWalkinAction, initialState);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-300">
          Alumna existente
        </p>
        <h2 className="mt-2 text-xl font-semibold text-white">Buscar por teléfono exacto</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Usa el teléfono en formato internacional. No se muestra ni permite navegar la base
          completa de alumnas.
        </p>

        <form action={lookupAction} className="mt-5 space-y-3">
          <input type="hidden" name="session_id" value={sessionId} />
          <label className="block text-sm font-medium text-zinc-300" htmlFor="walkin-phone-search">
            Teléfono E.164
          </label>
          <input
            id="walkin-phone-search"
            name="phone"
            type="tel"
            inputMode="tel"
            placeholder="+5213312345678"
            required
            className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white outline-none placeholder:text-zinc-600 focus:border-fuchsia-400/50"
          />
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl bg-fuchsia-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-fuchsia-500 disabled:cursor-wait disabled:opacity-60"
          >
            {pending ? "Buscando…" : "Buscar alumna"}
          </button>
        </form>

        {lookup.status === "invalid" ? (
          <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100">
            Ingresa un teléfono válido en formato E.164, por ejemplo +5213312345678.
          </p>
        ) : null}
        {lookup.status === "not_found" ? (
          <p className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-zinc-300">
            No encontramos una alumna activa con ese teléfono. Puedes usar el alta mínima de
            walk-in.
          </p>
        ) : null}
        {lookup.status === "already_in_roster" ? (
          <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100">
            {lookup.studentName ?? "La alumna"} ya está en el roster de esta clase.
          </p>
        ) : null}
        {lookup.status === "error" ? (
          <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-100">
            No pudimos completar la búsqueda. Intenta nuevamente.
          </p>
        ) : null}
        {lookup.status === "found" && lookup.studentId ? (
          <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200">
              Alumna encontrada
            </p>
            <p className="mt-1 font-semibold text-white">{lookup.studentName}</p>
            <p className="mt-2 text-sm leading-6 text-emerald-100/80">
              Al agregarla, Studio Flow usará su cobertura vigente si aplica. Sólo las excepciones
              comerciales ya aprobadas quedan pendientes y nunca se crea una compra automática.
            </p>
            <form action={addCoachExistingWalkinAction} className="mt-4">
              <input type="hidden" name="session_id" value={sessionId} />
              <input type="hidden" name="student_id" value={lookup.studentId} />
              <PendingActionButton
                pendingLabel="Agregando…"
                className="w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400"
              >
                Agregar a esta clase
              </PendingActionButton>
            </form>
          </div>
        ) : null}
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Alta mínima
        </p>
        <h2 className="mt-2 text-xl font-semibold text-white">Nueva alumna walk-in</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Crea únicamente la identidad mínima y la agrega a esta sesión. No genera venta, paquete ni
          compra automática.
        </p>

        <form action={createCoachWalkinAction} className="mt-5 space-y-4">
          <input type="hidden" name="session_id" value={sessionId} />
          <div>
            <label className="block text-sm font-medium text-zinc-300" htmlFor="walkin-first-name">
              Nombre
            </label>
            <input
              id="walkin-first-name"
              name="first_name"
              required
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white outline-none focus:border-fuchsia-400/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-300" htmlFor="walkin-last-name">
              Apellido opcional
            </label>
            <input
              id="walkin-last-name"
              name="last_name"
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white outline-none focus:border-fuchsia-400/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-300" htmlFor="walkin-phone-new">
              Teléfono E.164
            </label>
            <input
              id="walkin-phone-new"
              name="phone"
              type="tel"
              inputMode="tel"
              placeholder="+5213312345678"
              required
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white outline-none placeholder:text-zinc-600 focus:border-fuchsia-400/50"
            />
          </div>
          <PendingActionButton
            pendingLabel="Creando…"
            className="w-full rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/10 px-4 py-3 text-sm font-semibold text-fuchsia-100 transition hover:bg-fuchsia-500/20"
          >
            Crear y agregar a la clase
          </PendingActionButton>
        </form>
      </section>
    </div>
  );
}
