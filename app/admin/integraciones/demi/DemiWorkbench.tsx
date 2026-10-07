"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MAX_PROMPT_LENGTH,
  promptWorkbenchError,
  type PromptVersion,
  type TestPersona,
} from "@/lib/assistant/prompt-workbench";
import { saveDemiPrompt, activateDemiPrompt, testDemiPrompt, setDemiHandoffPolicy, reviewDemiLearning, proposeDemiAdminChange, applyDemiAdminChange, rejectDemiAdminChange } from "./workbench-actions";

type Message = { role: "user" | "assistant"; content: string };
type HandoffPolicy = { id:string; reason_code:string; label:string; description:string; enabled:boolean; blocking:boolean; sort_order:number };
type LearningProposal = { id:string; title:string; evidence:string; proposed_instruction:string; status:string; created_at:string };
type AdminPlanAction = { type:string; label:string; [key:string]:unknown };
type AdminPlan = { summary:string; requires_development:boolean; development_reason:string|null; actions:AdminPlanAction[] };
type AdminChange = { id:string; instruction:string; summary:string; plan:AdminPlan; status:string; error_code?:string|null; created_at:string; applied_at?:string|null };

export default function DemiWorkbench({
  assistantName,
  activeInstructions,
  versions,
  openAIConfigured,
  storageReady,
  sandbox,
  handoffPolicies,
  learningProposals,
  adminChanges,
}: {
  assistantName: string;
  activeInstructions: string;
  versions: PromptVersion[];
  openAIConfigured: boolean;
  storageReady: boolean;
  sandbox: boolean;
  handoffPolicies: HandoffPolicy[];
  learningProposals: LearningProposal[];
  adminChanges: AdminChange[];
}) {
  const router = useRouter();
  const initial = versions[0]?.kind === "draft" ? versions[0] : null;
  const [tab, setTab] = useState<"configure" | "instructions" | "improve" | "test" | "learning" | "handoff">("configure");
  const [draft, setDraft] = useState(initial?.instructions ?? activeInstructions);
  const [saved, setSaved] = useState(initial);
  const [history, setHistory] = useState(versions);
  const [note, setNote] = useState("");
  const [goal, setGoal] = useState("");
  const [proposal, setProposal] = useState<string | null>(null);
  const [proposalSource, setProposalSource] = useState("");
  const [persona, setPersona] = useState<TestPersona>("prospect");
  const [messages, setMessages] = useState<Message[]>([]);
  const [message, setMessage] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [reviewActivation, setReviewActivation] = useState(false);
  const [adminInstruction, setAdminInstruction] = useState("");
  const [adminRequest, setAdminRequest] = useState<AdminChange | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages, busy]);

  function clearTest() {
    setConversationId(null);
    setMessages([]);
    setMessage("");
  }
  function edit(value: string) {
    setDraft(value);
    setProposal(null);
    setReviewActivation(false);
    clearTest();
    setNotice("");
  }
  async function perform(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch {
      setError(promptWorkbenchError("request_failed"));
    } finally {
      setBusy(false);
    }
  }
  const hasSavedDraft = saved?.instructions === draft;
  const changed = draft !== activeInstructions;

  return (
    <section className="demi-workbench">
      <div className="dw-status">
        <span>🤖 {assistantName}</span>
        <span className="dw-badge">{sandbox ? "Sandbox" : "Configuración"}</span>
      </div>
      <nav className="dw-tabs" aria-label="Configuración de Demi">
        {(
          [
            ["configure", "⚙️ Configurar con Demi"],
            ["instructions", "✍️ Instrucciones"],
            ["improve", "✨ Mejorar con IA"],
            ["test", "💬 Probar a Demi"],
            ["learning", "🧠 Aprendizaje"],
            ["handoff", "👤 Atención humana"],
          ] as const
        ).map(([key, label]) => (
          <button type="button" key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>
      <div aria-live="polite">
        {notice && <p className="dw-success">{notice}</p>}
        {error && (
          <p role="alert" className="dw-error">
            {error}
          </p>
        )}
      </div>
      {!storageReady && (
        <p className="dw-error">Falta preparar el guardado de instrucciones en este entorno.</p>
      )}

      {tab === "configure" && (
        <div className="dw-content">
          <header>
            <h2>Dile a Demi qué quieres cambiar</h2>
          </header>
          <label htmlFor="demi-admin-instruction">Instrucción administrativa</label>
          <textarea
            id="demi-admin-instruction"
            value={adminInstruction}
            onChange={(event) => {
              setAdminInstruction(event.target.value);
              setAdminRequest(null);
            }}
            maxLength={4000}
            rows={5}
            disabled={busy}
            placeholder="Ej. A partir de ahora los prospectos deben pagar su primera clase antes de que Demi les reserve un lugar."
          />
          <div className="dw-actions">
            <button
              className="dw-primary"
              type="button"
              disabled={busy || !adminInstruction.trim() || !openAIConfigured || !storageReady}
              onClick={() =>
                perform(async () => {
                  const result = await proposeDemiAdminChange(adminInstruction);
                  if (!result.ok) return setError(promptWorkbenchError(result.error));
                  setAdminRequest(result.request as AdminChange);
                  setNotice("Cambio analizado. Revísalo antes de aplicarlo.");
                })
              }
            >
              {busy ? "Analizando…" : "✨ Preparar cambio"}
            </button>
          </div>

          {adminRequest && (
            <section className="dw-admin-plan">
              <div className="dw-admin-plan-head">
                <div>
                  <small>Plan propuesto</small>
                  <h3>{adminRequest.summary}</h3>
                </div>
                <span className={adminRequest.plan.requires_development ? "dw-plan-badge is-warning" : "dw-plan-badge"}>
                  {adminRequest.plan.requires_development ? "Requiere desarrollo" : "Listo para aplicar"}
                </span>
              </div>
              {adminRequest.plan.requires_development && (
                <p className="dw-plan-warning">
                  {adminRequest.plan.development_reason || "Parte de esta instrucción todavía no está parametrizada en Studio Flow."}
                </p>
              )}
              <div className="dw-admin-actions-list">
                {adminRequest.plan.actions.map((action, index) => (
                  <article key={index}>
                    <span>✓</span>
                    <div><strong>{action.label}</strong><small>{action.type.replaceAll("_", " ")}</small></div>
                  </article>
                ))}
                {!adminRequest.plan.actions.length && <p className="dw-hint">No hay cambios automáticos seguros para aplicar.</p>}
              </div>
              <div className="dw-actions">
                <button
                  className="dw-primary"
                  type="button"
                  disabled={busy || adminRequest.plan.requires_development || !adminRequest.plan.actions.length}
                  onClick={() =>
                    perform(async () => {
                      const result = await applyDemiAdminChange(adminRequest.id);
                      if (!result.ok) return setError(promptWorkbenchError(result.error));
                      setNotice("Cambios aplicados. Demi ya usará la nueva configuración.");
                      setAdminInstruction("");
                      setAdminRequest(null);
                      router.refresh();
                    })
                  }
                >
                  Aplicar cambios
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    perform(async () => {
                      const result = await rejectDemiAdminChange(adminRequest.id);
                      if (!result.ok) return setError(promptWorkbenchError(result.error));
                      setAdminRequest(null);
                      setNotice("Propuesta descartada.");
                      router.refresh();
                    })
                  }
                >
                  Descartar
                </button>
              </div>
            </section>
          )}

          <details className="dw-history" open>
            <summary>Historial de cambios ({adminChanges.length})</summary>
            <p>Cada instrucción queda registrada con su resultado.</p>
            {adminChanges.map((change) => (
              <article key={change.id}>
                <div>
                  <strong>{change.instruction}</strong>
                  <small>{new Date(change.created_at).toLocaleString("es-MX")} · {change.status === "applied" ? "Aplicado" : change.status === "proposed" ? "Pendiente" : change.status === "rejected" ? "Descartado" : "Falló"}</small>
                  <p>{change.summary}</p>
                </div>
              </article>
            ))}
            {!adminChanges.length && <p className="dw-hint">Todavía no hay cambios hechos desde el portal.</p>}
          </details>
        </div>
      )}

      {tab === "instructions" && (
        <div className="dw-content">
          <header>
            <h2>Cómo debe comportarse Demi</h2>
            <p>Define su tono, cómo responde y cómo guía la conversación.</p>
          </header>
          <label htmlFor="demi-prompt">Instrucciones del asistente</label>
          <textarea
            id="demi-prompt"
            className="dw-prompt"
            value={draft}
            onChange={(event) => edit(event.target.value)}
            maxLength={MAX_PROMPT_LENGTH}
            disabled={busy}
            placeholder="Eres Demi, asistente de Demeter…"
          />
          <div className="dw-meta">
            <span>{draft.length.toLocaleString("es-MX")} / 24,000</span>
            <span>
              {hasSavedDraft
                ? "Borrador guardado"
                : changed
                  ? "Cambios sin guardar"
                  : "Versión activa"}
            </span>
          </div>
          <p className="dw-hint">
            Guardar un borrador conserva las respuestas actuales de Demi. Los precios, cupos y pagos
            se validan en Studio Flow.
          </p>
          <label htmlFor="demi-note">
            Nota del cambio <span>(opcional)</span>
          </label>
          <input
            id="demi-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            disabled={busy}
            placeholder="Ej. Respuestas más breves para prospectos"
          />
          <div className="dw-actions">
            <button
              className="dw-primary"
              type="button"
              disabled={busy || !storageReady || !draft.trim()}
              onClick={() =>
                perform(async () => {
                  const result = await saveDemiPrompt(draft, note);
                  if (!result.ok) return setError(promptWorkbenchError(result.error));
                  const version = result.version as PromptVersion;
                  setSaved(version);
                  setHistory((rows) => [version, ...rows]);
                  setNotice("Borrador guardado. La versión activa sigue igual.");
                  setNote("");
                })
              }
            >
              Guardar borrador
            </button>
            <button type="button" onClick={() => setTab("test")} disabled={busy}>
              Probar este borrador
            </button>
            <button
              type="button"
              disabled={busy || !hasSavedDraft || !changed || !storageReady}
              onClick={() => setReviewActivation(true)}
            >
              {sandbox ? "Activar en sandbox" : "Activar versión"}
            </button>
          </div>
          {reviewActivation && (
            <section className="dw-activation">
              <h3>Revisar activación</h3>
              <p>
                {sandbox
                  ? "Demi usará estas instrucciones únicamente en sandbox."
                  : "Demi usará estas instrucciones en las conversaciones nuevas y en el siguiente mensaje de las conversaciones en curso."}
              </p>
              <details>
                <summary>Ver instrucciones que se activarán</summary>
                <pre>{draft}</pre>
              </details>
              <div className="dw-actions">
                <button
                  className="dw-primary"
                  disabled={busy || !hasSavedDraft}
                  type="button"
                  onClick={() =>
                    perform(async () => {
                      if (!saved) return;
                      const result = await activateDemiPrompt(saved.id, activeInstructions);
                      if (!result.ok) return setError(promptWorkbenchError(result.error));
                      setReviewActivation(false);
                      setNotice("Versión activada.");
                      router.refresh();
                    })
                  }
                >
                  Confirmar activación
                </button>
                <button type="button" onClick={() => setReviewActivation(false)} disabled={busy}>
                  Volver al borrador
                </button>
              </div>
            </section>
          )}
          <details className="dw-history">
            <summary>Versión activa</summary>
            <pre>{activeInstructions || "Sin instrucciones personalizadas."}</pre>
          </details>
          <details className="dw-history">
            <summary>Historial de versiones ({history.length})</summary>
            <p>Restaurar copia una versión al editor; después puedes guardarla y probarla.</p>
            {history.map((version) => (
              <article key={version.id}>
                <div>
                  <strong>
                    {version.kind === "draft"
                      ? "Borrador"
                      : version.kind === "activation"
                        ? "Activación"
                        : "Versión inicial"}
                  </strong>
                  <small>{new Date(version.created_at).toLocaleString("es-MX")}</small>
                  <p>{version.note || "Sin nota"}</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    edit(version.instructions);
                    setSaved(null);
                    setNotice("Versión restaurada al editor. Guárdala como un nuevo borrador.");
                  }}
                >
                  Restaurar
                </button>
              </article>
            ))}
          </details>
        </div>
      )}

      {tab === "improve" && (
        <div className="dw-content">
          <header>
            <h2>Mejorar las instrucciones</h2>
            <p>Explica qué quieres cambiar. La IA propondrá una nueva versión del borrador.</p>
          </header>
          <label htmlFor="demi-goal">¿Qué quieres mejorar?</label>
          <textarea
            id="demi-goal"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            maxLength={2000}
            disabled={busy}
            placeholder="Hace demasiadas preguntas. Quiero que responda primero lo que le preguntan y sea más breve."
            rows={4}
          />
          <button
            className="dw-primary"
            type="button"
            disabled={busy || !goal.trim() || !draft.trim() || !openAIConfigured || !storageReady}
            onClick={() =>
              perform(async () => {
                setProposal(null);
                const source = draft;
                const result = await testDemiPrompt({
                  instructions: source,
                  message: goal,
                  persona,
                  improve: true,
                });
                if (!result.ok) return setError(promptWorkbenchError(result.error));
                setProposalSource(source);
                setProposal(result.reply);
              })
            }
          >
            {busy ? "Preparando propuesta…" : "✨ Generar mejora"}
          </button>
          {!openAIConfigured && (
            <p className="dw-hint">Falta configurar la conexión con IA en este entorno.</p>
          )}
          <p className="dw-hint">
            Revisa la propuesta antes de usarla. Esta acción consume IA y respeta los límites de
            Demi.
          </p>
          {proposal && (
            <section className="dw-proposal">
              <h3>Propuesta de instrucciones</h3>
              <div className="dw-compare">
                <details>
                  <summary>Antes</summary>
                  <pre>{proposalSource}</pre>
                </details>
                <div>
                  <strong>Propuesta</strong>
                  <pre>{proposal}</pre>
                </div>
              </div>
              <div className="dw-actions">
                <button
                  className="dw-primary"
                  type="button"
                  onClick={() => {
                    edit(proposal);
                    setTab("instructions");
                    setNotice("Mejora aplicada al editor. Falta guardar el borrador.");
                  }}
                >
                  Usar en el borrador
                </button>
                <button type="button" onClick={() => setProposal(null)}>
                  Descartar propuesta
                </button>
              </div>
            </section>
          )}
        </div>
      )}

      {tab === "learning" && (
        <div className="dw-content">
          <header><h2>Aprendizajes propuestos</h2><p>Demi puede detectar correcciones, pero nunca cambia sus reglas sola. Tú decides qué incorporar.</p></header>
          {!learningProposals.length && <p className="dw-hint">Todavía no hay aprendizajes pendientes o revisados.</p>}
          <div className="dw-settings-list">
            {learningProposals.map((item) => <article key={item.id} className="dw-setting-card">
              <div><strong>{item.title}</strong><small>{new Date(item.created_at).toLocaleString("es-MX")} · {item.status === "pending" ? "Pendiente" : item.status === "approved" ? "Aprobado" : "Rechazado"}</small>
              {item.evidence && <p>{item.evidence}</p>}<p><b>Propuesta:</b> {item.proposed_instruction}</p></div>
              {item.status === "pending" && <div className="dw-actions">
                <button className="dw-primary" type="button" disabled={busy} onClick={() => perform(async()=>{const x=await reviewDemiLearning(item.id,"approved"); if(!x.ok)return setError(promptWorkbenchError(x.error)); if(x.proposedInstruction){setDraft((v)=>v+"\n"+x.proposedInstruction); setSaved(null);} setNotice("Aprendizaje aprobado y agregado al borrador. Falta probarlo y activarlo."); router.refresh();})}>Aprobar</button>
                <button type="button" disabled={busy} onClick={() => perform(async()=>{const x=await reviewDemiLearning(item.id,"rejected"); if(!x.ok)return setError(promptWorkbenchError(x.error)); setNotice("Aprendizaje descartado."); router.refresh();})}>Descartar</button>
              </div>}
            </article>)}
          </div>
        </div>
      )}
      {tab === "handoff" && (
        <div className="dw-content">
          <header><h2>Cuándo pasa a una persona</h2><p>Solo los motivos activados permiten una escalación automática. Los demás casos los debe intentar resolver Demi con Studio Flow.</p></header>
          <div className="dw-settings-list">
            {handoffPolicies.map((item) => <article key={item.id} className="dw-setting-card">
              <div><strong>{item.label}</strong><small>{item.blocking ? "Pausa la conversación automática" : "Revisión sin bloquear a Demi"}</small><p>{item.description}</p></div>
              <label className="dw-switch"><input type="checkbox" checked={item.enabled} disabled={busy} onChange={(e)=>perform(async()=>{const x=await setDemiHandoffPolicy(item.id,e.target.checked); if(!x.ok)return setError(promptWorkbenchError(x.error)); setNotice(e.target.checked ? "Motivo activado." : "Motivo desactivado."); router.refresh();})}/><span>{item.enabled ? "Activo" : "Inactivo"}</span></label>
            </article>)}
          </div>
        </div>
      )}

      {tab === "test" && (
        <div className="dw-content">
          <header>
            <h2>Prueba a {assistantName}</h2>
            <p>Conversa usando el borrador del editor y el mismo motor de Demi.</p>
          </header>
          <div className="dw-test-controls">
            <label htmlFor="demi-persona">
              Probar como
              <select
                id="demi-persona"
                value={persona}
                disabled={busy}
                onChange={(event) => {
                  setPersona(event.target.value as TestPersona);
                  clearTest();
                }}
              >
                <option value="prospect">🌱 Prospecto nuevo</option>
                <option value="student">🎓 Alumna con paquete ficticio</option>
              </select>
            </label>
            <button type="button" onClick={clearTest} disabled={busy}>
              Nueva conversación
            </button>
          </div>
          <p className="dw-test-notice">
            🧪 Modo prueba. Nada se envía a clientes. Los horarios y precios se consultan; las
            acciones y los datos de la alumna se simulan. La elegibilidad y las consecuencias de
            crédito requieren UAT operativo separado.
          </p>
          <div className="dw-chat" role="log" aria-label="Conversación de prueba">
            {!messages.length && (
              <div className="dw-empty">
                <span>🤖</span>
                <strong>{assistantName}</strong>
                <p>Escribe como lo haría una prospecta o alumna.</p>
                <div className="dw-actions">
                  <button
                    type="button"
                    onClick={() => setMessage("Hola, nunca he hecho pole. ¿Cómo puedo empezar?")}
                  >
                    Primera clase
                  </button>
                  <button type="button" onClick={() => setMessage("¿Qué clases tienen mañana?")}>
                    Horarios
                  </button>
                </div>
              </div>
            )}
            {messages.map((row, index) => (
              <article key={index} className={`dw-message is-${row.role}`}>
                <small>{row.role === "user" ? "Tú" : assistantName}</small>
                <p>{row.content}</p>
              </article>
            ))}
            {busy && (
              <p className="dw-thinking" role="status">
                Demi está respondiendo…
              </p>
            )}
            <div ref={endRef} />
          </div>
          <form
            className="dw-compose"
            onSubmit={(event) => {
              event.preventDefault();
              perform(async () => {
                const content = message.trim();
                if (!content) return;
                const result = await testDemiPrompt({
                  conversationId,
                  instructions: draft,
                  message: content,
                  persona,
                });
                if (!result.ok) return setError(promptWorkbenchError(result.error));
                setMessages((rows) => [
                  ...rows,
                  { role: "user", content },
                  { role: "assistant", content: result.reply },
                ]);
                setMessage("");
                setConversationId(result.conversationId);
              });
            }}
          >
            <textarea
              aria-label="Mensaje de prueba"
              placeholder="Escribe un mensaje…"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={2000}
              rows={2}
              disabled={busy}
            />
            <button
              className="dw-primary"
              type="submit"
              disabled={
                busy || !message.trim() || !draft.trim() || !openAIConfigured || !storageReady
              }
            >
              Enviar ↗
            </button>
          </form>
          {!openAIConfigured && (
            <p className="dw-error">Falta configurar la conexión con IA en este entorno.</p>
          )}
        </div>
      )}
    </section>
  );
}
