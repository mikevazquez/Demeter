import Link from "next/link";

import { getStudentPortalContext } from "@/lib/student/portal";

import NotificationChannelPreferences from "../../components/NotificationChannelPreferences";

type PreferenceSnapshot = {
  push_enabled?: boolean;
  whatsapp_enabled?: boolean;
  email_enabled?: boolean;
};

export default async function StudentNotificationPreferencesPage() {
  const { supabase, studio, membership } = await getStudentPortalContext();
  const { data } = await supabase.rpc("student_get_notification_channel_preferences");
  const preferences = (data ?? {}) as PreferenceSnapshot;

  return (
    <main className="space-y-5 pb-6">
      <header>
        <Link
          href="/student/perfil"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-zinc-400 transition hover:text-white"
        >
          <span aria-hidden="true">←</span>
          Perfil
        </Link>
        <h1 className="student-page-title mt-3">Notificaciones</h1>
        <p className="student-body mt-2">
          Elige cómo quieres recibir los avisos de {studio.name}.
        </p>
      </header>

      <NotificationChannelPreferences
        studioId={membership.studio_id}
        studioName={studio.name}
        initialPreferences={{
          push_enabled: preferences.push_enabled ?? false,
          whatsapp_enabled: preferences.whatsapp_enabled ?? true,
          email_enabled: preferences.email_enabled ?? false,
        }}
      />
    </main>
  );
}
