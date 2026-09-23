import Link from "next/link";
import { notFound } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import {
  acceptancePartyLabels,
  audienceLabels,
  enforcementLabels,
  formatFileSize,
  responseModeLabels,
} from "@/lib/documents";

import { saveDocumentDraftAction } from "../../actions";

function localInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const tz = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - tz).toISOString().slice(0, 16);
}

export default async function EditDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
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
      .select(
        "id,version_number,status,response_mode,acceptance_party,audience_scope,enforcement_scope,requires_reacceptance,effective_at,affirmation_text,change_summary,file_path,file_name,mime_type,file_size_bytes,content_sha256",
      )
      .eq("document_id", documentId)
      .eq("studio_id", studio.id)
      .eq("status", "draft")
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!document || !version) notFound();

  const [{ data: targets }, { data: activities }, { data: students }] = await Promise.all([
    supabase
      .from("document_version_targets")
      .select("target_type,target_id")
      .eq("version_id", version.id),
    supabase
      .from("class_templates")
      .select("id,name")
      .eq("studio_id", studio.id)
      .eq("active", true)
      .order("name"),
    supabase
      .from("students")
      .select("id,full_name")
      .eq("studio_id", studio.id)
      .eq("active", true)
      .order("full_name")
      .limit(250),
  ]);

  const selectedTargets = new Set((targets ?? []).map((item) => item.target_id));

  return (
    <main className="dashboard-shell space-y-5">
      <Link
        href={`/admin/documentos/${document.id}`}
        className="text-sm font-semibold text-zinc-400 hover:text-white"
      >
        ← Volver al documento
      </Link>

      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="eyebrow">DOCUMENTOS · BORRADOR v{version.version_number}</p>
          <h1 className="dashboard-title">Crear / editar borrador</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Configura el contenido y las reglas. Nada afectará a las alumnas hasta publicarlo.
          </p>
        </div>
        <span className="inline-flex w-fit rounded-full border border-fuchsia-400/25 bg-fuchsia-400/[0.08] px-3 py-1 text-xs font-semibold text-fuchsia-200">
          Borrador
        </span>
      </header>

      {query.saved ? <div className="notice success">Borrador guardado.</div> : null}
      {query.error ? (
        <div className="notice error">
          {query.error === "upload"
            ? "No pudimos subir el PDF privado."
            : query.error === "target_required"
              ? "Selecciona al menos un elemento para el alcance elegido."
              : query.error === "informational_block"
                ? "Un documento informativo no puede bloquear reservas."
                : "No pudimos guardar el borrador."}
        </div>
      ) : null}

      <form
        action={saveDocumentDraftAction}
        encType="multipart/form-data"
        className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]"
      >
        <input type="hidden" name="document_id" value={document.id} />
        <input type="hidden" name="version_id" value={version.id} />

        <div className="space-y-5">
          <section className="rounded-3xl border border-fuchsia-500/20 bg-[#0d0f16] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
              1 · Información general
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-1">
                <span className="mb-2 block text-sm font-semibold text-white">Nombre</span>
                <input
                  name="name"
                  defaultValue={document.name}
                  required
                  className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white"
                />
              </label>
              <label>
                <span className="mb-2 block text-sm font-semibold text-white">Tipo</span>
                <select
                  name="document_type"
                  defaultValue={document.document_type}
                  className="w-full rounded-2xl border border-white/10 bg-[#11131b] px-4 py-3 text-sm text-white"
                >
                  <option value="waiver">Responsiva</option>
                  <option value="regulation">Reglamento</option>
                  <option value="contract">Contrato</option>
                  <option value="privacy">Aviso de privacidad</option>
                  <option value="consent">Consentimiento</option>
                  <option value="notice">Aviso</option>
                  <option value="other">Otro</option>
                </select>
              </label>
              <label className="sm:col-span-2">
                <span className="mb-2 block text-sm font-semibold text-white">Descripción</span>
                <textarea
                  name="description"
                  rows={3}
                  defaultValue={document.description ?? ""}
                  className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white"
                />
              </label>
            </div>
          </section>

          <section className="rounded-3xl border border-fuchsia-500/20 bg-[#0d0f16] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
              2 · Contenido
            </p>
            <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-black/20 p-5">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-white">
                  PDF del documento
                </span>
                <input
                  name="file"
                  type="file"
                  accept="application/pdf"
                  className="block w-full text-sm text-zinc-400 file:mr-4 file:rounded-xl file:border-0 file:bg-fuchsia-600 file:px-4 file:py-2 file:font-semibold file:text-white"
                />
              </label>
              <p className="mt-3 text-xs text-zinc-500">
                PDF privado · máximo 10 MB.
                {version.file_name
                  ? ` Archivo actual: ${version.file_name} · ${formatFileSize(version.file_size_bytes)}.`
                  : " Aún no hay un archivo cargado."}
              </p>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label>
                <span className="mb-2 block text-sm font-semibold text-white">
                  Entrada en vigor
                </span>
                <input
                  name="effective_at"
                  type="datetime-local"
                  defaultValue={localInput(version.effective_at)}
                  required
                  className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white"
                />
              </label>
              <label>
                <span className="mb-2 block text-sm font-semibold text-white">
                  Nueva aceptación
                </span>
                <select
                  name="requires_reacceptance"
                  defaultValue={String(version.requires_reacceptance)}
                  className="w-full rounded-2xl border border-white/10 bg-[#11131b] px-4 py-3 text-sm text-white"
                >
                  <option value="true">Sí, volver a aceptar</option>
                  <option value="false">No, conservar aceptación previa</option>
                </select>
              </label>
            </div>
          </section>

          <section className="rounded-3xl border border-fuchsia-500/20 bg-[#0d0f16] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
              3 · Aplicación y aceptación
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label>
                <span className="mb-2 block text-sm font-semibold text-white">
                  Tipo de respuesta
                </span>
                <select
                  name="response_mode"
                  defaultValue={version.response_mode}
                  className="w-full rounded-2xl border border-white/10 bg-[#11131b] px-4 py-3 text-sm text-white"
                >
                  {Object.entries(responseModeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-2 block text-sm font-semibold text-white">Quién acepta</span>
                <select
                  name="acceptance_party"
                  defaultValue={version.acceptance_party}
                  className="w-full rounded-2xl border border-white/10 bg-[#11131b] px-4 py-3 text-sm text-white"
                >
                  {Object.entries(acceptancePartyLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-2 block text-sm font-semibold text-white">A quién aplica</span>
                <select
                  name="audience_scope"
                  defaultValue={version.audience_scope}
                  className="w-full rounded-2xl border border-white/10 bg-[#11131b] px-4 py-3 text-sm text-white"
                >
                  {Object.entries(audienceLabels).map(([value, label]) => (
                    <option key={value} value={value} disabled={value === "event"}>
                      {label}
                      {value === "event" ? " · próximamente" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-2 block text-sm font-semibold text-white">Cuándo se exige</span>
                <select
                  name="enforcement_scope"
                  defaultValue={version.enforcement_scope}
                  className="w-full rounded-2xl border border-white/10 bg-[#11131b] px-4 py-3 text-sm text-white"
                >
                  {Object.entries(enforcementLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-sm font-semibold text-white">Actividades específicas</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Se usan cuando el alcance es por actividad.
                </p>
                <div className="mt-3 max-h-48 space-y-2 overflow-auto">
                  {(activities ?? []).map((activity) => (
                    <label
                      key={activity.id}
                      className="flex items-center gap-2 text-sm text-zinc-300"
                    >
                      <input
                        type="checkbox"
                        name="target_id"
                        value={activity.id}
                        defaultChecked={selectedTargets.has(activity.id)}
                        className="accent-fuchsia-500"
                      />
                      {activity.name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-sm font-semibold text-white">Alumnas específicas</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Se usan cuando el alcance es individual.
                </p>
                <div className="mt-3 max-h-48 space-y-2 overflow-auto">
                  {(students ?? []).map((student) => (
                    <label
                      key={student.id}
                      className="flex items-center gap-2 text-sm text-zinc-300"
                    >
                      <input
                        type="checkbox"
                        name="target_id"
                        value={student.id}
                        defaultChecked={selectedTargets.has(student.id)}
                        className="accent-fuchsia-500"
                      />
                      {student.full_name}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-fuchsia-500/20 bg-[#0d0f16] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
              4 · Evidencia
            </p>
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-semibold text-white">
                Texto de confirmación
              </span>
              <textarea
                name="affirmation_text"
                rows={3}
                defaultValue={
                  version.affirmation_text ?? "He leído y acepto el contenido de este documento."
                }
                className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white"
              />
            </label>
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-semibold text-white">
                Resumen de cambios
              </span>
              <textarea
                name="change_summary"
                rows={3}
                defaultValue={version.change_summary ?? ""}
                placeholder="Solo para versiones posteriores."
                className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white"
              />
            </label>
          </section>
        </div>

        <aside className="space-y-4">
          <div className="sticky top-6 rounded-3xl border border-fuchsia-500/25 bg-[#0d0f16] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
              Vista previa
            </p>
            <h2 className="mt-3 text-xl font-semibold text-white">{document.name}</h2>
            <p className="mt-1 text-sm text-zinc-500">v{version.version_number} · Borrador</p>
            <p className="mt-4 text-sm leading-6 text-zinc-400">
              {document.description || "Sin descripción."}
            </p>

            <div className="mt-5 grid gap-2 text-xs text-zinc-400">
              <p>
                Respuesta:{" "}
                <strong className="text-zinc-200">
                  {responseModeLabels[version.response_mode]}
                </strong>
              </p>
              <p>
                Aceptante:{" "}
                <strong className="text-zinc-200">
                  {acceptancePartyLabels[version.acceptance_party]}
                </strong>
              </p>
              <p>
                Alcance:{" "}
                <strong className="text-zinc-200">{audienceLabels[version.audience_scope]}</strong>
              </p>
              <p>
                Exigencia:{" "}
                <strong className="text-zinc-200">
                  {enforcementLabels[version.enforcement_scope]}
                </strong>
              </p>
            </div>

            <div className="mt-6 grid gap-2">
              <button
                name="intent"
                value="save"
                className="rounded-2xl border border-white/15 px-4 py-3 text-sm font-semibold text-white"
              >
                Guardar borrador
              </button>
              <button
                name="intent"
                value="review"
                className="rounded-2xl bg-fuchsia-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_0_22px_rgba(217,70,239,.2)]"
              >
                Guardar y revisar publicación
              </button>
            </div>
          </div>
        </aside>
      </form>
    </main>
  );
}
