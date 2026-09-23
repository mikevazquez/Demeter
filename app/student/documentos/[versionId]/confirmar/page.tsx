import Link from "next/link";
import { notFound } from "next/navigation";

import {
  acceptancePartyLabels,
  documentTypeLabels,
} from "@/lib/documents";
import { getStudentPortalContext } from "@/lib/student/portal";

import { acceptStudentDocumentAction } from "../../actions";

type Detail = {
  id: string;
  document_name: string;
  document_type: string;
  version_number: number;
  response_mode: string;
  acceptance_party: string;
  affirmation_text: string | null;
  satisfied: boolean;
  student_completed: boolean;
  minor: boolean | null;
};

export default async function StudentDocumentConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ versionId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { versionId } = await params;
  const query = await searchParams;
  const { supabase, snapshot } = await getStudentPortalContext();
  const { data, error } = await supabase.rpc("student_document_detail", {
    p_version_id: versionId,
  });

  if (error || !data) notFound();
  const detail = data as Detail;

  const studentMayAct =
    detail.response_mode !== "informational" &&
    !detail.student_completed &&
    (detail.acceptance_party === "student" ||
      detail.acceptance_party === "student_and_guardian" ||
      (detail.acceptance_party === "guardian_if_minor" && detail.minor === false));

  if (detail.satisfied || !studentMayAct) notFound();

  return (
    <main className="mx-auto max-w-2xl space-y-5 pb-6">
      <Link
        href={`/student/documentos/${detail.id}`}
        className="text-sm font-semibold text-zinc-400 hover:text-white"
      >
        ← Volver al documento
      </Link>

      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
          Confirmación de aceptación
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">{detail.document_name}</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Esta acción queda asociada a tu cuenta y a esta versión exacta del documento.
        </p>
      </header>

      {query.error ? (
        <div className="rounded-3xl border border-rose-500/25 bg-rose-500/[0.07] p-4 text-sm text-rose-100">
          No pudimos registrar tu respuesta. Revisa la información e inténtalo otra vez.
        </div>
      ) : null}

      <section className="rounded-3xl border border-fuchsia-500/20 bg-[#0d0f16] p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-fuchsia-400/20 bg-fuchsia-400/[0.08] px-2.5 py-1 text-[10px] font-semibold text-fuchsia-200">
            {documentTypeLabels[detail.document_type] ?? detail.document_type}
          </span>
          <span className="text-xs text-zinc-600">v{detail.version_number}</span>
        </div>

        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <dt className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">Persona</dt>
            <dd className="mt-1 text-sm font-semibold text-white">{snapshot.profile.full_name}</dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <dt className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">Rol</dt>
            <dd className="mt-1 text-sm font-semibold text-white">
              {acceptancePartyLabels[detail.acceptance_party] ?? detail.acceptance_party}
            </dd>
          </div>
        </dl>

        <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-600">
            Declaración
          </p>
          <p className="mt-2 text-sm leading-6 text-zinc-300">
            {detail.affirmation_text || "He leído y acepto el contenido de este documento."}
          </p>
        </div>

        <form action={acceptStudentDocumentAction} className="mt-5">
          <input type="hidden" name="version_id" value={detail.id} />
          <input type="hidden" name="decision" value="accepted" />
          <label className="flex items-start gap-3 rounded-2xl border border-fuchsia-400/20 bg-fuchsia-400/[0.05] p-4 text-sm leading-6 text-zinc-300">
            <input
              type="checkbox"
              name="confirmation"
              value="true"
              required
              className="mt-1 accent-fuchsia-500"
            />
            Confirmo que leí el documento completo y que esta aceptación corresponde a mi decisión.
          </label>
          <button className="mt-4 w-full rounded-2xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_0_24px_rgba(217,70,239,.2)]">
            Aceptar documento
          </button>
        </form>
      </section>
    </main>
  );
}
