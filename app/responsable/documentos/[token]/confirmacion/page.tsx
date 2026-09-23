import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export default async function GuardianConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ acceptance?: string; remaining?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  if (!query.acceptance) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("guardian_document_invitation", {
    p_token: token,
  });
  if (error || !data) notFound();

  const invitation = data as {
    guardian: { full_name: string };
    student: { full_name: string };
  };
  const remaining = Number(query.remaining ?? 0);

  return (
    <main className="min-h-screen bg-[#090a0f] px-4 py-10 text-white sm:px-6">
      <div className="mx-auto max-w-xl">
        <section className="rounded-[32px] border border-emerald-400/25 bg-[radial-gradient(circle_at_50%_0%,rgba(52,211,153,.12),transparent_42%),#0d0f16] p-7 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-emerald-400/25 bg-emerald-400/[0.08] text-2xl text-emerald-300">
            ✓
          </div>
          <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-300">
            Respuesta registrada
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-white">
            Gracias, {invitation.guardian.full_name}
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Tu respuesta quedó vinculada al documento y a {invitation.student.full_name}.
          </p>

          <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4 text-left">
            <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">Pendientes restantes</p>
            <p className="mt-1 text-2xl font-semibold text-white">{Number.isFinite(remaining) ? remaining : 0}</p>
          </div>

          <Link
            href={`/responsable/documentos/${encodeURIComponent(token)}/pendientes`}
            className="mt-6 inline-flex w-full justify-center rounded-2xl bg-fuchsia-600 px-4 py-3 text-sm font-semibold text-white"
          >
            {remaining > 0 ? "Continuar con documentos" : "Ver resumen"}
          </Link>
        </section>
      </div>
    </main>
  );
}
