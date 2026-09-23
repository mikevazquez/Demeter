import Link from "next/link";
import { notFound } from "next/navigation";

import QueryNotice from "@/app/components/QueryNotice";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import {
  acceptancePartyLabels,
  audienceLabels,
  documentStatusLabels,
  enforcementLabels,
  formatFileSize,
  responseModeLabels,
} from "@/lib/documents";

import { createDocumentVersionAction, retireDocumentVersionAction } from "../actions";

export default async function DocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<{ published?: string; retired?: string; error?: string }>;
}) {
  const { documentId } = await params;
  const query = await searchParams;
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.DOCUMENTS_READ);

  const { data: document } = await supabase
    .from("studio_documents")
    .select("id,name,document_type,description,created_at")
    .eq("id", documentId)
    .eq("studio_id", studio.id)
    .maybeSingle();
  if (!document) notFound();

  const { data: versions } = await supabase
    .from("document_versions")
    .select("*")
    .eq("document_id", document.id)
    .eq("studio_id", studio.id)
    .order("version_number", { ascending: false });

  const current =
    (versions ?? []).find((item) => ["active", "scheduled"].includes(item.status)) ??
    versions?.[0] ??
    null;

  if (!current) notFound();

  const [{ data: trackingData }, { data: incidents }] = await Promise.all([
    supabase.rpc("admin_document_tracking", { p_version_id: current.id }),
    supabase
      .from("document_incidents")
      .select("id,incident_type,status,reason,created_at")
      .eq("studio_id", studio.id)
      .eq("version_id", current.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const tracking = (trackingData ?? []) as Array<{
    satisfied?: boolean;
    blocks_booking?: boolean;
    guardian_completed?: boolean;
  }>;
  const accepted = tracking.filter((item) => item.satisfied).length;
  const pending = tracking.length - accepted;
  const blocked = tracking.filter((item) => item.blocks_booking).length;
  const percent = tracking.length ? Math.round((accepted / tracking.length) * 100) : 0;

  let signedUrl: string | null = null;
  if (current.file_path) {
    const { data } = await supabase.storage
      .from("studio-documents")
      .createSignedUrl(current.file_path, 60 * 15);
    signedUrl = data?.signedUrl ?? null;
  }

  return (
    <main className="dashboard-shell space-y-5">
      <Link
        href="/admin/documentos"
        className="text-sm font-semibold text-zinc-400 hover:text-white"
      >
        ← Documentos
      </Link>

      {query.published ? (
        <QueryNotice
          eyebrow="Documentos"
          title="Versión publicada"
          message="La versión quedó publicada correctamente y las reglas de elegibilidad ya pueden aplicarse."
          tone="success"
        />
      ) : null}
      {query.retired ? (
        <QueryNotice
          eyebrow="Documentos"
          title="Versión retirada"
          message="La versión dejó de generar requisitos nuevos y su historial se conserva."
          tone="success"
        />
      ) : null}
      {query.error ? (
        <QueryNotice
          eyebrow="Documentos"
          title="No pudimos completar la acción"
          message="Revisa el estado del documento e inténtalo nuevamente."
          tone="error"
        />
      ) : null}

      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="dashboard-title">{document.name}</h1>
            <span className="rounded-full border border-fuchsia-400/25 bg-fuchsia-400/[0.08] px-3 py-1 text-xs font-semibold text-fuchsia-200">
              {documentStatusLabels[current.status] ?? current.status}
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            {document.description || "Documento del estudio."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {current.status === "draft" ? (
            <Link
              href={`/admin/documentos/${document.id}/editar`}
              className="rounded-2xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white"
            >
              Continuar borrador
            </Link>
          ) : can(CAPABILITIES.DOCUMENTS_MANAGE) ? (
            <form action={createDocumentVersionAction}>
              <input type="hidden" name="document_id" value={document.id} />
              <button className="rounded-2xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white">
                Crear nueva versión
              </button>
            </form>
          ) : null}
        </div>
      </header>

      <nav className="flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-white/[0.025] p-2 text-sm">
        <span className="rounded-xl bg-fuchsia-600/20 px-4 py-2 font-semibold text-fuchsia-200">
          Resumen
        </span>
        <Link
          href={`/admin/documentos/${document.id}/versiones`}
          className="rounded-xl px-4 py-2 text-zinc-400 hover:text-white"
        >
          Versiones
        </Link>
        <Link
          href="/admin/documentos/incidencias"
          className="rounded-xl px-4 py-2 text-zinc-400 hover:text-white"
        >
          Incidencias
        </Link>
      </nav>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-3xl border border-white/10 bg-[#0d0f16] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
            Estado actual
          </p>
          <p className="mt-3 text-2xl font-semibold text-white">v{current.version_number}</p>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-zinc-500">Respuesta</dt>
              <dd className="mt-1 text-zinc-200">{responseModeLabels[current.response_mode]}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Aceptante</dt>
              <dd className="mt-1 text-zinc-200">
                {acceptancePartyLabels[current.acceptance_party]}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Aplicación</dt>
              <dd className="mt-1 text-zinc-200">{audienceLabels[current.audience_scope]}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Exigencia</dt>
              <dd className="mt-1 text-zinc-200">{enforcementLabels[current.enforcement_scope]}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-3xl border border-emerald-400/20 bg-[#0d0f16] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">
            Aceptación
          </p>
          <p className="mt-3 text-4xl font-semibold text-white">{percent}%</p>
          <p className="mt-1 text-sm text-zinc-500">
            {accepted} de {tracking.length} completadas
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <strong className="text-lg text-white">{accepted}</strong>
              <p className="text-xs text-zinc-500">Aceptadas</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <strong className="text-lg text-white">{pending}</strong>
              <p className="text-xs text-zinc-500">Pendientes</p>
            </div>
          </div>
          <p className="mt-4 text-xs leading-5 text-zinc-500">
            El detalle por persona se consulta desde el perfil de cada alumna.
          </p>
        </div>

        <div className="rounded-3xl border border-fuchsia-400/20 bg-[#0d0f16] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
            Elegibilidad
          </p>
          <p className="mt-3 text-4xl font-semibold text-white">{blocked}</p>
          <p className="mt-1 text-sm text-zinc-500">personas restringidas por esta versión</p>
          <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.05] p-4 text-xs leading-5 text-cyan-100/70">
            Las reservas existentes permanecen intactas.
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_.8fr]">
        <div className="rounded-3xl border border-white/10 bg-[#0d0f16] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
            Archivo actual
          </p>
          <h2 className="mt-3 text-lg font-semibold text-white">
            {current.file_name || "Sin archivo"}
          </h2>
          <p className="mt-1 text-xs text-zinc-500">{formatFileSize(current.file_size_bytes)}</p>
          {signedUrl ? (
            <a
              href={signedUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white"
            >
              Ver documento
            </a>
          ) : null}
        </div>

        <div className="rounded-3xl border border-white/10 bg-[#0d0f16] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
            Incidencias recientes
          </p>
          <div className="mt-3 space-y-2">
            {(incidents ?? []).length ? (
              incidents?.map((item) => (
                <div key={item.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm text-white">
                      {item.incident_type.replaceAll("_", " ")}
                    </strong>
                    <span className="text-xs text-zinc-500">{item.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{item.reason}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-zinc-500">Sin incidencias en esta versión.</p>
            )}
          </div>
        </div>
      </section>

      {can(CAPABILITIES.DOCUMENTS_MANAGE) &&
      current.status !== "draft" &&
      current.status !== "retired" ? (
        <form
          action={retireDocumentVersionAction}
          className="rounded-3xl border border-rose-400/15 bg-rose-400/[0.025] p-5"
        >
          <input type="hidden" name="document_id" value={document.id} />
          <input type="hidden" name="version_id" value={current.id} />
          <label className="block max-w-xl">
            <span className="mb-2 block text-sm font-semibold text-white">Retirar versión</span>
            <input
              name="reason"
              placeholder="Motivo administrativo"
              className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white"
            />
          </label>
          <button className="mt-3 rounded-xl border border-rose-400/25 px-4 py-2 text-sm font-semibold text-rose-200">
            Retirar sin borrar historial
          </button>
        </form>
      ) : null}
    </main>
  );
}
