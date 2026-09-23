import Link from "next/link";

import {
  documentTypeLabels,
  type BookingRestriction,
  type DocumentCenterItem,
} from "@/lib/documents";
import { getStudentPortalContext } from "@/lib/student/portal";

export default async function StudentDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const query = await searchParams;
  const { supabase } = await getStudentPortalContext();
  const { data, error } = await supabase.rpc("student_document_center");

  const center = (data ?? {}) as {
    student_id?: string;
    is_minor?: boolean | null;
    items?: DocumentCenterItem[];
    booking_blockers?: BookingRestriction[];
  };
  const items = center.items ?? [];
  const blockers = center.booking_blockers ?? [];
  const pending = items.filter((item) => !item.satisfied);
  const completed = items.filter((item) => item.satisfied);

  return (
    <main className="space-y-5 pb-6">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
          Portal alumna · Documentos
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">Mis documentos</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
          Revisa los documentos que tu estudio necesita y conserva el historial exacto de lo que ya
          completaste.
        </p>
      </header>

      {query.error || error ? (
        <div className="rounded-3xl border border-rose-500/25 bg-rose-500/[0.07] p-4 text-sm text-rose-100">
          No pudimos cargar todos tus documentos. Intenta nuevamente.
        </div>
      ) : null}

      {blockers.length ? (
        <section className="rounded-3xl border border-fuchsia-500/30 bg-[radial-gradient(circle_at_90%_0%,rgba(217,70,239,.16),transparent_40%),#0d0f16] p-5 shadow-[0_0_30px_rgba(217,70,239,.08)]">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-fuchsia-400/25 bg-fuchsia-400/[0.08] text-fuchsia-200">
              !
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-fuchsia-300">
                Acción requerida
              </p>
              <h2 className="mt-1 text-lg font-semibold text-white">
                Tienes {blockers.length} requisito{blockers.length === 1 ? "" : "s"} pendiente
                {blockers.length === 1 ? "" : "s"}
              </h2>
              <p className="mt-1 text-sm leading-6 text-zinc-400">
                Hasta resolverlos, algunas acciones —como nuevas reservas— pueden estar restringidas.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.05] p-5">
          <p className="text-sm font-semibold text-emerald-200">Tus documentos están al día.</p>
          <p className="mt-1 text-xs leading-5 text-emerald-100/65">
            No tienes requisitos documentales pendientes en este momento.
          </p>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ["Pendientes", pending.length],
          ["Completados", completed.length],
          ["Total", items.length],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-2xl font-semibold text-white">{value}</p>
            <p className="mt-1 text-xs text-zinc-500">{label}</p>
          </div>
        ))}
      </section>

      {pending.length ? (
        <section className="space-y-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Requieren tu atención
            </p>
            <h2 className="mt-1 text-lg font-semibold text-white">Pendientes</h2>
          </div>

          {pending.map((item) => {
            const guardianPending =
              item.minor === true &&
              ["guardian_if_minor", "student_and_guardian", "guardian_only"].includes(
                item.acceptance_party,
              ) &&
              !item.guardian_completed;
            const studentPending =
              ["student", "student_and_guardian"].includes(item.acceptance_party) &&
              !item.student_completed;

            return (
              <article
                key={item.version_id}
                className="rounded-3xl border border-fuchsia-500/20 bg-[#0d0f16] p-5"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-fuchsia-400/20 bg-fuchsia-400/[0.08] px-2.5 py-1 text-[10px] font-semibold text-fuchsia-200">
                        {documentTypeLabels[item.document_type] ?? item.document_type}
                      </span>
                      <span className="text-xs text-zinc-600">v{item.version_number}</span>
                    </div>
                    <h3 className="mt-3 text-lg font-semibold text-white">{item.name}</h3>
                    <p className="mt-1 text-sm leading-6 text-zinc-400">
                      {item.description || "Revisa este documento para continuar."}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      {studentPending ? (
                        <span className="rounded-full border border-amber-400/20 bg-amber-400/[0.06] px-2.5 py-1 text-amber-200">
                          Falta tu aceptación
                        </span>
                      ) : null}
                      {guardianPending ? (
                        <span className="rounded-full border border-cyan-400/20 bg-cyan-400/[0.06] px-2.5 py-1 text-cyan-200">
                          Falta responsable
                        </span>
                      ) : null}
                      {item.blocks_booking ? (
                        <span className="rounded-full border border-rose-400/20 bg-rose-400/[0.06] px-2.5 py-1 text-rose-200">
                          Requerido para reservar
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {studentPending ? (
                      <Link
                        href={`/student/documentos/${item.version_id}`}
                        className="rounded-2xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white"
                      >
                        Revisar
                      </Link>
                    ) : null}
                    {guardianPending ? (
                      <Link
                        href="/student/documentos/responsable"
                        className="rounded-2xl border border-cyan-400/25 px-4 py-2.5 text-sm font-semibold text-cyan-200"
                      >
                        Responsable
                      </Link>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      <section className="space-y-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Historial
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">Documentos completados</h2>
        </div>

        {completed.length ? (
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#0d0f16]">
            <div className="divide-y divide-white/10">
              {completed.map((item) => (
                <Link
                  key={item.version_id}
                  href={`/student/documentos/${item.version_id}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-white/[0.025]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{item.name}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {documentTypeLabels[item.document_type] ?? item.document_type} · v
                      {item.version_number}
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                    Completado
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-7 text-center text-sm text-zinc-500">
            Tus documentos completados aparecerán aquí.
          </div>
        )}
      </section>
    </main>
  );
}
