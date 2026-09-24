import { getStudentPortalContext } from "@/lib/student/portal";

import NotificationChannelPreferences from "../../components/NotificationChannelPreferences";

type PreferenceSnapshot = {
  push_enabled?: boolean;
  whatsapp_enabled?: boolean;
  email_enabled?: boolean;
};

export default async function StudentNotificationPreferencesPage() {
  const { supabase, studio } = await getStudentPortalContext();
  const { data } = await supabase.rpc("student_get_notification_channel_preferences");
  const preferences = (data ?? {}) as PreferenceSnapshot;

  return (
    <main className="space-y-4 pb-6 sm:space-y-5">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-fuchsia-300">
          Configuración
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Notificaciones
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-zinc-400">
          Elige por dónde quieres recibir los avisos de {studio.name}.
        </p>
      </header>

      <NotificationChannelPreferences
        studioId={studio.id}
        studioName={studio.name}
        initialPreferences={{
          push_enabled: preferences.push_enabled ?? true,
          whatsapp_enabled: preferences.whatsapp_enabled ?? true,
          email_enabled: preferences.email_enabled ?? true,
        }}
      />
    </main>
  );
}
