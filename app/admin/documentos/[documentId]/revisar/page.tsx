import Link from "next/link";
import { notFound } from "next/navigation";

import QueryNotice from "@/app/components/QueryNotice";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import {
  acceptancePartyLabels,
  audienceLabels,
  enforcementLabels,
  formatFileSize,
  responseModeLabels,
} from "@/lib/documents";

import { publishDocumentAction } from "../../actions";

export default async function ReviewDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { documentId } = await params;
  const query = await searchParams;
  const { supabase, studio } = await getAdminContext(CAPABILITIES.DOCUMENTS_MANAGE);

  const [{ data: document }, { data: version }] = await Promise.all([
    supabase
      .from("studio_documents")
      .select("id,name,document_type,description")
      .eq("id", documentId)
      .eq("studio_id", studio.id)
      .maybeSingle(),
    supabase
      .from("document_versions")
      .select("*")
      .eq("document_id", documentId)
      .eq("studio_id", studio.id)
      .eq("status", "draft")
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!document || !version) notFound();

  const { data: impactData } = await supabase.rpc("admin_document_publish_impact", {
    p_version_id: version.id,
  });
  const impact = (impactData ?? {}) as {
    total?: number;
    completed?: number;
    pending?: number;
    minors?: number;
    guardian_pending?: number;
    booking_blocked?: number;
  };

  return (
    <main className="dashboard-shell space-y-5">
      <Link
        href={`/admin/documentos/${document.id}/editar`}
        className="text-sm font-semibold text-zinc-400 hover:text-white"
      >
        ← Volver a editar
      </Link>

      <header>
        <p className="eyebrow">DOCUMENTOS · REVISIÓN</p>
        <h1 className="dashboard-title">Revisión y publicación</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Confirma el contenido, el alcance y el efecto real antes de generar requisitos.
        </p>
      </header>

      {query.error ? (
        <QueryNotice
          eyebrow="Documentos"
          title="No pudimos publicar esta versión"
          message={
            query.error === "file_required"
              ? "Carga el PDF del documento antes de publicarlo."
              : "Revisa la configuración e inténtalo nuevamente."
          }
          tone="error"
        />
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
        <div className="space-y-4">
          <section className="rounded-3xl border border-fuchsia-500/20 bg-[#0d0f16] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
              1 · Documento
            </p>
            <h2 className="mt-3 text-xl font-semibold text-white">{document.name}</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Versión {version.version_number} · {document.description || "Sin descripción"}
            </p>
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-300">
              {version.file_name ? (
                <>
                  <strong className="text-white">{version.file_name}</strong>
                  <p className="mt-1 text-xs text-zinc-500">
                    {version.mime_type ?? "PDF"} · {formatFileSize(version.file_size_bytes)}
                  </p>
                </>
              ) : (
                <span className="text-amber-300">Aún no hay PDF cargado.</span>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-fuchsia-500/20 bg-[#0d0f16] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
              2 · Configuración
            </p>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              {[
                ["Respuesta", responseModeLabels[version.response_mode] ?? version.response_mode],
                [
                  "Debe aceptar",
                  acceptancePartyLabels[version.acceptance_party] ?? version.acceptance_party,
                ],
                ["Aplica a", audienceLabels[version.audience_scope] ?? version.audience_scope],
                [
                  "Se exige",
                  enforcementLabels[version.enforcement_scope] ?? version.enforcement_scope,
                ],
                [
                  "Entrada en vigor",
                  new Intl.DateTimeFormat("es-MX", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: studio.timezone,
                  }).format(new Date(version.effective_at ?? version.created_at)),
                ],
                ["Nueva aceptación", version.requires_reacceptance ? "Sí" : "No"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <dt className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">{label}</dt>
                  <dd className="mt-1 text-sm font-semibold text-white">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-3xl border border-fuchsia-500/25 bg-[#0d0f16] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
              Impacto estimado
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[
                ["Afectadas", impact.total ?? 0],
                ["Pendientes", impact.pending ?? 0],
                ["Menores", impact.minors ?? 0],
                ["Responsable pendiente", impact.guardian_pending ?? 0],
              ].map(([label, value]) => (
                <div
                  key={String(label)}
                  className="rounded-2xl border border-white/10 bg-black/20 p-4"
                >
                  <p className="text-2xl font-semibold text-white">{value}</p>
                  <p className="mt-1 text-xs text-zinc-500">{label}</p>
                </div>
              ))}
            </div>

            {version.enforcement_scope !== "none" ? (
              <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/[0.05] p-4">
                <p className="text-sm font-semibold text-amber-200">
                  Esta versión puede impedir nuevas acciones hasta completarse.
                </p>
                <p className="mt-1 text-xs leading-5 text-amber-100/60">
                  Las reservas ya confirmadas no se cancelan ni se modifican.
                </p>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.05] p-4 text-sm text-cyan-100/75">
                Este documento no genera restricciones.
              </div>
            )}
          </section>

          <form
            action={publishDocumentAction}
            className="rounded-3xl border border-white/10 bg-[#0d0f16] p-5"
          >
            <input type="hidden" name="document_id" value={document.id} />
            <input type="hidden" name="version_id" value={version.id} />
            <label className="flex items-start gap-3 text-sm leading-6 text-zinc-300">
              <input type="checkbox" required className="mt-1 accent-fuchsia-500" />
              Confirmo que revisé el contenido, las personas afectadas y las reglas de aplicación.
            </label>
            <button className="mt-5 w-full rounded-2xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_0_24px_rgba(217,70,239,.22)] hover:bg-fuchsia-500">
              {new Date(version.effective_at ?? 0) > new Date()
                ? "Programar publicación"
                : "Publicar documento"}
            </button>
          </form>
        </aside>
      </div>
    </main>
  );
}
