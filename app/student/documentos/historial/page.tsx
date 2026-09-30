import Link from "next/link";

import { documentTypeLabels } from "@/lib/documents";
import { getStudentPortalContext } from "@/lib/student/portal";

type HistoryItem = {
  acceptance_id: string;
  accepted_at: string;
  acceptor_kind: string;
  decision: string;
  method: string;
  guardian_name?: string | null;
  guardian_relationship?: string | null;
  version_id: string;
  document_id: string;
  version_number: number;
  document_name: string;
  document_type: string;
  file_name?: string | null;
  content_sha256?: string | null;
  invalidated?: boolean;
  invalidation_reason?: string | null;
  invalidated_at?: string | null;
};

export default async function StudentDocumentHistoryPage() {
  const { supabase, studio } = await getStudentPortalContext();
  const { data } = await supabase.rpc("student_document_history");
  const items = (data ?? []) as HistoryItem[];

  return (
    <main className="space-y-5 pb-6">
      <Link
        href="/student/documentos"
        className="text-sm font-semibold text-zinc-400 hover:text-white"
      >
        ← Mis documentos
      </Link>

      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
          Documentos · Historial
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">
          Aceptaciones anteriores
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
          Aquí puedes consultar la versión exacta que aceptaste y quién realizó cada aceptación.
        </p>
      </header>

      {items.length ? (
        <section className="space-y-3">
          {items.map((item) => (
            <Link
              key={item.acceptance_id}
              href={`/student/documentos/${item.version_id}`}
              className="block rounded-3xl border border-white/10 bg-[#0d0f16] p-5 transition hover:border-fuchsia-500/25"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-fuchsia-400/20 bg-fuchsia-400/[0.08] px-2.5 py-1 text-[10px] font-semibold text-fuchsia-200">
                      {documentTypeLabels[item.document_type] ?? item.document_type}
                    </span>
                    <span className="text-xs text-zinc-600">v{item.version_number}</span>
                  </div>
                  <h2 className="mt-3 text-lg font-semibold text-white">{item.document_name}</h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    {item.acceptor_kind === "guardian"
                      ? `Aceptó ${item.guardian_name ?? "responsable"}`
                      : "Aceptaste tú"}{" "}
                    ·{" "}
                    {new Intl.DateTimeFormat(studio.locale, {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: studio.timezone,
                    }).format(new Date(item.accepted_at))}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.invalidated ? "bg-rose-400/10 text-rose-200" : item.decision === "declined" ? "bg-amber-400/10 text-amber-200" : "bg-emerald-400/10 text-emerald-300"}`}
                >
                  {item.invalidated
                    ? "Invalidada"
                    : item.decision === "declined"
                      ? "No autorizado"
                      : "Aceptado"}
                </span>
              </div>
              {item.invalidated ? (
                <div className="mt-4 rounded-2xl border border-rose-400/15 bg-rose-400/[0.04] p-3 text-xs leading-5 text-rose-100/70">
                  {item.invalidation_reason || "Esta evidencia fue invalidada por el estudio."}
                </div>
              ) : null}
            </Link>
          ))}
        </section>
      ) : (
        <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-9 text-center">
          <p className="text-sm font-semibold text-white">Aún no hay aceptaciones registradas</p>
          <p className="mt-1 text-xs text-zinc-500">
            Cuando completes un documento aparecerá aquí.
          </p>
        </div>
      )}
    </main>
  );
}
