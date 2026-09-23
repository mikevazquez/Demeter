import Link from "next/link";
import { notFound } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { documentStatusLabels, formatFileSize } from "@/lib/documents";

export default async function DocumentVersionsPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  const { supabase, studio } = await getAdminContext(CAPABILITIES.DOCUMENTS_READ);

  const [{ data: document }, { data: versions }] = await Promise.all([
    supabase
      .from("studio_documents")
      .select("id,name,description")
      .eq("id", documentId)
      .eq("studio_id", studio.id)
      .maybeSingle(),
    supabase
      .from("document_versions")
      .select(
        "id,version_number,status,effective_at,published_at,superseded_at,retired_at,file_path,file_name,file_size_bytes,change_summary,created_at",
      )
      .eq("document_id", documentId)
      .eq("studio_id", studio.id)
      .order("version_number", { ascending: false }),
  ]);

  if (!document) notFound();

  const versionIds = (versions ?? []).map((item) => item.id);
  const { data: acceptances } = versionIds.length
    ? await supabase
        .from("document_acceptances")
        .select("version_id")
        .eq("studio_id", studio.id)
        .in("version_id", versionIds)
    : { data: [] };
  const counts = new Map<string, number>();
  for (const item of acceptances ?? []) {
    counts.set(item.version_id, (counts.get(item.version_id) ?? 0) + 1);
  }

  const versionRows = await Promise.all(
    (versions ?? []).map(async (version) => {
      if (!version.file_path) return { version, signedUrl: null as string | null };
      const { data } = await supabase.storage
        .from("studio-documents")
        .createSignedUrl(version.file_path, 60 * 15);
      return { version, signedUrl: data?.signedUrl ?? null };
    }),
  );

  return (
    <main className="dashboard-shell space-y-5">
      <Link
        href={`/admin/documentos/${document.id}`}
        className="text-sm font-semibold text-zinc-400 hover:text-white"
      >
        ← {document.name}
      </Link>
      <header>
        <p className="eyebrow">DOCUMENTOS · TRAZABILIDAD</p>
        <h1 className="dashboard-title">Historial de versiones</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Cada versión conserva su archivo, configuración y aceptaciones exactas.
        </p>
      </header>

      <section className="space-y-3">
        {versionRows.map(({ version, signedUrl }) => (
          <article
            key={version.id}
            className="rounded-3xl border border-fuchsia-500/20 bg-[#0d0f16] p-5"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold text-white">v{version.version_number}</h2>
                  <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs font-semibold text-zinc-300">
                    {documentStatusLabels[version.status] ?? version.status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-zinc-400">
                  {version.change_summary ||
                    (version.version_number === 1 ? "Versión inicial." : "Sin resumen de cambios.")}
                </p>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-500">
                  <span>{counts.get(version.id) ?? 0} aceptaciones</span>
                  <span>{version.file_name || "Sin archivo"}</span>
                  <span>{formatFileSize(version.file_size_bytes)}</span>
                  {version.effective_at ? (
                    <span>
                      Vigencia:{" "}
                      {new Intl.DateTimeFormat("es-MX", {
                        dateStyle: "medium",
                        timeZone: studio.timezone,
                      }).format(new Date(version.effective_at))}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex gap-2">
                {signedUrl ? (
                  <a
                    href={signedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white"
                  >
                    Ver archivo
                  </a>
                ) : null}
                <Link
                  href={`/admin/documentos/${document.id}/aceptaciones?version=${version.id}`}
                  className="rounded-xl border border-fuchsia-400/25 px-4 py-2 text-sm font-semibold text-fuchsia-200"
                >
                  Aceptaciones
                </Link>
              </div>
            </div>
          </article>
        ))}
      </section>

      {!versions?.length ? (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center text-sm text-zinc-500">
          Este documento todavía no tiene versiones.
        </div>
      ) : null}
    </main>
  );
}
