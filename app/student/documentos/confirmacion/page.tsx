import Link from "next/link";
import { notFound } from "next/navigation";

import { getStudentPortalContext } from "@/lib/student/portal";

export default async function StudentDocumentConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ version?: string; acceptance?: string }>;
}) {
  const query = await searchParams;
  if (!query.version || !query.acceptance) notFound();

  const { supabase } = await getStudentPortalContext();
  const [{ data: detail }, { data: acceptance }] = await Promise.all([
    supabase.rpc("student_document_detail", { p_version_id: query.version }),
    supabase
      .from("document_acceptances")
      .select("id,accepted_at,decision,acceptor_kind,method")
      .eq("id", query.acceptance)
      .maybeSingle(),
  ]);

  if (!detail || !acceptance) notFound();
  const document = detail as {
    document_name: string;
    version_number: number;
    satisfied: boolean;
    guardian_completed: boolean;
    student_completed: boolean;
    acceptance_party: string;
  };

  return (
    <main className="mx-auto max-w-2xl space-y-5 pb-8">
      <section className="rounded-[32px] border border-emerald-400/25 bg-[radial-gradient(circle_at_50%_0%,rgba(52,211,153,.12),transparent_42%),#0d0f16] p-7 text-center shadow-[0_0_32px_rgba(52,211,153,.07)]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-emerald-400/25 bg-emerald-400/[0.08] text-2xl text-emerald-300">
          ✓
        </div>
        <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-300">
          Aceptación registrada
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-white">{document.document_name}</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Guardamos tu respuesta vinculada a la versión {document.version_number}. Esta evidencia no
          se modifica aunque el estudio publique una versión nueva después.
        </p>

        <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4 text-left">
          <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">Estado actual</p>
          <p className="mt-1 text-sm font-semibold text-white">
            {document.satisfied
              ? "Requisito completado"
              : document.acceptance_party === "student_and_guardian" && !document.guardian_completed
                ? "Tu parte está completa · falta tu responsable"
                : "Aceptación guardada"}
          </p>
        </div>

        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <Link
            href="/student/documentos"
            className="rounded-2xl bg-fuchsia-600 px-4 py-3 text-sm font-semibold text-white"
          >
            Volver a documentos
          </Link>
          <Link
            href="/student/documentos/historial"
            className="rounded-2xl border border-white/15 px-4 py-3 text-sm font-semibold text-white"
          >
            Ver historial
          </Link>
        </div>
      </section>
    </main>
  );
}
