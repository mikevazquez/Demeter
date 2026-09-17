import Link from "next/link";
import { notFound } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getCoachContext } from "@/lib/auth/coach-context";
import { type CoachSessionDetail } from "@/lib/coach/portal";

import { CoachWalkinForm } from "./walk-in-form";

export default async function CoachWalkinPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { sessionId } = await params;
  const query = await searchParams;
  const { supabase, studio } = await getCoachContext(CAPABILITIES.ATTENDANCE_WRITE);
  const { data, error } = await supabase.rpc("coach_session_detail", {
    target_studio_id: studio.id,
    target_session_id: sessionId,
  });

  if (error || !data) notFound();

  const detail = data as CoachSessionDetail;
  const occupied = Number(detail.reserved_count);
  const full = occupied >= detail.capacity;
  const open = detail.status === "scheduled" && !full;

  return (
    <main className="space-y-6">
      <Link
        href={`/coach/clases/${sessionId}/roster`}
        className="inline-flex text-sm font-semibold text-zinc-400 hover:text-white"
      >
        ← Volver al roster
      </Link>

      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300">Walk-in</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Agregar alumna</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
          Agrega una alumna existente mediante teléfono exacto o registra una identidad mínima para
          esta clase. Ninguna opción crea una compra automática.
        </p>
      </section>

      {query.error ? (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {query.error === "phone_exists"
            ? "Ese teléfono ya pertenece a una alumna. Usa la búsqueda de alumna existente."
            : query.error === "invalid"
              ? "Revisa nombre y teléfono. El teléfono debe estar en formato E.164."
              : "No pudimos agregar la alumna. La clase no fue modificada."}
        </div>
      ) : null}

      {!open ? (
        <section className="rounded-3xl border border-amber-400/20 bg-amber-400/10 p-6 text-amber-100">
          <h2 className="font-semibold">
            {detail.status !== "scheduled"
              ? "La clase ya no admite walk-ins"
              : "La clase está llena"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-amber-100/80">
            Regresa al roster para revisar el estado actual de la sesión.
          </p>
        </section>
      ) : (
        <CoachWalkinForm sessionId={sessionId} />
      )}
    </main>
  );
}
