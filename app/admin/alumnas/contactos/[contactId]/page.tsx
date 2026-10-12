import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { contactConversations } from "@/lib/student-crm-conversations";
import { channelLabel } from "@/lib/student-crm";
import ContactConversation from "../../ContactConversation";
import { saveContactProfile } from "./actions";

export default async function ContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ contactId: string }>;
  searchParams: Promise<{ view?: string; edit?: string; saved?: string; error?: string }>;
}) {
  const [{ contactId }, query, { supabase, studio, can }] = await Promise.all([
    params,
    searchParams,
    getAdminContext(CAPABILITIES.STUDENTS_READ),
  ]);
  const { data: contact } = await supabase
    .from("crm_contacts")
    .select("id,person_id,converted_student_id,created_at")
    .eq("studio_id", studio.id)
    .eq("id", contactId)
    .maybeSingle();
  if (!contact) notFound();
  if (contact.converted_student_id) redirect(`/admin/alumnas/${contact.converted_student_id}`);
  const [{ data: person }, { data: contacts }, communications] = await Promise.all([
    supabase
      .from("persons")
      .select("first_name,last_name")
      .eq("studio_id", studio.id)
      .eq("id", contact.person_id)
      .maybeSingle(),
    supabase
      .from("person_contacts")
      .select("kind,value,is_primary")
      .eq("studio_id", studio.id)
      .eq("person_id", contact.person_id)
      .order("is_primary", { ascending: false }),
    contactConversations(supabase, studio.id, [], [contact.id], can(CAPABILITIES.SETTINGS_WRITE)),
  ]);
  const name = [person?.first_name, person?.last_name].filter(Boolean).join(" ") || "Prospecto";
  const phone = contacts?.find((item) => item.kind === "phone")?.value;
  const email = contacts?.find((item) => item.kind === "email")?.value;
  const view = query.view && ["summary", "conversation", "operation", "history"].includes(query.view)
    ? query.view
    : "summary";
  const messages = communications.messages.get(contact.id) ?? [];
  const href = (next: string) => `/admin/alumnas/contactos/${contact.id}?view=${next}`;
  return (
    <main className="dashboard-shell crm-page">
      <Link className="crm-back" href="/admin/alumnas">
        ← Contactos
      </Link>
      <header className="crm-contact-person">
        <span className="crm-avatar" aria-hidden="true">
          {name.slice(0, 1)}
        </span>
        <div>
          <h1>
            {name} <span className="crm-pill is-prospect">Prospecto</span>
          </h1>
          <p className="crm-meta">
            {channelLabel(communications.channels.get(contact.id))} ·{" "}
            {phone || "Sin teléfono registrado"}
            {email ? ` · ${email}` : ""}
          </p>
        </div>
      </header>
      {can(CAPABILITIES.STUDENTS_WRITE) && !query.edit ? (
        <p className="crm-profile-edit">
          <Link className="crm-btn" href={"/admin/alumnas/contactos/" + contactId + "?view=" + view + "&edit=1"}>
            Editar información
          </Link>
        </p>
      ) : null}
      {query.saved === "1" ? <p role="status" className="crm-save-status">Información actualizada.</p> : null}
      {can(CAPABILITIES.STUDENTS_WRITE) && query.edit === "1" ? (
        <form action={saveContactProfile} className="crm-card crm-contact-edit">
          <input type="hidden" name="contact_id" value={contactId} />
          <h2>Editar información del prospecto</h2>
          {query.error ? (
            <p role="alert" className="crm-form-error">
              {query.error === "first_name_required" ? "Escribe el nombre." :
                query.error === "phone_invalid" ? "Escribe un teléfono válido de México." :
                query.error === "email_invalid" ? "Revisa el correo electrónico." :
                query.error === "phone_exists" ? "Ese teléfono ya está vinculado a otro contacto." :
                "No se pudo guardar. Revisa los datos e inténtalo de nuevo."}
            </p>
          ) : null}
          <label>Nombre
            <input name="first_name" required maxLength={100} defaultValue={person?.first_name ?? ""} />
          </label>
          <label>Apellidos
            <input name="last_name" maxLength={150} defaultValue={person?.last_name ?? ""} />
          </label>
          <label>Teléfono
            <input name="phone" required inputMode="tel" defaultValue={phone ?? ""} />
          </label>
          <label>Correo electrónico
            <input name="email" type="email" maxLength={254} defaultValue={email ?? ""} />
          </label>
          <div className="crm-contact-edit-actions">
            <button className="crm-btn crm-btn-primary" type="submit">Guardar cambios</button>
            <Link className="crm-btn" href={href(view)}>Cancelar</Link>
          </div>
        </form>
      ) : null}
      <ol className="crm-steps" aria-label="Etapa actual del contacto">
        {["Prospecto", "Prueba", "Alumna", "Exalumna"].map((stage, index) => (
          <li
            key={stage}
            className={index === 0 ? "is-current" : ""}
            aria-current={index === 0 ? "step" : undefined}
          >
            <span className="crm-step-dot" aria-hidden="true" />
            {stage}
          </li>
        ))}
      </ol>
      <nav className="crm-tabs" aria-label="Ficha de contacto">
        {[
          { key: "summary", label: "Resumen" },
          { key: "conversation", label: "Conversación" },
          { key: "operation", label: "Operación" },
          { key: "history", label: "Historial" },
        ].map((tab) => (
          <Link
            key={tab.key}
            href={href(tab.key)}
            className={view === tab.key ? "is-active" : ""}
            aria-current={view === tab.key ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {view === "conversation" ? (
        <ContactConversation
          messages={messages}
          canReadMessages={communications.canReadMessages}
          unavailable={communications.unavailable}
          locale={studio.locale}
          timeZone={studio.timezone}
        />
      ) : null}
      {view === "summary" ? (
        <div className="crm-grid">
          <article className="crm-card">
            <h2>Datos del contacto</h2>
            <div className="crm-info">
              <span>Teléfono</span>
              <strong>{phone || "Sin registrar"}</strong>
            </div>
            <div className="crm-info">
              <span>Correo</span>
              <strong>{email || "Sin registrar"}</strong>
            </div>
            <p className="crm-meta">Este contacto todavía no tiene un expediente de alumna.</p>
          </article>
          <article className="crm-card">
            <h2>Último mensaje</h2>
            <p className="crm-message-excerpt">
              {messages[0]?.content ?? "Sin mensajes disponibles para este contacto."}
            </p>
            <Link className="crm-btn" href={href("conversation")}>
              Ver conversación
            </Link>
          </article>
        </div>
      ) : null}
      {view === "operation" ? (
        <article className="crm-card">
          <h2>Expediente de alumna</h2>
          <p className="crm-meta">
            Este prospecto todavía no tiene inscripción, paquetes ni reservas vinculadas. Revisa sus
            datos antes de darlo de alta.
          </p>
          {can(CAPABILITIES.STUDENTS_WRITE) ? (
            <Link className="crm-btn" href="/admin/alumnas#alta-rapida">
              Ir al alta de alumna
            </Link>
          ) : null}
        </article>
      ) : null}
      {view === "history" ? (
        <article className="crm-card">
          <h2>Historial del contacto</h2>
          <div className="crm-info">
            <span>Contacto registrado</span>
            <strong>
              {new Intl.DateTimeFormat(studio.locale, {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: studio.timezone,
              }).format(new Date(contact.created_at))}
            </strong>
          </div>
        </article>
      ) : null}
    </main>
  );
}
