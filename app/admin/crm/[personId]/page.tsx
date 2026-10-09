import Link from "next/link";
import { notFound } from "next/navigation";
import { loadCrm } from "@/lib/crm/data";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { typeLabels, stageLabels, personTypes, nextAction } from "@/lib/crm/demi-state";
import FollowupForm from "../FollowupForm";
export default async function ContactPage({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  const data = await loadCrm();
  const c = data.contacts.find((c) => c.id === personId);
  if (!c) notFound();
  const { supabase, studio } = await getAdminContext(CAPABILITIES.STUDENTS_READ);
  const { data: history, error } = await supabase
    .from("crm_followup_history")
    .select("id,created_at,before_data,after_data")
    .eq("studio_id", studio.id)
    .eq("person_id", c.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error("crm_history_unavailable");
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

  return (
    <>
      <Link className="crm-back" href="/admin/crm">
        ← Contactos
      </Link>
      <header className="crm-heading">
        <div>
          <span className="crm-eyebrow">FICHA DEL CONTACTO</span>
          <h1>{c.name}</h1>
          <p>
            {c.phone || "Sin teléfono"} {c.email && `· ${c.email}`}
          </p>
        </div>
        <span className={`crm-badge ${c.state.personType}`}>{typeLabels[c.state.personType]}</span>
      </header>
      <div className="crm-journey" aria-label="Recorrido del contacto">
        {personTypes.map((t) => (
          <span key={t} className={c.state.personType === t ? "current" : ""}>
            {typeLabels[t]}
          </span>
        ))}
      </div>
      <div className="crm-detail-grid">
        <section className="crm-panel">
          <h2>Estado actual</h2>
          <dl className="crm-facts">
            <div>
              <dt>Etapa</dt>
              <dd>{stageLabels[c.state.stage]}</dd>
            </div>
            <div>
              <dt>Canal de origen</dt>
              <dd>{c.channel}</dd>
            </div>
            <div>
              <dt>Paquete</dt>
              <dd>
                {{ none: "Sin paquete", active: "Vigente", expired: "Vencido" }[c.state.package]}
              </dd>
            </div>
            <div>
              <dt>Próxima acción</dt>
              <dd>
                {c.state.human ||
                c.state.qualification === "not_qualified" ||
                c.state.stage === "not_booked"
                  ? nextAction(c.state)
                  : c.followup.next_action || nextAction(c.state)}
              </dd>
            </div>
          </dl>
          <p className="crm-help">
            El tipo se actualiza con la inscripción y la prueba registradas en Studio Flow. Un
            paquete vencido conserva el tipo Alumna mientras la inscripción siga vigente.
          </p>
          {c.studentId && (
            <Link className="crm-back" href={`/admin/alumnas/${c.studentId}`}>
              Abrir perfil operativo →
            </Link>
          )}
          <div className="crm-facts">
            <div>
              <dt>Pago de inscripción</dt>
              <dd>
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
              </dd>
            </div>
          </div>
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
          ) : (
            <p>Sin conversaciones vinculadas.</p>
          )}
          <p className="crm-help">
            Solo se muestran conversaciones registradas y vinculadas. No se envían mensajes desde
            esta ficha.
          </p>
        </section>
        <section className="crm-panel">
          <FollowupForm contact={c} canEdit={data.canEdit} />
        </section>
      </div>
      <section className="crm-panel crm-history">
        <h2>Historial de seguimiento</h2>
        {history?.length ? (
          history.map((h) => {
            const a = h.after_data as Record<string, string>;
            const before = h.before_data as Record<string, string> | null;
            return (
              <article className="crm-history-item" key={h.id}>
                <strong>
                  {new Date(h.created_at).toLocaleString("es-MX", { timeZone: studio.timezone })}
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
    </>
  );
}
