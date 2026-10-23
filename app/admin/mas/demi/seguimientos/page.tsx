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
// NEB-01-37 · Tiempos de los recordatorios, editables por el estudio.
function numberList(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((item) => Number(item));
}

async function saveTimings(form: FormData) {
  "use server";
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const paymentHours = numberList(form.get("payment_hours"));
  const packageDays = numberList(form.get("package_days"));
  const integers = [...paymentHours, ...packageDays].every((item) => Number.isInteger(item));
  if (!integers || !paymentHours.length || !packageDays.length) {
    redirect("/admin/mas/demi/seguimientos?error=tiempos");
  }
  const { error } = await supabase.rpc("admin_save_demi_reminder_timings", {
    p_studio: studio.id,
    p_payment_reminder_hours: paymentHours,
    p_package_reminder_days: packageDays,
    p_inactive_reminder_days: Number(form.get("inactive_days")),
    p_package_expiring_days_before: Number(form.get("expiring_days")),
    p_trial_payment_hold_minutes: Number(form.get("hold_minutes")),
  });
  redirect(`/admin/mas/demi/seguimientos?${error ? "error=tiempos" : "guardado=1"}`);
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
  // Consulta aparte: sin la migración NEB-01-37 la sección de tiempos no aparece.
  const { data: timings, error: timingsError } = await supabase
    .from("demi_followup_settings")
    .select(
      "payment_reminder_hours,package_reminder_days,inactive_reminder_days,package_expiring_days_before,trial_payment_hold_minutes",
    )
    .eq("studio_id", studio.id)
    .maybeSingle();
  const params = await searchParams;
  return (
    <main>
      <Link href="/admin/mas/demi">Volver a Demi</Link>
      <h1>Seguimientos de Demi</h1>
      <p>
        Demi contacta dos veces a prospectos y pruebas pendientes, recuerda pagos pendientes,
        recupera paquetes e inscripciones y detecta alumnas sin asistencia, con los tiempos que
        configures abajo. Revisa respuestas, reservas, bajas y renovaciones antes de cada salida.
      </p>
      {params.error === "tiempos" && (
        <p role="alert">
          No se guardaron los tiempos. Pago: hasta 3 recordatorios de 1 a 168 horas; paquete: hasta
          4 de 1 a 90 días; inactiva: 3 a 90 días; por vencer: 0 a 14 días; apartado: 10 a 1440
          minutos.
        </p>
      )}
      {params.error && params.error !== "tiempos" && (
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
          paso. Para prospectos distingue información, comprobante y datos faltantes con las claves
          prospect_information_1, prospect_awaiting_receipt_1 y prospect_awaiting_participants_1;
          repite con _2 para el segundo seguimiento. Una plantilla genérica no sustituye los
          recordatorios de comprobante o datos. Si la plantilla aprobada tiene una sola variable de
          texto en el cuerpo, usa bind_message_body: true para incluir el mensaje de la etapa
          actual.
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

      {timingsError ? null : (
        <form action={saveTimings}>
          <h2>Tiempos de los recordatorios</h2>
          <p>
            <label>
              Pago pendiente: recordar a las (horas, separadas por coma)
              <input
                name="payment_hours"
                required
                defaultValue={(timings?.payment_reminder_hours ?? [2, 6]).join(", ")}
              />
            </label>
          </p>
          <p>
            <label>
              Paquete o inscripción sin comprar: recordar a los (días, separados por coma)
              <input
                name="package_days"
                required
                defaultValue={(timings?.package_reminder_days ?? [7, 15, 30]).join(", ")}
              />
            </label>
          </p>
          <p>
            <label>
              Alumna inactiva: contactar después de (días sin asistir)
              <input
                type="number"
                name="inactive_days"
                min={3}
                max={90}
                required
                defaultValue={timings?.inactive_reminder_days ?? 14}
              />
            </label>
          </p>
          <p>
            <label>
              Paquete por vencer: avisar (días antes)
              <input
                type="number"
                name="expiring_days"
                min={0}
                max={14}
                required
                defaultValue={timings?.package_expiring_days_before ?? 3}
              />
            </label>
          </p>
          <p>
            <label>
              Primera clase pagada por adelantado: el lugar se guarda (minutos para mandar el
              comprobante)
              <input
                type="number"
                name="hold_minutes"
                min={10}
                max={1440}
                required
                defaultValue={timings?.trial_payment_hold_minutes ?? 30}
              />
            </label>
          </p>
          <p>
            <button type="submit">Guardar tiempos</button>
          </p>
        </form>
      )}
    </main>
  );
}
