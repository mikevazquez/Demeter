import { getStudentPortalContext } from "@/lib/student/portal";

import PushNotificationSettings from "../components/PushNotificationSettings";

export default async function StudentNotificationsPage() {
  const { snapshot } = await getStudentPortalContext();

  return (
    <main className="space-y-4 pb-4 sm:space-y-5">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
          Notificaciones
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Mantente al día
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-zinc-400">
          Configura Push para recibir cambios importantes aunque Studio Flow no
          esté abierto.
        </p>
      </header>

      <PushNotificationSettings studioId={snapshot.profile.studio_id} />

      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
        <p className="text-xs font-semibold text-white">Qué enviaremos por Push</p>
        <p className="mt-1.5 text-xs leading-5 text-zinc-400">
          Cambios operativos importantes, recordatorios y avisos de Studio Flow.
          Cada tipo de evento se habilitará desde el motor central de
          notificaciones, no desde esta pantalla.
        </p>
      </section>
    </main>
  );
}
