import type { SupabaseClient } from "@supabase/supabase-js";

import { parseStudioSupportAccess } from "@/lib/platform/support";

/** NEB-01-17 · Aviso a la dueña mientras soporte de Nébora está dentro de su estudio. */
export default async function SupportAccessNotice({
  supabase,
  studioId,
  timeZone,
}: {
  supabase: SupabaseClient;
  studioId: string;
  timeZone: string;
}) {
  const { data, error } = await supabase.rpc("studio_support_access", { p_studio: studioId });
  if (error) return null;
  const access = parseStudioSupportAccess(data);
  if (!access?.active) return null;
  const time = (value: string) =>
    new Intl.DateTimeFormat("es-MX", { timeZone, hour: "numeric", minute: "2-digit" }).format(
      new Date(value),
    );
  return (
    <p className="admin-billing-notice admin-support-notice" role="status">
      Soporte de Nébora está revisando tu estudio desde las {time(access.active.startedAt)} (hasta
      las {time(access.active.expiresAt)}). Motivo: {access.active.reason}. Todo lo que consulta o
      cambia queda registrado.
    </p>
  );
}
