import Link from "next/link";
import { notFound } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { formatFileSize } from "@/lib/documents";

import { invalidateAcceptanceAction } from "../../actions";

export default async function AcceptanceEvidencePage({
  params,
  searchParams,
}: {
  params: Promise<{ acceptanceId: string }>;
  searchParams: Promise<{ invalidated?: string; error?: string }>;
}) {
  const { acceptanceId } = await params;
  const query = await searchParams;
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.DOCUMENTS_READ);

  const { data: acceptance } = await supabase
    .from("document_acceptances")
    .select("id,student_id,version_id,acceptor_kind,guardian_id,decision,method,affirmation_text,evidence,actor_user_id,accepted_at")
    .eq("id", acceptanceId)
    .eq("studio_id", studio.id)
    .maybeSingle();
  if (!acceptance) notFound();

  const [{ data: student }, { data: version }, { data: guardian }, { data: invalidation }] =
    await Promise.all([
      supabase.from("students").select("id,full_name,email,phone").eq("id", acceptance.student_id).maybeSingle(),
      supabase.from("document_versions").select("id,document_id,version_number,file_path,file_name,file_size_bytes,content_sha256,response_mode,acceptance_party").eq("id", acceptance.version_id).maybeSingle(),
      acceptance.guardian_id
        ? supabase.from("student_guardians").select("id,full_name,relationship,relationship_detail").eq("id", acceptance.guardian_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("document_acceptance_invalidations").select("reason,invalidated_at,invalidated_by").eq("acceptance_id", acceptance.id).maybeSingle(),
    ]);

  if (!student || !version) notFound();

  const { data: document } = await supabase
    .from("studio_documents")
    .select("id,name,document_type")
    .eq("id", version.document_id)
    .maybeSingle();
  if (!document) notFound();

  let signedUrl: string | null = null;
  if (version.file_path) {
    const { data } = await supabase.storage.from("studio-documents").createSignedUrl(version.file_path, 60 * 15);
    signedUrl = data?.signedUrl ?? null;
  }

  const evidence = (acceptance.evidence ?? {}) as Record<string, unknown>;

  return (
    <main className="dashboard-shell space-y-5">
      <Link href={`/admin/documentos/${document.id}/aceptaciones?version=${version.id}`} className="text-sm font-semibold text-zinc-400 hover:text-white">
        ← Seguimiento de aceptaciones
      </Link>
      <header>
        <p className="eyebrow">DOCUMENTOS · EVIDENCIA</p>
        <h1 className="dashboard-title">Evidencia de aceptación</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Registro inmutable de quién aceptó, qué versión y en qué momento.
        </p>
      </header>

      {query.invalidated ? <div className="notice success">La aceptación fue invalidada sin borrar la evidencia original.</div> : null}
      {query.error ? <div className="notice error">No pudimos invalidar esta aceptación.</div> : null}

      <section className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-[#0d0f16] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">Alumna</p>
            <h2 className="mt-3 text-xl font-semibold text-white">{student.full_name}</h2>
            <p className="mt-1 text-sm text-zinc-500">{student.email || student.phone || "Sin contacto"}</p>
          </div>

          <div className="rounded-3xl border border-emerald-400/20 bg-[#0d0f16] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Detalle de la aceptación</p>
                <h2 className="mt-3 text-2xl font-semibold text-white">{document.name} · v{version.version_number}</h2>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${invalidation ? "bg-rose-400/10 text-rose-200" : "bg-emerald-400/10 text-emerald-300"}`}>
                {invalidation ? "Invalidada" : acceptance.decision === "declined" ? "No autorizado" : "Aceptada"}
              </span>
            </div>

            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <div><dt className="text-xs text-zinc-500">Aceptante</dt><dd className="mt-1 text-sm font-semibold text-white">{guardian?.full_name || student.full_name}</dd></div>
              <div><dt className="text-xs text-zinc-500">Tipo</dt><dd className="mt-1 text-sm font-semibold text-white">{acceptance.acceptor_kind === "guardian" ? "Responsable" : "Alumna"}</dd></div>
              <div><dt className="text-xs text-zinc-500">Fecha y hora</dt><dd className="mt-1 text-sm font-semibold text-white">{new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: studio.timezone }).format(new Date(acceptance.accepted_at))}</dd></div>
              <div><dt className="text-xs text-zinc-500">Método</dt><dd className="mt-1 text-sm font-semibold text-white">{acceptance.method.replaceAll("_"," ")}</dd></div>
              {guardian ? <div><dt className="text-xs text-zinc-500">Relación declarada</dt><dd className="mt-1 text-sm font-semibold text-white">{guardian.relationship_detail || guardian.relationship}</dd></div> : null}
              <div><dt className="text-xs text-zinc-500">Resultado</dt><dd className="mt-1 text-sm font-semibold text-white">{acceptance.decision}</dd></div>
            </dl>

            {acceptance.affirmation_text ? (
              <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">Confirmación utilizada</p>
                <p className="mt-2 text-sm leading-6 text-zinc-300">{acceptance.affirmation_text}</p>
              </div>
            ) : null}
          </div>

          {invalidation ? (
            <div className="rounded-3xl border border-rose-400/20 bg-rose-400/[0.04] p-5">
              <p className="text-sm font-semibold text-rose-200">Aceptación invalidada</p>
              <p className="mt-2 text-sm text-zinc-400">{invalidation.reason}</p>
              <p className="mt-2 text-xs text-zinc-500">
                {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: studio.timezone }).format(new Date(invalidation.invalidated_at))}
              </p>
            </div>
          ) : null}
        </div>

        <aside className="space-y-4">
          <div className="rounded-3xl border border-fuchsia-500/20 bg-[#0d0f16] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">Documento aceptado</p>
            <h3 className="mt-3 text-lg font-semibold text-white">{version.file_name || document.name}</h3>
            <p className="mt-1 text-xs text-zinc-500">{formatFileSize(version.file_size_bytes)}</p>
            <p className="mt-2 break-all text-[11px] text-zinc-600">SHA-256: {version.content_sha256 || "—"}</p>
            {signedUrl ? (
              <a href={signedUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex w-full justify-center rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white">
                Ver versión exacta
              </a>
            ) : null}
          </div>

          <div className="rounded-3xl border border-cyan-400/20 bg-cyan-400/[0.04] p-5">
            <p className="text-sm font-semibold text-cyan-200">Contexto registrado</p>
            <dl className="mt-3 space-y-2 text-xs text-zinc-400">
              {Object.entries(evidence).slice(0, 8).map(([key,value]) => (
                <div key={key} className="flex items-start justify-between gap-4">
                  <dt className="text-zinc-600">{key.replaceAll("_"," ")}</dt>
                  <dd className="max-w-[60%] break-words text-right">{String(value ?? "—")}</dd>
                </div>
              ))}
            </dl>
          </div>

          {can(CAPABILITIES.DOCUMENTS_MANAGE) && !invalidation ? (
            <form action={invalidateAcceptanceAction} className="rounded-3xl border border-rose-400/20 bg-[#0d0f16] p-5">
              <input type="hidden" name="acceptance_id" value={acceptance.id} />
              <input type="hidden" name="document_id" value={document.id} />
              <label>
                <span className="mb-2 block text-sm font-semibold text-white">Invalidar evidencia</span>
                <textarea name="reason" required minLength={3} rows={3} placeholder="Motivo obligatorio" className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white" />
              </label>
              <button className="mt-3 w-full rounded-xl border border-rose-400/25 px-4 py-2 text-sm font-semibold text-rose-200">
                Invalidar sin borrar
              </button>
            </form>
          ) : null}
        </aside>
      </section>
    </main>
  );
}
