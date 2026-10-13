import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { scheduleProspectTrial } from "./actions";

const errorCopy: Record<string, string> = {
  payment_method_required: "Selecciona cómo pagó la primera clase.",
  trial_not_eligible: "Este prospecto ya no puede reservar una primera clase.",
  session_full: "La clase se llenó. Elige otra sesión.",
  already_reserved: "Este prospecto ya tiene una reserva activa.",
  session_not_bookable: "La clase ya no admite reservas.",
  forbidden: "Tu usuario no tiene permiso para agendar esta clase.",
};

export default async function ScheduleProspectTrialPage({
  params,
  searchParams,
}: {
  params: Promise<{ contactId: string }>;
  searchParams: Promise<{ error?: string; created?: string }>;
}) {
  const [{ contactId }, query, { supabase, studio, can }] = await Promise.all([
    params,
    searchParams,
    getAdminContext(CAPABILITIES.SCHEDULE_READ),
  ]);
  const { data: contact } = await supabase
    .from("crm_contacts")
    .select("id,person_id,converted_student_id")
    .eq("id", contactId)
    .eq("studio_id", studio.id)
    .maybeSingle();
  if (!contact) notFound();
  if (contact.converted_student_id) redirect(`/admin/alumnas/${contact.converted_student_id}`);

  const [{ data: person }, { data: sessions }] = await Promise.all([
    supabase
      .from("persons")
      .select("first_name,last_name")
      .eq("id", contact.person_id)
      .eq("studio_id", studio.id)
      .maybeSingle(),
    supabase
      .from("class_sessions")
      .select("id,template_id,starts_at,ends_at,capacity")
      .eq("studio_id", studio.id)
      .eq("status", "scheduled")
      .gt("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(40),
  ]);
  const templateIds = [...new Set((sessions ?? []).map((item) => item.template_id))];
  const { data: templates } = templateIds.length
    ? await supabase
        .from("class_templates")
        .select("id,name,drop_in_price_minor")
        .eq("studio_id", studio.id)
        .in("id", templateIds)
    : { data: [] as { id: string; name: string; drop_in_price_minor: number | null }[] };
  const templateMap = new Map((templates ?? []).map((item) => [item.id, item]));
  const name = [person?.first_name, person?.last_name].filter(Boolean).join(" ") || "Prospecto";
  const dateTime = new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZone: studio.timezone ?? "America/Mexico_City",
  });

  return (
    <main className="dashboard-shell crm-page">
      <header className="topbar">
        <div>
          <Link
            className="back-link compact"
            href={`/admin/alumnas/contactos/${contact.id}?view=operation`}
          >
            ← Ficha del prospecto
          </Link>
          <p className="eyebrow">PRIMERA CLASE</p>
          <h1 className="dashboard-title">Agendar a {name}</h1>
          <p>Elige una sesión y registra el método de pago indicado.</p>
        </div>
      </header>

      {query.error ? (
        <div className="notice error">
          {errorCopy[query.error] ?? "No se pudo agendar. Revisa la clase e inténtalo de nuevo."}
        </div>
      ) : null}
      {query.created ? (
        <div className="notice success">
          Primera clase agendada. El pago quedó pendiente de registrar/validar en el flujo de pagos.
          {query.created === "bank_transfer"
            ? " La transferencia requiere revisión."
            : " Método indicado: efectivo."}
        </div>
      ) : null}

      <section className="panel">
        <h2>Selecciona la clase</h2>
        {!sessions?.length ? <p>No hay clases próximas disponibles para agendar.</p> : null}
        <form action={scheduleProspectTrial} className="grid gap-4">
          <input type="hidden" name="contact_id" value={contact.id} />
          <label className="grid gap-2 font-semibold">
            Clase
            <select
              name="session_id"
              required
              defaultValue=""
              className="min-h-12 rounded-xl border px-3"
            >
              <option value="" disabled>
                Selecciona una sesión
              </option>
              {(sessions ?? []).map((session) => {
                const template = templateMap.get(session.template_id);
                return (
                  <option key={session.id} value={session.id}>
                    {template?.name ?? "Clase"} · {dateTime.format(new Date(session.starts_at))}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="grid gap-2 font-semibold">
            ¿Cómo pagó esta clase?
            <select
              name="payment_method"
              required
              defaultValue=""
              className="min-h-12 rounded-xl border px-3"
            >
              <option value="" disabled>
                Selecciona el método de pago
              </option>
              <option value="cash">Efectivo</option>
              <option value="bank_transfer">Transferencia (pendiente de revisión)</option>
            </select>
          </label>
          <p className="muted">
            Selecciona el método reportado. El pago queda pendiente de registro; si fue
            transferencia, también de revisión.
          </p>
          <button
            className="primary-button"
            type="submit"
            disabled={
              !can(CAPABILITIES.SCHEDULE_WRITE) ||
              !can(CAPABILITIES.STUDENTS_WRITE) ||
              !sessions?.length
            }
          >
            Agendar primera clase
          </button>
        </form>
      </section>
    </main>
  );
}
