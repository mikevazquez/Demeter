import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import {
  addBookingRestrictionAction,
  grantBookingExceptionAction,
  recordExternalAcceptanceAction,
  resolveBookingRestrictionAction,
  revokeBookingExceptionAction,
} from "../actions";

export default async function DocumentIncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const query = await searchParams;
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.DOCUMENTS_READ);

  const [{ data: incidents }, { data: restrictions }, { data: exceptions }, { data: students }, { data: versions }] =
    await Promise.all([
      supabase
        .from("document_incidents")
        .select("id,student_id,version_id,incident_type,status,reason,created_at")
        .eq("studio_id", studio.id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("student_booking_restrictions")
        .select("id,student_id,code,title,detail,action_kind,starts_at,expires_at,resolved_at,created_at")
        .eq("studio_id", studio.id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("student_booking_exceptions")
        .select("id,student_id,restriction_code,reason,starts_at,expires_at,revoked_at,created_at")
        .eq("studio_id", studio.id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("students")
        .select("id,full_name")
        .eq("studio_id", studio.id)
        .eq("active", true)
        .order("full_name")
        .limit(300),
      supabase
        .from("document_versions")
        .select("id,document_id,version_number,status")
        .eq("studio_id", studio.id)
        .in("status", ["active", "scheduled", "superseded", "retired"])
        .order("version_number", { ascending: false }),
    ]);

  const studentMap = new Map((students ?? []).map((item) => [item.id, item.full_name]));
  const documentIds = [...new Set((versions ?? []).map((item) => item.document_id))];
  const { data: documents } = documentIds.length
    ? await supabase
        .from("studio_documents")
        .select("id,name")
        .eq("studio_id", studio.id)
        .in("id", documentIds)
    : { data: [] as { id: string; name: string }[] };
  const documentMap = new Map((documents ?? []).map((item) => [item.id, item.name]));
  const versionOptions = (versions ?? []).map((version) => ({
    ...version,
    label: `${documentMap.get(version.document_id) ?? "Documento"} · v${version.version_number}`,
  }));

  const { data: guardians } = await supabase
    .from("student_guardians")
    .select("id,student_id,full_name,relationship")
    .eq("studio_id", studio.id)
    .eq("active", true)
    .order("full_name");

  return (
    <main className="dashboard-shell space-y-5">
      <Link href="/admin/documentos" className="text-sm font-semibold text-zinc-400 hover:text-white">
        ← Documentos
      </Link>

      <header>
        <p className="eyebrow">DOCUMENTOS · CASOS ESPECIALES</p>
        <h1 className="dashboard-title">Incidencias y excepciones</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">
          Resuelve evidencia externa, bloqueos administrativos y excepciones temporales sin alterar
          ni borrar el historial original.
        </p>
      </header>

      {query.saved ? <div className="notice success">Cambio registrado correctamente.</div> : null}
      {query.error ? <div className="notice error">No pudimos completar esa operación.</div> : null}

      {can(CAPABILITIES.DOCUMENTS_MANAGE) ? (
        <section className="grid gap-4 xl:grid-cols-3">
          <form action={recordExternalAcceptanceAction} className="rounded-3xl border border-fuchsia-500/20 bg-[#0d0f16] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
              Registrar evidencia externa
            </p>
            <p className="mt-2 text-xs leading-5 text-zinc-500">
              Para documentos firmados presencialmente o fuera de Studio Flow.
            </p>
            <div className="mt-4 space-y-3">
              <select name="student_id" required className="w-full rounded-xl border border-white/10 bg-[#11131b] px-3 py-2.5 text-sm text-white">
                <option value="">Seleccionar alumna</option>
                {(students ?? []).map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}
              </select>
              <select name="version_id" required className="w-full rounded-xl border border-white/10 bg-[#11131b] px-3 py-2.5 text-sm text-white">
                <option value="">Seleccionar documento</option>
                {versionOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              <input type="hidden" name="document_id" value="" />
              <select name="acceptor_kind" defaultValue="student" className="w-full rounded-xl border border-white/10 bg-[#11131b] px-3 py-2.5 text-sm text-white">
                <option value="student">Aceptó la alumna</option>
                <option value="guardian">Aceptó responsable</option>
              </select>
              <select name="guardian_id" className="w-full rounded-xl border border-white/10 bg-[#11131b] px-3 py-2.5 text-sm text-white">
                <option value="">Sin responsable</option>
                {(guardians ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.full_name} · {studentMap.get(item.student_id) ?? "Alumna"}
                  </option>
                ))}
              </select>
              <select name="method" defaultValue="in_person" className="w-full rounded-xl border border-white/10 bg-[#11131b] px-3 py-2.5 text-sm text-white">
                <option value="in_person">Aceptación presencial</option>
                <option value="external">Evidencia externa</option>
              </select>
              <input name="reference" placeholder="Referencia / folio opcional" className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white" />
              <textarea name="reason" required minLength={3} rows={3} placeholder="Motivo y contexto obligatorio" className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white" />
              <button className="w-full rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white">
                Registrar evidencia
              </button>
            </div>
          </form>

          <form action={addBookingRestrictionAction} className="rounded-3xl border border-amber-400/20 bg-[#0d0f16] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">
              Crear restricción
            </p>
            <p className="mt-2 text-xs leading-5 text-zinc-500">
              Úsala solo para adeudos, penalizaciones o condiciones que realmente deban impedir nuevas reservas.
            </p>
            <div className="mt-4 space-y-3">
              <select name="student_id" required className="w-full rounded-xl border border-white/10 bg-[#11131b] px-3 py-2.5 text-sm text-white">
                <option value="">Seleccionar alumna</option>
                {(students ?? []).map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}
              </select>
              <input name="code" required placeholder="Código · ej. overdue_installment" className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white" />
              <input name="title" required placeholder="Título visible para la alumna" className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white" />
              <textarea name="detail" rows={3} placeholder="Qué pasó y qué necesita hacer" className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white" />
              <select name="action_kind" defaultValue="payment" className="w-full rounded-xl border border-white/10 bg-[#11131b] px-3 py-2.5 text-sm text-white">
                <option value="payment">Realizar pago</option>
                <option value="documents">Revisar documentos</option>
                <option value="profile">Completar perfil</option>
                <option value="contact_studio">Contactar al estudio</option>
                <option value="custom">Acción personalizada</option>
              </select>
              <input name="action_href" placeholder="/student/..." className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white" />
              <input name="expires_at" type="datetime-local" className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white" />
              <button className="w-full rounded-xl border border-amber-400/30 bg-amber-400/[0.08] px-4 py-2.5 text-sm font-semibold text-amber-200">
                Crear restricción
              </button>
            </div>
          </form>

          <form action={grantBookingExceptionAction} className="rounded-3xl border border-cyan-400/20 bg-[#0d0f16] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">
              Excepción temporal
            </p>
            <p className="mt-2 text-xs leading-5 text-zinc-500">
              Permite reservar temporalmente sin borrar la condición que originó el bloqueo.
            </p>
            <div className="mt-4 space-y-3">
              <select name="student_id" required className="w-full rounded-xl border border-white/10 bg-[#11131b] px-3 py-2.5 text-sm text-white">
                <option value="">Seleccionar alumna</option>
                {(students ?? []).map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}
              </select>
              <input name="restriction_code" placeholder="Código específico o vacío para excepción general" className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white" />
              <input name="source_id" placeholder="ID de restricción opcional" className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white" />
              <textarea name="reason" required minLength={3} rows={3} placeholder="Motivo obligatorio" className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white" />
              <input name="expires_at" type="datetime-local" required className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white" />
              <button className="w-full rounded-xl border border-cyan-400/30 bg-cyan-400/[0.08] px-4 py-2.5 text-sm font-semibold text-cyan-200">
                Autorizar excepción
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#0d0f16]">
          <div className="border-b border-white/10 px-5 py-4">
            <h2 className="text-base font-semibold text-white">Restricciones</h2>
          </div>
          <div className="divide-y divide-white/10">
            {(restrictions ?? []).length ? restrictions?.map((item) => (
              <div key={item.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <strong className="text-sm text-white">{studentMap.get(item.student_id) ?? "Alumna"}</strong>
                    <p className="mt-1 text-sm text-zinc-300">{item.title}</p>
                    <p className="mt-1 text-xs text-zinc-500">{item.detail || item.code}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.resolved_at ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-200"}`}>
                    {item.resolved_at ? "Resuelta" : "Activa"}
                  </span>
                </div>
                {!item.resolved_at && can(CAPABILITIES.DOCUMENTS_MANAGE) ? (
                  <form action={resolveBookingRestrictionAction} className="mt-3 flex gap-2">
                    <input type="hidden" name="restriction_id" value={item.id} />
                    <input name="note" placeholder="Nota de resolución" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white" />
                    <button className="rounded-xl border border-emerald-400/25 px-3 py-2 text-xs font-semibold text-emerald-200">Resolver</button>
                  </form>
                ) : null}
              </div>
            )) : <p className="px-5 py-8 text-sm text-zinc-500">No hay restricciones registradas.</p>}
          </div>
        </div>

        <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#0d0f16]">
          <div className="border-b border-white/10 px-5 py-4">
            <h2 className="text-base font-semibold text-white">Excepciones temporales</h2>
          </div>
          <div className="divide-y divide-white/10">
            {(exceptions ?? []).length ? exceptions?.map((item) => (
              <div key={item.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <strong className="text-sm text-white">{studentMap.get(item.student_id) ?? "Alumna"}</strong>
                    <p className="mt-1 text-xs text-zinc-500">{item.reason}</p>
                    <p className="mt-1 text-[11px] text-zinc-600">
                      Hasta {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: studio.timezone }).format(new Date(item.expires_at))}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.revoked_at ? "bg-zinc-500/10 text-zinc-400" : new Date(item.expires_at) <= new Date() ? "bg-zinc-500/10 text-zinc-400" : "bg-cyan-400/10 text-cyan-200"}`}>
                    {item.revoked_at ? "Revocada" : new Date(item.expires_at) <= new Date() ? "Vencida" : "Activa"}
                  </span>
                </div>
                {!item.revoked_at && new Date(item.expires_at) > new Date() && can(CAPABILITIES.DOCUMENTS_MANAGE) ? (
                  <form action={revokeBookingExceptionAction} className="mt-3 flex gap-2">
                    <input type="hidden" name="exception_id" value={item.id} />
                    <input name="reason" placeholder="Motivo" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white" />
                    <button className="rounded-xl border border-rose-400/25 px-3 py-2 text-xs font-semibold text-rose-200">Revocar</button>
                  </form>
                ) : null}
              </div>
            )) : <p className="px-5 py-8 text-sm text-zinc-500">No hay excepciones registradas.</p>}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-white/10 bg-[#0d0f16]">
        <div className="border-b border-white/10 px-5 py-4">
          <h2 className="text-base font-semibold text-white">Bitácora de incidencias</h2>
        </div>
        <div className="divide-y divide-white/10">
          {(incidents ?? []).length ? incidents?.map((item) => (
            <div key={item.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_.7fr_auto] sm:items-center">
              <div>
                <strong className="text-sm text-white">{studentMap.get(item.student_id ?? "") ?? "Caso general"}</strong>
                <p className="mt-1 text-xs text-zinc-500">{item.reason}</p>
              </div>
              <div className="text-xs text-zinc-500">
                {item.incident_type.replaceAll("_", " ")}
              </div>
              <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs font-semibold text-zinc-300">
                {item.status}
              </span>
            </div>
          )) : <p className="px-5 py-8 text-sm text-zinc-500">Sin incidencias registradas.</p>}
        </div>
      </section>
    </main>
  );
}
