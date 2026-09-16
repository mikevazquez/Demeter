import Link from "next/link";

import { formatDate, getStudentPortalContext } from "@/lib/student/portal";

import { updateStudentProfileAction } from "../actions";

const errorCopy: Record<string, string> = {
  first_name_required: "Escribe tu nombre.",
  email_invalid: "Revisa el formato de tu correo.",
  profile_update_failed: "No pudimos guardar los cambios. Intenta de nuevo.",
  forbidden: "Tu cuenta no tiene permiso para editar estos datos.",
};

export default async function StudentProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string; error?: string }>;
}) {
  const query = await searchParams;
  const { snapshot, studio } = await getStudentPortalContext();
  const activePackage = snapshot.acquisitions.find((item) => item.active_now) ?? null;

  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm text-fuchsia-300">Perfil</p>
        <h1 className="mt-1 text-3xl font-semibold text-white sm:text-4xl">Tu cuenta</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Revisa tus datos y accede a la información asociada a tu cuenta.
        </p>
      </header>

      {query.updated ? (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.08] px-4 py-3 text-sm text-emerald-200">
          ✓ Tus datos se actualizaron correctamente.
        </div>
      ) : null}
      {query.error ? (
        <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {errorCopy[query.error] ?? errorCopy.profile_update_failed}
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
        <form
          action={updateStudentProfileAction}
          className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6"
        >
          <div>
            <h2 className="text-xl font-semibold text-white">Datos personales</h2>
            <p className="mt-1 text-sm text-zinc-500">Puedes actualizar nombre y correo desde aquí.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm text-zinc-300">
              Nombre
              <input
                name="first_name"
                required
                defaultValue={snapshot.profile.first_name}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white"
              />
            </label>
            <label className="text-sm text-zinc-300">
              Apellido
              <input
                name="last_name"
                defaultValue={snapshot.profile.last_name ?? ""}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white"
              />
            </label>
          </div>

          <label className="block text-sm text-zinc-300">
            Correo
            <input
              name="email"
              type="email"
              defaultValue={snapshot.profile.email ?? ""}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white"
            />
          </label>

          <label className="block text-sm text-zinc-300">
            Teléfono
            <input
              value={snapshot.profile.phone}
              readOnly
              className="mt-2 w-full cursor-not-allowed rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-zinc-500"
            />
            <span className="mt-2 block text-xs leading-5 text-zinc-500">
              Tu teléfono se usa para iniciar sesión, pero no es el ID interno de tu cuenta. Para cambiarlo,
              solicita el ajuste al estudio.
            </span>
          </label>

          <button
            type="submit"
            className="rounded-xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white hover:bg-fuchsia-500"
          >
            Guardar cambios
          </button>
        </form>

        <aside className="space-y-3">
          <Link
            href="/student/paquete"
            className="block rounded-3xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-fuchsia-500/30"
          >
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Mi paquete</p>
            <p className="mt-2 font-semibold text-white">{activePackage?.name ?? "Sin paquete activo"}</p>
            <p className="mt-1 text-sm text-zinc-400">
              {activePackage
                ? activePackage.unlimited
                  ? `Ilimitado · vence ${formatDate(activePackage.expires_on, studio.timezone)}`
                  : `${activePackage.available_credits} clases disponibles`
                : "Consulta tu historial de paquetes"}
            </p>
          </Link>

          <Link
            href="/student/mis-clases"
            className="block rounded-3xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-fuchsia-500/30"
          >
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Mis clases</p>
            <p className="mt-2 font-semibold text-white">{snapshot.upcoming.length} próximas</p>
            <p className="mt-1 text-sm text-zinc-400">Agenda, historial y cancelaciones.</p>
          </Link>

          <Link
            href="/student/pagos"
            className="block rounded-3xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-fuchsia-500/30"
          >
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Pagos</p>
            <p className="mt-2 font-semibold text-white">Historial comercial</p>
            <p className="mt-1 text-sm text-zinc-400">Pagos, reembolsos y referencias registradas.</p>
          </Link>

          <Link
            href="/student/documentos"
            className="block rounded-3xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-fuchsia-500/30"
          >
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Documentos</p>
            <p className="mt-2 font-semibold text-white">Próxima fase</p>
            <p className="mt-1 text-sm text-zinc-400">Versiones, pendientes y aceptación se habilitarán en F12.</p>
          </Link>
        </aside>
      </section>
    </main>
  );
}
