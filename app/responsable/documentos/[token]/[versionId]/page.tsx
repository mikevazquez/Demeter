import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { acceptGuardianDocumentAction } from "../../actions";

type Item = {
  version_id: string;
  name: string;
  document_type: string;
  description?: string | null;
  version_number: number;
  response_mode: string;
  effective_at?: string | null;
  file_path?: string | null;
  file_name?: string | null;
  affirmation_text?: string | null;
  guardian_completed: boolean;
  student_completed: boolean;
  satisfied: boolean;
};

type Invitation = {
  guardian: { full_name: string; relationship: string; relationship_detail?: string | null };
  student: { full_name: string };
  items?: Item[];
};

export default async function GuardianDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; versionId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token, versionId } = await params;
  const query = await searchParams;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("guardian_document_invitation", {
    p_token: token,
  });
  if (error || !data) notFound();

  const invitation = data as Invitation;
  const item = (invitation.items ?? []).find((candidate) => candidate.version_id === versionId);
  if (!item) notFound();

  const { data: accessData, error: accessError } = await supabase.functions.invoke(
    "guardian-document-access",
    { body: { token, versionId } },
  );
  const access = accessData as { ok?: boolean; signedUrl?: string; fileName?: string } | null;
  const signedUrl = !accessError && access?.ok ? (access.signedUrl ?? null) : null;

  return (
    <main className="min-h-screen bg-[#090a0f] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <Link
          href={`/responsable/documentos/${encodeURIComponent(token)}/pendientes`}
          className="text-sm font-semibold text-zinc-400 hover:text-white"
        >
          ← Documentos pendientes
        </Link>

        <header>
          <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-fuchsia-300">
            Lectura y aceptación
          </p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{item.name}</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Actúas como responsable de {invitation.student.full_name}. Revisa esta versión completa
            antes de registrar tu respuesta.
          </p>
        </header>

        {query.error ? (
          <div className="rounded-3xl border border-rose-400/25 bg-rose-400/[0.06] p-4 text-sm text-rose-100">
            No pudimos registrar tu respuesta. Revisa la confirmación e inténtalo de nuevo.
          </div>
        ) : null}

        <section className="overflow-hidden rounded-3xl border border-fuchsia-500/20 bg-[#0d0f16]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-white">{item.file_name || item.name}</p>
              <p className="mt-1 text-xs text-zinc-500">
                Versión {item.version_number} · acceso temporal
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
              title={item.name}
              src={signedUrl}
              className="h-[65vh] min-h-[520px] w-full bg-white"
            />
          ) : (
            <div className="px-6 py-16 text-center text-sm text-zinc-500">
              No pudimos abrir el archivo de esta invitación.
            </div>
          )}
        </section>

        {!item.guardian_completed ? (
          <section className="rounded-3xl border border-fuchsia-500/25 bg-[#0d0f16] p-5">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">Responsable</p>
              <p className="mt-1 text-sm font-semibold text-white">
                {invitation.guardian.full_name}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {invitation.guardian.relationship_detail || invitation.guardian.relationship}
              </p>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">Confirmación</p>
              <p className="mt-2 text-sm leading-6 text-zinc-300">
                {item.affirmation_text || "He leído y acepto el contenido de este documento."}
              </p>
            </div>

            <form action={acceptGuardianDocumentAction} className="mt-4">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="version_id" value={item.version_id} />
              <label className="flex items-start gap-3 rounded-2xl border border-fuchsia-400/20 bg-fuchsia-400/[0.05] p-4 text-sm leading-6 text-zinc-300">
                <input
                  type="checkbox"
                  name="confirmation"
                  value="true"
                  required
                  className="mt-1 accent-fuchsia-500"
                />
                Confirmo que leí esta versión completa y que registro personalmente esta decisión
                como responsable de la alumna.
              </label>

              {item.response_mode === "decision_optional" ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button
                    name="decision"
                    value="accepted"
                    className="rounded-2xl bg-fuchsia-600 px-4 py-3 text-sm font-semibold text-white"
                  >
                    Autorizar
                  </button>
                  <button
                    name="decision"
                    value="declined"
                    className="rounded-2xl border border-white/15 px-4 py-3 text-sm font-semibold text-white"
                  >
                    No autorizar
                  </button>
                </div>
              ) : (
                <>
                  <input type="hidden" name="decision" value="accepted" />
                  <button className="mt-4 w-full rounded-2xl bg-fuchsia-600 px-4 py-3 text-sm font-semibold text-white">
                    Aceptar documento
                  </button>
                </>
              )}
            </form>
          </section>
        ) : (
          <section className="rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.05] p-5">
            <p className="text-sm font-semibold text-emerald-200">
              Ya registraste tu respuesta para esta versión.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
