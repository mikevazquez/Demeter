import { headers } from "next/headers";
import Link from "next/link";

import QueryNotice from "@/app/components/QueryNotice";
import { safeReservationReturnTo } from "@/lib/documents";
import { getStudentPortalContext } from "@/lib/student/portal";

import { registerGuardianAction } from "../actions";

export default async function StudentGuardianPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; token?: string; error?: string; returnTo?: string }>;
}) {
  const query = await searchParams;
  const returnTo = safeReservationReturnTo(query.returnTo);
  const { supabase, snapshot, membership } = await getStudentPortalContext();
  const studentId = snapshot.profile.student_id;

  const [{ data: guardians }, { data: invitations }] = await Promise.all([
    supabase
      .from("student_guardians")
      .select(
        "id,full_name,email,phone,relationship,relationship_detail,verified_at,active,created_at",
      )
      .eq("studio_id", membership.studio_id)
      .eq("student_id", studentId)
      .eq("active", true)
      .order("created_at", { ascending: false }),
    supabase
      .from("guardian_document_invitations")
      .select("id,status,destination_hint,sent_at,expires_at,completed_at")
      .eq("studio_id", membership.studio_id)
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "";
  const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
  const invitationUrl =
    query.token && host
      ? `${proto}://${host}/responsable/documentos/${encodeURIComponent(query.token)}`
      : null;

  return (
    <main className="mx-auto max-w-2xl space-y-5 pb-6">
      <Link
        href="/student/documentos"
        className="text-sm font-semibold text-zinc-400 hover:text-white"
      >
        ← Mis documentos
      </Link>

      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-300">
          Documentos · Responsable
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">
          Responsable de la alumna
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Cuando un documento requiere autorización de un adulto responsable, esa persona recibe un
          enlace independiente para revisar y aceptar su parte.
        </p>
      </header>

      {query.error ? (
        <QueryNotice
          eyebrow="Documentos"
          title={
            query.error === "not_required"
              ? "No necesitas responsable"
              : "No pudimos registrar al responsable"
          }
          message={
            query.error === "not_required"
              ? "Tu perfil no requiere responsable para este flujo."
              : query.error === "contact_required"
                ? "Agrega al menos correo o teléfono del responsable."
                : "Revisa los datos e inténtalo nuevamente."
          }
          tone={query.error === "not_required" ? "info" : "error"}
        />
      ) : null}

      {invitationUrl ? (
        <section className="rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.05] p-5">
          <p className="text-sm font-semibold text-emerald-200">Invitación creada</p>
          <p className="mt-1 text-xs leading-5 text-emerald-100/65">
            Comparte este enlace únicamente con tu responsable. Vence después del periodo
            configurado.
          </p>
          <div className="mt-4 break-all rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-300">
            {invitationUrl}
          </div>
          <a
            href={invitationUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex rounded-xl border border-emerald-400/25 px-4 py-2 text-xs font-semibold text-emerald-200"
          >
            Abrir invitación
          </a>
        </section>
      ) : null}

      {guardians?.length ? (
        <section className="rounded-3xl border border-cyan-400/20 bg-[#0d0f16] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">
            Responsable actual
          </p>
          {guardians.map((guardian) => (
            <div
              key={guardian.id}
              className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4"
            >
              <p className="text-base font-semibold text-white">{guardian.full_name}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {guardian.relationship_detail || guardian.relationship}
              </p>
              <p className="mt-2 text-xs text-zinc-500">
                {guardian.email || guardian.phone || "Sin contacto"}
              </p>
            </div>
          ))}
        </section>
      ) : null}

      <form
        action={registerGuardianAction}
        className="rounded-3xl border border-fuchsia-500/20 bg-[#0d0f16] p-5"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-300">
          Crear / reemplazar invitación
        </p>
        <div className="mt-4 space-y-3">
          <input
            name="full_name"
            required
            placeholder="Nombre completo"
            className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              name="email"
              type="email"
              placeholder="Correo"
              className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white"
            />
            <input
              name="phone"
              placeholder="Teléfono"
              className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white"
            />
          </div>
          <select
            name="relationship"
            defaultValue="legal_guardian"
            className="w-full rounded-2xl border border-white/10 bg-[#11131b] px-4 py-3 text-sm text-white"
          >
            <option value="mother">Madre</option>
            <option value="father">Padre</option>
            <option value="legal_guardian">Tutor legal</option>
            <option value="family">Familiar</option>
            <option value="other">Otra relación</option>
          </select>
          <input
            name="relationship_detail"
            placeholder="Detalle de relación (opcional)"
            className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white"
          />
          {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}
          <button className="w-full rounded-2xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white">
            Crear invitación
          </button>
        </div>
      </form>

      {invitations?.length ? (
        <section className="rounded-3xl border border-white/10 bg-[#0d0f16] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Invitaciones recientes
          </p>
          <div className="mt-3 space-y-2">
            {invitations.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 p-3"
              >
                <div>
                  <p className="text-sm font-semibold text-white">
                    {invite.destination_hint || "Invitación"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-600">
                    {invite.completed_at ? "Completada" : invite.status}
                  </p>
                </div>
                <span className="text-xs text-zinc-500">
                  {new Intl.DateTimeFormat(studio.locale, {
                    dateStyle: "medium",
                    timeZone: studio.timezone,
                  }).format(new Date(invite.sent_at))}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
