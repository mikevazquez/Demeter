import Link from "next/link";
import { notFound } from "next/navigation";
import { loadCrm } from "@/lib/crm/data";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { typeLabels, stageLabels, personTypes, nextAction } from "@/lib/crm/demi-state";
import FollowupForm from "../FollowupForm";
import StudentRecord from "../../alumnas/[studentId]/StudentRecord";
import ContactReservations from "../ContactReservations";
import { prepareContactRecord } from "../actions";
import PendingActionButton from "../../components/PendingActionButton";
export default async function ContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ personId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const query = await searchParams;
  const tab = ["summary", "conversation", "activity", "profile", "notes", "followup"].includes(
    query.tab || "",
  )
    ? query.tab!
    : "summary";
  const { personId } = await params;
  const data = await loadCrm();
  const c = data.contacts.find((c) => c.id === personId);
  if (!c) notFound();
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.STUDENTS_READ);
  const { data: history, error } = await supabase
    .from("crm_followup_history")
    .select("id,created_at,before_data,after_data")
    .eq("studio_id", studio.id)
    .eq("person_id", c.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error("crm_history_unavailable");
  const { data: lifecycleHistory, error: lifecycleError } = await supabase
    .from("crm_lifecycle_history")
    .select("id,from_type,to_type,inactivity_days,inactive_since,changed_at")
    .eq("studio_id", studio.id)
    .eq("person_id", c.id)
    .order("changed_at", { ascending: false })
    .limit(50);
  if (lifecycleError) throw new Error("crm_lifecycle_history_unavailable");
  const { data: threads, error: threadError } = await supabase
    .from("assistant_conversations")
    .select("id,student_id,crm_conversation_id,channel")
    .eq("studio_id", studio.id);
  if (threadError) throw new Error("crm_threads_unavailable");
  const threadIds = (threads || [])
    .filter(
      (t) =>
        (c.studentId && t.student_id === c.studentId) ||
        c.conversations.some((v) => v.id === t.crm_conversation_id),
    )
    .map((t) => t.id);
  const turnsResult = threadIds.length
    ? await supabase
        .from("assistant_turns")
        .select("id,direction,content,created_at")
        .eq("studio_id", studio.id)
        .in("conversation_id", threadIds)
        .in("role", ["user", "assistant"])
        .order("created_at", { ascending: false })
        .limit(100)
    : { data: [], error: null };
  if (turnsResult.error) throw new Error("crm_messages_unavailable");

  const base = `/admin/crm/${c.id}`;
  const qual = { pending: "Pendiente", qualified: "Apta", not_qualified: "No apta" }[
    c.state.qualification
  ];
  const profileView = query.view ?? "profile";
  const contactSections = [
    { key: "summary", label: "Resumen", href: `${base}?tab=summary` },
    { key: "conversation", label: "Conversación", href: `${base}?tab=conversation` },
    { key: "followup", label: "Seguimiento", href: `${base}?tab=followup` },
    { key: "profile", label: c.studentId ? "Expediente" : "Datos", href: `${base}?tab=profile` },
    { key: "activity", label: "Actividad", href: `${base}?tab=activity` },
    { key: "notes", label: "Notas", href: `${base}?tab=notes` },
  ];
  const profileSections = [
    { key: "summary", label: "Resumen" },
    { key: "packages", label: "Paquetes" },
    { key: "rewards", label: "Progreso" },
    ...(can(CAPABILITIES.EVALUATIONS_READ) ? [{ key: "evaluations", label: "Evaluaciones" }] : []),
    ...(can(CAPABILITIES.DOCUMENTS_READ) ? [{ key: "documents", label: "Documentos" }] : []),
    { key: "history", label: "Historial" },
    { key: "profile", label: "Datos" },
  ];
  return (
    <>
      <Link className="crm-back" href="/admin/crm">
        ← Contactos
      </Link>
      <header className="crm-heading">
        <div className="crm-contact-title">
          <span className="crm-avatar">
            {c.name
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((n) => n[0])
              .join("")}
          </span>
          <div>
            <h1>{c.name}</h1>
            <p>
              {c.channel} · {c.phone || "Sin teléfono"}
              {c.followup.location && ` · ${c.followup.location}`}
            </p>
            {c.followup.interest && <p>{c.followup.interest}</p>}
          </div>
        </div>
        <span className={`crm-badge ${c.state.qualification}`}>{qual}</span>
      </header>
      {query.error && (
        <p role="alert" className="notice error">
          {query.error.includes("session_not_started")
            ? "La clase todavía no comienza."
            : query.error.includes("session_ended")
              ? "La clase ya terminó; revisa el cierre de asistencia."
              : "No se pudo guardar el cambio. Revisa los datos y los permisos."}
        </p>
      )}
      {query.created && (
        <p role="status" className="notice success">
          Asistencia registrada. El historial se conservó.
        </p>
      )}
      <div className="crm-contact-actions">
        <Link className="crm-secondary" href={`${base}?tab=followup`}>
          Gestionar estado y seguimiento
        </Link>
        {c.studentId && data.canEdit && (
          <Link className="crm-secondary" href={`${base}?tab=profile&view=profile`}>
            Editar datos
          </Link>
        )}
      </div>
      <div className="crm-journey" aria-label="Recorrido del contacto">
        {personTypes.map((t) => (
          <span key={t} className={!c.reviewReason && c.state.personType === t ? "current" : ""}>
            {typeLabels[t]}
          </span>
        ))}
      </div>
      <section className="crm-panel crm-state-bar">
        <div>
          <strong>{c.reviewReason ? "Por verificar" : typeLabels[c.state.personType]}</strong> ·{" "}
          {c.reviewReason || stageLabels[c.state.stage]}
        </div>
        <span className="crm-badge">
          Pago:{" "}
          {
            {
              none: "Sin registro",
              awaiting_receipt: "Espera de comprobante",
              under_review: "En revisión",
              validated: "Validado",
              rejected: "Rechazado",
              cash_due: "Efectivo pendiente",
            }[c.state.payment]
          }
        </span>
        <span className="crm-badge">
          Paquete: {{ none: "Sin paquete", active: "Vigente", expired: "Vencido" }[c.state.package]}
        </span>
        <p className="crm-help">
          Próxima acción:{" "}
          {c.reviewReason
            ? "Verificar inscripción"
            : c.state.human ||
                c.state.qualification === "not_qualified" ||
                c.state.stage === "not_booked"
              ? nextAction(c.state)
              : c.followup.next_action || nextAction(c.state)}
          {c.followup.next_action_on && ` · ${c.followup.next_action_on}`}
        </p>
        {c.state.qualification === "not_qualified" && (
          <p className="crm-paused">Seguimiento pausado · {c.followup.qualification_reason}</p>
        )}
      </section>
      {c.studentId && (
        <ContactReservations
          studentId={c.studentId}
          personId={c.id}
          trial={c.state.stage === "scheduled"}
        />
      )}
      <nav className="crm-tabs" aria-label="Secciones del contacto">
        {contactSections.map((item) => {
          const active = tab === item.key;
          return (
            <Link key={item.key} href={item.href} aria-current={active ? "page" : undefined}>
              {item.label}
            </Link>
          );
        })}
      </nav>
      {tab === "summary" &&
        (c.studentId ? (
          <StudentRecord
            params={Promise.resolve({ studentId: c.studentId })}
            searchParams={Promise.resolve({ ...query, view: "summary" })}
            crmHref={base}
            hideNavigation
            crmPersonType={c.state.personType}
            suggestedChannel={c.lastChannel}
            recommendationPaused={Boolean(
              c.state.human || c.state.qualification === "not_qualified",
            )}
          />
        ) : (
          <section className="crm-panel">
            <h2>Resumen del contacto</h2>
            <dl className="crm-profile-facts">
              {[
                ["Etapa", typeLabels[c.state.personType]],
                ["Estado", stageLabels[c.state.stage]],
                ["Canal de origen", c.channel],
                ["Teléfono", c.phone],
                ["Interés", c.followup.interest],
                ["Próxima acción", c.followup.next_action || nextAction(c.state)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value || "Sin registrar"}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      {tab === "profile" && c.studentId && (
        <nav className="crm-profile-nav" aria-label="Secciones del expediente">
          {profileSections.map((item) => (
            <Link
              key={item.key}
              href={`${base}?tab=profile&view=${item.key}`}
              aria-current={profileView === item.key ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
      {tab === "conversation" && (
        <section className="crm-panel">
          <h2>Conversaciones</h2>
          {turnsResult.data
            ?.slice()
            .reverse()
            .map((t) => (
              <article className={`crm-message ${t.direction}`} key={t.id}>
                <small>
                  {t.direction === "inbound" ? c.name : "Demi"} ·{" "}
                  {new Date(t.created_at).toLocaleString("es-MX", { timeZone: studio.timezone })}
                </small>
                <p>{t.content}</p>
              </article>
            ))}
          {c.conversations.length ? (
            c.conversations.map((v) => (
              <div className="crm-history-item" key={v.id}>
                <strong>{v.channel}</strong>
                <p>
                  {v.count} actividades ·{" "}
                  {new Date(v.at).toLocaleString("es-MX", { timeZone: studio.timezone })}
                </p>
              </div>
            ))
          ) : turnsResult.data?.length ? null : (
            <p>Sin conversaciones vinculadas.</p>
          )}
          <p className="crm-help">
            Solo se muestran conversaciones registradas y vinculadas. No se envían mensajes desde
            esta ficha.
          </p>
        </section>
      )}
      {tab === "followup" && (
        <section className="crm-panel">
          <FollowupForm contact={c} canEdit={data.canEdit} />
        </section>
      )}
      {tab === "notes" && (
        <section className="crm-panel">
          <FollowupForm contact={c} canEdit={data.canEdit} notesOnly />
        </section>
      )}
      {tab === "profile" && (
        <>
          {!c.studentId && (
            <section className="crm-panel">
              <h2>Datos del contacto</h2>
              <dl className="crm-profile-facts">
                {[
                  ["Nombre", c.name],
                  ["Teléfono", c.phone],
                  ["Correo", c.email],
                  ["Canal de origen", c.channel],
                  ["Último canal", c.lastChannel],
                  ["Ubicación", c.followup.location],
                  ["Interés", c.followup.interest],
                  ["Calificación", qual],
                  [
                    "Fecha de ingreso",
                    new Date(c.joinedAt).toLocaleDateString("es-MX", { timeZone: studio.timezone }),
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value || "Sin registrar"}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {!c.studentId && data.canEdit && (
            <section className="crm-panel">
              <h2>Completar expediente</h2>
              <p className="crm-help">
                Habilita los datos personales, paquetes, documentos y reservas sobre esta misma
                persona. El tipo permanece Prospecto hasta registrar su prueba.
              </p>
              <form action={prepareContactRecord.bind(null, c.id)}>
                <PendingActionButton className="crm-primary" pendingLabel="Preparando…">
                  Habilitar expediente operativo
                </PendingActionButton>
              </form>
            </section>
          )}
          {c.studentId ? (
            <StudentRecord
              params={Promise.resolve({ studentId: c.studentId })}
              searchParams={Promise.resolve({ ...query, view: profileView })}
              crmHref={base}
              hideNavigation
              crmPersonType={c.state.personType}
              suggestedChannel={c.lastChannel}
              recommendationPaused={Boolean(
                c.state.human || c.state.qualification === "not_qualified",
              )}
            />
          ) : (
            <section className="crm-panel">
              <FollowupForm contact={c} canEdit={data.canEdit} />
            </section>
          )}
        </>
      )}
      {tab === "activity" && (
        <>
          <section className="crm-panel crm-history">
            <h2>Historial de etapa</h2>
            {lifecycleHistory?.length ? (
              lifecycleHistory.map((item) => (
                <article className="crm-history-item" key={item.id}>
                  <strong>
                    {new Date(item.changed_at).toLocaleString("es-MX", {
                      timeZone: studio.timezone,
                    })}
                  </strong>
                  <p>
                    {typeLabels[item.from_type as keyof typeof typeLabels]} →{" "}
                    {typeLabels[item.to_type as keyof typeof typeLabels]} · {item.inactivity_days}{" "}
                    días sin paquete activo (desde {item.inactive_since})
                  </p>
                </article>
              ))
            ) : (
              <p>Todavía no hay cambios de tipo por inactividad.</p>
            )}
          </section>
          <section className="crm-panel crm-history">
            <h2>Historial de seguimiento</h2>
            {history?.length ? (
              history.map((h) => {
                const a = h.after_data as Record<string, string>;
                const before = h.before_data as Record<string, string> | null;
                return (
                  <article className="crm-history-item" key={h.id}>
                    <strong>
                      {new Date(h.created_at).toLocaleString("es-MX", {
                        timeZone: studio.timezone,
                      })}
                    </strong>
                    <p>
                      {before ? "Actualización de seguimiento" : "Primer seguimiento registrado"} ·{" "}
                      {a.qualification === "not_qualified"
                        ? "No apta"
                        : a.qualification === "qualified"
                          ? "Apta"
                          : "Pendiente"}
                    </p>
                    {a.qualification_reason && <p>{a.qualification_reason}</p>}
                    <details>
                      <summary>Ver cambios</summary>
                      {Object.keys(a)
                        .filter(
                          (k) =>
                            !["studio_id", "person_id", "updated_at", "revision"].includes(k) &&
                            String(before?.[k] ?? "") !== String(a[k] ?? ""),
                        )
                        .map((k) => (
                          <p key={k}>
                            {(
                              {
                                notes: "Notas",
                                location: "Ubicación",
                                interest: "Interés",
                                next_action: "Próxima acción",
                                next_action_on: "Fecha",
                                prospect_stage: "Etapa",
                                qualification: "Calificación",
                                qualification_reason: "Motivo",
                                human_reason: "Atención humana",
                                human_summary: "Resumen",
                              } as Record<string, string>
                            )[k] || k}
                            : {before?.[k] || "—"} → {a[k] || "—"}
                          </p>
                        ))}
                    </details>
                  </article>
                );
              })
            ) : (
              <p>Todavía no hay cambios de seguimiento.</p>
            )}
          </section>

          {c.studentId && (
            <StudentRecord
              params={Promise.resolve({ studentId: c.studentId })}
              searchParams={Promise.resolve({ ...query, view: "history" })}
              crmHref={base}
              hideNavigation
              crmPersonType={c.state.personType}
              suggestedChannel={c.lastChannel}
              recommendationPaused={Boolean(
                c.state.human || c.state.qualification === "not_qualified",
              )}
            />
          )}
        </>
      )}
    </>
  );
}
