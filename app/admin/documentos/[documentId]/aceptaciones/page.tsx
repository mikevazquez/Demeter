import Link from "next/link";
import { notFound } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

type TrackingRow = {
  student_id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  minor?: boolean | null;
  satisfied?: boolean;
  student_completed?: boolean;
  guardian_completed?: boolean;
  blocks_booking?: boolean;
  guardian?: { id: string; full_name: string; relationship: string } | null;
  latest_acceptance?: {
    id: string;
    accepted_at: string;
    acceptor_kind: string;
    decision: string;
    method: string;
  } | null;
};

export default async function DocumentTrackingPage({
  params,
  searchParams,
}: {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<{ version?: string; filter?: string }>;
}) {
  const { documentId } = await params;
  const query = await searchParams;
  const { supabase, studio } = await getAdminContext(CAPABILITIES.DOCUMENTS_READ);

  const { data: document } = await supabase
    .from("studio_documents")
    .select("id,name")
    .eq("id", documentId)
    .eq("studio_id", studio.id)
    .maybeSingle();
  if (!document) notFound();

  let versionId = query.version || "";
  if (!versionId) {
    const { data: latest } = await supabase
      .from("document_versions")
      .select("id")
      .eq("document_id", document.id)
      .eq("studio_id", studio.id)
      .in("status", ["active", "scheduled", "superseded", "retired"])
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    versionId = latest?.id ?? "";
  }

  const { data: version } = versionId
    ? await supabase
        .from("document_versions")
        .select("id,version_number,status,enforcement_scope")
        .eq("id", versionId)
        .eq("document_id", document.id)
        .eq("studio_id", studio.id)
        .maybeSingle()
    : { data: null };

  if (!version) notFound();

  const { data } = await supabase.rpc("admin_document_tracking", { p_version_id: version.id });
  const tracking = (data ?? []) as TrackingRow[];
  const accepted = tracking.filter((item) => item.satisfied).length;
  const pending = tracking.length - accepted;
  const guardianPending = tracking.filter((item) => item.minor && !item.guardian_completed).length;
  const blocked = tracking.filter((item) => item.blocks_booking).length;

  const filtered = tracking.filter((item) => {
    if (query.filter === "accepted") return item.satisfied;
    if (query.filter === "pending") return !item.satisfied;
    if (query.filter === "guardian") return item.minor && !item.guardian_completed;
    if (query.filter === "blocked") return item.blocks_booking;
    return true;
  });

  return (
    <main className="dashboard-shell space-y-5">
      <Link
        href={`/admin/documentos/${document.id}`}
        className="text-sm font-semibold text-zinc-400 hover:text-white"
      >
        ← {document.name}
      </Link>
      <header>
        <p className="eyebrow">DOCUMENTOS · ACEPTACIONES</p>
        <h1 className="dashboard-title">Seguimiento de aceptaciones</h1>
        <p className="mt-2 text-sm text-zinc-400">
          {document.name} · v{version.version_number}
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Aceptadas", accepted, "accepted"],
          ["Pendientes", pending, "pending"],
          ["Esperando responsable", guardianPending, "guardian"],
          ["Restricción activa", blocked, "blocked"],
        ].map(([label, value, filter]) => (
          <Link
            key={String(label)}
            href={`/admin/documentos/${document.id}/aceptaciones?version=${version.id}&filter=${filter}`}
            className="rounded-3xl border border-white/10 bg-[#0d0f16] p-5 transition hover:border-fuchsia-500/30"
          >
            <p className="text-3xl font-semibold text-white">{value}</p>
            <p className="mt-1 text-xs text-zinc-500">{label}</p>
          </Link>
        ))}
      </section>

      <section className="overflow-hidden rounded-3xl border border-fuchsia-500/20 bg-[#0d0f16]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Alumnas afectadas</h2>
            <p className="mt-1 text-xs text-zinc-500">{filtered.length} resultados</p>
          </div>
          <Link
            href={`/admin/documentos/${document.id}/aceptaciones?version=${version.id}`}
            className="text-sm font-semibold text-fuchsia-300"
          >
            Limpiar filtro
          </Link>
        </div>

        <div className="divide-y divide-white/10">
          {filtered.map((row) => (
            <div
              key={row.student_id}
              className="grid gap-4 px-5 py-4 lg:grid-cols-[1.4fr_.7fr_.9fr_.8fr_auto] lg:items-center"
            >
              <div>
                <strong className="text-sm text-white">{row.full_name}</strong>
                <p className="mt-1 text-xs text-zinc-500">
                  {row.email || row.phone || "Sin contacto"}
                </p>
              </div>
              <div>
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${row.satisfied ? "bg-emerald-400/10 text-emerald-300" : "bg-fuchsia-400/10 text-fuchsia-200"}`}
                >
                  {row.satisfied ? "Aceptado" : "Pendiente"}
                </span>
              </div>
              <div className="text-xs text-zinc-400">
                {row.minor
                  ? row.guardian
                    ? `Responsable: ${row.guardian.full_name}`
                    : "Responsable sin registrar"
                  : "Aceptación personal"}
              </div>
              <div className="text-xs text-zinc-500">
                {row.latest_acceptance?.accepted_at
                  ? new Intl.DateTimeFormat("es-MX", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: studio.timezone,
                    }).format(new Date(row.latest_acceptance.accepted_at))
                  : row.blocks_booking
                    ? "Bloquea nuevas reservas"
                    : "Sin aceptación"}
              </div>
              {row.latest_acceptance?.id ? (
                <Link
                  href={`/admin/documentos/aceptaciones/${row.latest_acceptance.id}`}
                  className="rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold text-white"
                >
                  Ver evidencia
                </Link>
              ) : (
                <Link
                  href={`/admin/alumnas/${row.student_id}`}
                  className="rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold text-zinc-300"
                >
                  Ver perfil
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
