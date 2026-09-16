export default async function CoachHomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="space-y-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-fuchsia-300">Coach</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Mis clases</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
          Consulta únicamente las clases que tienes asignadas y abre cada sesión para gestionar su asistencia.
        </p>
      </section>

      {error === "access" ? (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          No tienes permiso para realizar esa acción desde el portal Coach.
        </div>
      ) : null}

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
        <p className="text-sm font-semibold text-white">Portal Coach listo</p>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
          El listado de Hoy, Mañana y calendario se incorpora en SF-109. Este shell ya mantiene el acceso separado de Administración y Alumna.
        </p>
      </section>
    </main>
  );
}
