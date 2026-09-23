import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { documentStatusLabels, documentTypeLabels } from "@/lib/documents";

export default async function AdminDocumentsPage() {
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.DOCUMENTS_READ);

  const { data: documents } = await supabase
    .from("studio_documents")
    .select("id,name,document_type,description,archived_at,created_at")
    .eq("studio_id", studio.id)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  const documentIds = (documents ?? []).map((item) => item.id);
  const { data: versions } = documentIds.length
    ? await supabase
        .from("document_versions")
        .select("id,document_id,version_number,status,effective_at,published_at,created_at")
        .eq("studio_id", studio.id)
        .in("document_id", documentIds)
        .order("version_number", { ascending: false })
    : { data: [] };

  const versionIds = (versions ?? []).map((item) => item.id);
  const { data: acceptances } = versionIds.length
    ? await supabase
        .from("document_acceptances")
        .select("id,version_id")
        .eq("studio_id", studio.id)
        .in("version_id", versionIds)
    : { data: [] };

  type VersionRow = NonNullable<typeof versions>[number];
  const latestByDocument = new Map<string, VersionRow>();
  for (const version of versions ?? []) {
    if (!latestByDocument.has(version.document_id))
      latestByDocument.set(version.document_id, version);
  }
  const acceptanceCount = new Map<string, number>();
  for (const acceptance of acceptances ?? []) {
    acceptanceCount.set(
      acceptance.version_id,
      (acceptanceCount.get(acceptance.version_id) ?? 0) + 1,
    );
  }

  const rows = (documents ?? []).map((document) => {
    const version = latestByDocument.get(document.id);
    return { document, version, accepted: version ? (acceptanceCount.get(version.id) ?? 0) : 0 };
  });

  const active = rows.filter((row) => row.version?.status === "active").length;
  const drafts = rows.filter((row) => row.version?.status === "draft").length;
  const scheduled = rows.filter((row) => row.version?.status === "scheduled").length;

  return (
    <main className="dashboard-shell space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">ADMINISTRACIÓN · DOCUMENTOS</p>
          <h1 className="dashboard-title">Documentos</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Administra contratos, reglamentos, responsivas y consentimientos sin perder el historial
            de versiones ni sus evidencias de aceptación.
          </p>
        </div>
        {can(CAPABILITIES.DOCUMENTS_MANAGE) ? (
          <Link
            href="/admin/documentos/nuevo"
            className="inline-flex items-center justify-center rounded-2xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_0_24px_rgba(217,70,239,.22)] transition hover:bg-fuchsia-500"
          >
            + Nuevo documento
          </Link>
        ) : null}
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ["Vigentes", active, "Documentos aplicándose ahora"],
          ["Programados", scheduled, "Entrarán en vigor después"],
          ["Borradores", drafts, "Todavía no afectan a alumnas"],
        ].map(([label, value, copy]) => (
          <div
            key={String(label)}
            className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
              {label}
            </p>
            <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
            <p className="mt-1 text-xs text-zinc-500">{copy}</p>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-3xl border border-fuchsia-500/20 bg-[#0d0f16]">
        <div className="border-b border-white/10 px-5 py-4">
          <h2 className="text-base font-semibold text-white">Todos los documentos</h2>
          <p className="mt-1 text-xs text-zinc-500">{rows.length} configurados</p>
        </div>

        {rows.length ? (
          <div className="divide-y divide-white/10">
            {rows.map(({ document, version, accepted }) => (
              <Link
                key={document.id}
                href={`/admin/documentos/${document.id}`}
                className="grid gap-4 px-5 py-5 transition hover:bg-white/[0.025] md:grid-cols-[1.6fr_.7fr_.7fr_.8fr_auto] md:items-center"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm text-white">{document.name}</strong>
                    <span className="rounded-full border border-fuchsia-400/20 bg-fuchsia-400/[0.08] px-2 py-1 text-[10px] font-semibold text-fuchsia-200">
                      {documentTypeLabels[document.document_type] ?? document.document_type}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">
                    {document.description || "Sin descripción interna."}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">Versión</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-200">
                    {version ? `v${version.version_number}` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">Estado</p>
                  <p className="mt-1 text-sm font-semibold text-emerald-300">
                    {version
                      ? (documentStatusLabels[version.status] ?? version.status)
                      : "Sin versión"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                    Aceptaciones
                  </p>
                  <p className="mt-1 text-sm font-semibold text-zinc-200">{accepted}</p>
                </div>
                <span className="text-xl text-fuchsia-300" aria-hidden="true">
                  ›
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="px-6 py-14 text-center">
            <p className="text-lg font-semibold text-white">
              Aún no tienes documentos configurados
            </p>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-zinc-500">
              Crea el primer documento para empezar a gestionar responsivas, reglamentos y
              consentimientos desde Studio Flow.
            </p>
            {can(CAPABILITIES.DOCUMENTS_MANAGE) ? (
              <Link
                href="/admin/documentos/nuevo"
                className="mt-5 inline-flex rounded-2xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white"
              >
                Crear primer documento
              </Link>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
