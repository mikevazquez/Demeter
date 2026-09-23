import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

type Item = {
  version_id: string;
  document_id: string;
  name: string;
  document_type: string;
  description?: string | null;
  version_number: number;
  response_mode: string;
  guardian_completed: boolean;
  student_completed: boolean;
  satisfied: boolean;
};

type Invitation = {
  status: string;
  expires_at: string;
  guardian: { full_name: string; relationship: string; relationship_detail?: string | null };
  student: { full_name: string };
  items?: Item[];
};

export default async function GuardianPendingDocumentsPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("guardian_document_invitation", {
    p_token: token,
  });

  if (error || !data) notFound();
  const invitation = data as Invitation;
  const items = invitation.items ?? [];
  const pending = items.filter((item) => !item.guardian_completed);
  const completed = items.filter((item) => item.guardian_completed);

  return (
    <main className="min-h-screen bg-[#090a0f] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-2xl space-y-5">
        <header>
          <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-fuchsia-300">
            Documentos del responsable
          </p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
            Documentos de {invitation.student.full_name}
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Revisa cada documento de forma individual. Tu aceptación queda asociada a la versión
            exacta que estás viendo.
          </p>
        </header>

        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-3xl border border-fuchsia-400/20 bg-fuchsia-400/[0.05] p-4">
            <p className="text-3xl font-semibold text-white">{pending.length}</p>
            <p className="mt-1 text-xs text-zinc-500">Pendientes</p>
          </div>
          <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4">
            <p className="text-3xl font-semibold text-white">{completed.length}</p>
            <p className="mt-1 text-xs text-zinc-500">Completados</p>
          </div>
        </section>

        {pending.length ? (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">Requieren tu acción</h2>
            {pending.map((item) => (
              <Link
                key={item.version_id}
                href={`/responsable/documentos/${encodeURIComponent(token)}/${item.version_id}`}
                className="block rounded-3xl border border-fuchsia-500/20 bg-[#0d0f16] p-5 transition hover:border-fuchsia-500/40"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs text-fuchsia-300">Versión {item.version_number}</p>
                    <h3 className="mt-1 text-lg font-semibold text-white">{item.name}</h3>
                    <p className="mt-1 text-sm leading-6 text-zinc-400">
                      {item.description || "Lee el documento completo antes de responder."}
                    </p>
                  </div>
                  <span className="text-2xl text-fuchsia-300">›</span>
                </div>
              </Link>
            ))}
          </section>
        ) : (
          <section className="rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.05] p-6 text-center">
            <p className="text-lg font-semibold text-emerald-200">Ya completaste tu parte.</p>
            <p className="mt-2 text-sm leading-6 text-emerald-100/65">
              No tienes documentos pendientes en esta invitación.
            </p>
          </section>
        )}

        {completed.length ? (
          <section className="overflow-hidden rounded-3xl border border-white/10 bg-[#0d0f16]">
            <div className="border-b border-white/10 px-5 py-4">
              <h2 className="text-sm font-semibold text-white">Completados</h2>
            </div>
            <div className="divide-y divide-white/10">
              {completed.map((item) => (
                <div key={item.version_id} className="flex items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <p className="text-sm font-semibold text-white">{item.name}</p>
                    <p className="mt-1 text-xs text-zinc-500">v{item.version_number}</p>
                  </div>
                  <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                    Completado
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
