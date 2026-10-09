import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

async function save(form: FormData) {
  "use server";
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  let templates: unknown;
  try {
    templates = JSON.parse(String(form.get("templates") ?? "{}"));
  } catch {
    redirect("/admin/mas/demi/seguimientos?error=json");
  }
  const { error } = await supabase.rpc("admin_save_demi_followup_settings", {
    p_studio: studio.id,
    p_enabled: form.get("enabled") === "on",
    p_interval: Number(form.get("interval")),
    p_templates: templates,
  });
  redirect(`/admin/mas/demi/seguimientos?${error ? "error=configuracion" : "guardado=1"}`);
}
export default async function Followups({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; guardado?: string }>;
}) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const { data, error } = await supabase
    .from("demi_followup_settings")
    .select("enabled,prospect_interval_hours,templates")
    .eq("studio_id", studio.id)
    .maybeSingle();
  if (error) throw new Error("followup_settings_unavailable");
  const params = await searchParams;
  return (
    <main>
      <Link href="/admin/mas/demi">Volver a Demi</Link>
      <h1>Seguimientos de Demi</h1>
      <p>
        Demi contacta dos veces a prospectos y pruebas pendientes; recupera paquetes e inscripciones
        a los 7, 15 y 30 días y detecta 14 días sin asistencia. Revisa respuestas, reservas, bajas y
        renovaciones antes de cada salida.
      </p>
      {params.error && (
        <p role="alert">No se guardó. Revisa el intervalo y las plantillas aprobadas en Meta.</p>
      )}
      {params.guardado && <p role="status">Configuración guardada.</p>}
      <form action={save}>
        <label>
          <input type="checkbox" name="enabled" defaultChecked={data?.enabled ?? false} />
          Activar seguimientos
        </label>
        <p>
          <label>
            Horas entre contactos a prospectos
            <input
              type="number"
              name="interval"
              min={1}
              max={720}
              required
              defaultValue={data?.prospect_interval_hours ?? 24}
            />
          </label>
        </p>
        <p>
          Para WhatsApp se requieren plantillas aprobadas en Meta. Configura cada mensaje por tipo y
          paso, por ejemplo: {`{"prospect_1":{"name":"seguimiento_prospecto","language":"es_MX"}}`}.
        </p>
        <label>
          Plantillas de WhatsApp
          <textarea
            name="templates"
            rows={15}
            required
            defaultValue={JSON.stringify(data?.templates ?? {}, null, 2)}
          />
        </label>
        <p>
          <button type="submit">Guardar seguimientos</button>
        </p>
      </form>
    </main>
  );
}
