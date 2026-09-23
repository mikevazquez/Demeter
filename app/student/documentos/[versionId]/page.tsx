import Link from "next/link";
import { notFound } from "next/navigation";

import {
  acceptancePartyLabels,
  documentTypeLabels,
  formatFileSize,
  responseModeLabels,
  safeReservationReturnTo,
} from "@/lib/documents";
import { getStudentPortalContext } from "@/lib/student/portal";

type Detail = {
  id: string;
  document_id: string;
  document_name: string;
  document_type: string;
  description: string | null;
  version_number: number;
  response_mode: string;
  acceptance_party: string;
  enforcement_scope: string;
  effective_at: string | null;
  file_path: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  affirmation_text: string | null;
  satisfied: boolean;
  student_completed: boolean;
  guardian_completed: boolean;
  minor: boolean | null;
  historical_access?: boolean;
};

export default async function StudentDocumentReadPage({
  params,
  searchParams,
}: {
  params: Promise<{ versionId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { versionId } = await params;
  const query = await searchParams;
  const returnTo = safeReservationReturnTo(query.returnTo);
  const { supabase, studio } = await getStudentPortalContext();
  const { data, error } = await supabase.rpc("student_document_detail", {
    p_version_id: versionId,
  });

  if (error || !data) notFound();
  const detail = data as Detail;

  let signedUrl: string | null = null;
  if (detail.file_path) {
    const { data: signed } = await supabase.storage
      .from("studio-documents")
      .createSignedUrl(detail.file_path, 60 * 20);
    signedUrl = signed?.signedUrl ?? null;
  }

  const studentPartyAllowed =
    detail.acceptance_party === "student" ||
    detail.acceptance_party === "student_and_guardian" ||
    (detail.acceptance_party === "guardian_if_minor" && detail.minor === false);

  const canChangeOptionalDecision =
    detail.response_mode === "decision_optional" && studentPartyAllowed;

  const studentMayAct =
    detail.response_mode !== "informational" &&
    studentPartyAllowed &&
    (canChangeOptionalDecision || !detail.student_completed);

  const guardianRequired =
    detail.minor === true &&
    ["guardian_if_minor", "student_and_guardian", "guardian_only"].includes(
      detail.acceptance_party,
    ) &&
    !detail.guardian_completed;

  return (
    <main className="space-y-5 pb-6">
      <Link
        href={returnTo || "/student/documentos"}
        className="text-sm font-semibold text-zinc-400 hover:text-white"
      >
        {returnTo ? "← Volver a reservar" : "← Mis documentos"}
      </Link>

      <header>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-fuchsia-400/20 bg-fuchsia-400/[0.08] px-2.5 py-1 text-[10px] font-semibold text-fuchsia-200">
            {documentTypeLabels[detail.document_type] ?? detail.document_type}
          </span>
          <span className="text-xs text-zinc-600">Versión {detail.version_number}</span>
        </div>
        <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
          {detail.document_name}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
          {detail.description || "Lee el documento completo antes de continuar."}
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[10px] uppercase tracking-[0.15em] text-zinc-600">Versión</p>
          <p className="mt-1 text-sm font-semibold text-white">v{detail.version_number}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[10px] uppercase tracking-[0.15em] text-zinc-600">Respuesta</p>
          <p className="mt-1 text-sm font-semibold text-white">
            {responseModeLabels[detail.response_mode] ?? detail.response_mode}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[10px] uppercase tracking-[0.15em] text-zinc-600">Aceptante</p>
          <p className="mt-1 text-sm font-semibold text-white">
            {acceptancePartyLabels[detail.acceptance_party] ?? detail.acceptance_party}
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-fuchsia-500/20 bg-[#0d0f16]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-white">
              {detail.file_name || detail.document_name}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              PDF privado · {formatFileSize(detail.file_size_bytes)}
            </p>
          </div>
          {signedUrl ? (
            <a
              href={signedUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold text-white"
            >
              Abrir PDF
            </a>
          ) : null}
        </div>
        {signedUrl ? (
          <iframe
            title={detail.document_name}
            src={signedUrl}
            className="h-[65vh] min-h-[520px] w-full bg-white"
          />
        ) : (
          <div className="px-5 py-16 text-center text-sm text-zinc-500">
            No pudimos abrir el archivo. Comunícate con tu estudio.
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-white/10 bg-[#0d0f16] p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
          Estado
        </p>

        {detail.satisfied ? (
          <>
            <div className="mt-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4">
              <p className="text-sm font-semibold text-emerald-200">
                Este requisito ya está completado.
              </p>
              <p className="mt-1 text-xs leading-5 text-emerald-100/65">
                {canChangeOptionalDecision
                  ? "Puedes cambiar tu decisión cuando lo necesites; cada cambio quedará registrado en el historial."
                  : "Puedes consultar esta versión nuevamente desde tu historial."}
              </p>
            </div>
            {canChangeOptionalDecision ? (
              <Link
                href={
                  returnTo
                    ? `/student/documentos/${detail.id}/confirmar?returnTo=${encodeURIComponent(returnTo)}`
                    : `/student/documentos/${detail.id}/confirmar`
                }
                className="mt-4 inline-flex w-full justify-center rounded-2xl border border-fuchsia-400/25 bg-fuchsia-400/[0.05] px-5 py-3 text-sm font-semibold text-fuchsia-100"
              >
                Cambiar decisión
              </Link>
            ) : null}
          </>
        ) : (
          <>
            {guardianRequired ? (
              <div className="mt-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.05] p-4">
                <p className="text-sm font-semibold text-cyan-200">
                  Tu responsable también debe completar este documento.
                </p>
                <p className="mt-1 text-xs leading-5 text-cyan-100/65">
                  Tu propia aceptación no sustituye la autorización del responsable cuando ésta es
                  requerida.
                </p>
                <Link
                  href={
                    returnTo
                      ? `/student/documentos/responsable?returnTo=${encodeURIComponent(returnTo)}`
                      : "/student/documentos/responsable"
                  }
                  className="mt-3 inline-flex rounded-xl border border-cyan-400/25 px-3 py-2 text-xs font-semibold text-cyan-200"
                >
                  Gestionar responsable
                </Link>
              </div>
            ) : null}

            {studentMayAct ? (
              <Link
                href={
                  returnTo
                    ? `/student/documentos/${detail.id}/confirmar?returnTo=${encodeURIComponent(returnTo)}`
                    : `/student/documentos/${detail.id}/confirmar`
                }
                className="mt-4 inline-flex w-full justify-center rounded-2xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_0_24px_rgba(217,70,239,.2)]"
              >
                Continuar a la confirmación
              </Link>
            ) : null}
          </>
        )}
      </section>

      <p className="text-center text-[11px] leading-5 text-zinc-600">
        Vigente desde{" "}
        {detail.effective_at
          ? new Intl.DateTimeFormat("es-MX", {
              dateStyle: "medium",
              timeZone: studio.timezone,
            }).format(new Date(detail.effective_at))
          : "la fecha de publicación"}
        .
      </p>
    </main>
  );
}
