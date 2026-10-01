"use client";

import { useMemo, useState, useTransition } from "react";
import type { FormEvent } from "react";

import { sendDemiMessage } from "./actions";

type Trace = {
  model: string;
  modelCalls: number;
  toolCalls: Array<{ name: string; status: "executed" | "blocked" | "error" }>;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  estimatedCostUsdMicros: number;
};

type Message = {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  trace?: Trace;
};

const ERROR_COPY: Record<string, string> = {
  invalid_message: "Escribe un mensaje para continuar.",
  assistant_not_configured: "Demi todavía no está configurada para este estudio.",
  assistant_demo_disabled: "La demo de Demi está desactivada.",
  conversation_not_found: "Esta conversación ya no está disponible. Inicia una nueva.",
  conversation_create_failed: "No se pudo iniciar la conversación.",
  invalid_demo_identity: "La identidad de prueba ya no está disponible.",
  conversation_identity_mismatch:
    "La identidad cambió. Inicia una conversación nueva con esa identidad.",
  turn_create_failed: "No se pudo guardar tu mensaje.",
  conversation_history_failed: "No se pudo recuperar el contexto de la conversación.",
  openai_not_configured:
    "La interfaz ya está lista, pero falta configurar OPENAI_API_KEY en el entorno Preview de Vercel.",
  assistant_budget_exceeded:
    "Demi alcanzó el límite de gasto configurado para esta demo.",
  openai_network_error: "No se pudo conectar con OpenAI.",
  openai_request_failed: "OpenAI rechazó la solicitud.",
  assistant_empty_response: "Demi no devolvió una respuesta utilizable.",
  assistant_parallel_tool_call_blocked:
    "La respuesta intentó ejecutar herramientas en paralelo y fue bloqueada.",
  assistant_tool_limit_exceeded: "Se alcanzó el límite de herramientas para este turno.",
  assistant_model_call_limit_exceeded:
    "Se alcanzó el límite de llamadas al modelo para este turno.",
  reply_persist_failed: "Demi respondió, pero no se pudo guardar la respuesta.",
  assistant_failed: "No se pudo completar la respuesta de Demi.",
};

function moneyFromMicros(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 5,
    maximumFractionDigits: 5,
  }).format(value / 1_000_000);
}

function toolLabel(name: string) {
  const labels: Record<string, string> = {
    search_class_availability: "Consultó agenda y disponibilidad",
    get_activity_catalog: "Consultó actividades",
    get_commercial_options: "Consultó paquetes y precios",
    get_studio_information: "Consultó información del estudio",
    get_policy_information: "Consultó políticas",
    get_student_reservations: "Consultó reservas activas",
    prepare_booking: "Validó y preparó la reserva",
    execute_booking: "Ejecutó la reserva confirmada",
    prepare_cancellation: "Calculó y preparó la cancelación",
    execute_cancellation: "Ejecutó la cancelación confirmada",
  };
  return labels[name] ?? name;
}

export default function DemiChat({
  assistantName,
  openAIConfigured,
  students,
}: {
  assistantName: string;
  openAIConfigured: boolean;
  students: Array<{ id: string; name: string }>;
}) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [studentId, setStudentId] = useState("");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isPending, startTransition] = useTransition();

  const lastTrace = useMemo(
    () =>
      [...messages]
        .reverse()
        .find((item) => item.role === "assistant" && item.trace)?.trace ?? null,
    [messages],
  );

  function resetConversation() {
    if (isPending) return;
    setConversationId(null);
    setMessages([]);
    setMessage("");
  }

  function changeIdentity(nextStudentId: string) {
    if (isPending) return;
    setStudentId(nextStudentId);
    setConversationId(null);
    setMessages([]);
    setMessage("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || isPending) return;

    const localId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      { id: localId, role: "user", content: text },
    ]);
    setMessage("");

    startTransition(async () => {
      const result = await sendDemiMessage({
        conversationId,
        studentId: studentId || null,
        message: text,
      });

      if (!result.ok) {
        if ("conversationId" in result && result.conversationId) {
          setConversationId(result.conversationId);
        }
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "error",
            content: ERROR_COPY[result.error] ?? ERROR_COPY.assistant_failed,
          },
        ]);
        return;
      }

      setConversationId(result.conversationId);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.reply,
          trace: result.trace,
        },
      ]);
    });
  }

  return (
    <div className="demi-demo-shell">
      <section className="demi-phone" aria-label="Chat de prueba con Demi">
        <header className="demi-phone-header">
          <div className="demi-avatar" aria-hidden="true">
            D
          </div>
          <div>
            <strong>{assistantName}</strong>
            <span>{isPending ? "consultando Studio Flow…" : "demo · Sandbox"}</span>
          </div>
          <button type="button" onClick={resetConversation} disabled={isPending}>
            Nueva
          </button>
        </header>

        <div className="demi-identity">
          <label htmlFor="demi-demo-identity">Simular WhatsApp de</label>
          <select
            id="demi-demo-identity"
            value={studentId}
            onChange={(event) => changeIdentity(event.target.value)}
            disabled={isPending}
          >
            <option value="">Sin identidad · solo consultas</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.name}
              </option>
            ))}
          </select>
          <small>
            En WhatsApp real Studio Flow identificará a la persona por el número; este selector
            existe solo para UAT.
          </small>
        </div>

        <div className="demi-chat">
          {messages.length === 0 ? (
            <div className="demi-empty">
              <div aria-hidden="true">💬</div>
              <strong>Prueba una conversación real</strong>
              <p>
                Pregunta por horarios, disponibilidad, actividades, precios, ubicación o
                políticas. Si seleccionas una identidad también puedes probar una reserva con
                confirmación.
              </p>
              <div className="demi-prompts">
                {[
                  "¿Hay pole mañana después de las 6?",
                  "¿Cuánto cuesta?",
                  "¿Qué clases tienen mañana?",
                  "¿Dónde están?",
                  "Quiero reservar Pole Fitness mañana a las 5",
                ].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setMessage(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="demi-message-list">
              {messages.map((item) => (
                <article
                  key={item.id}
                  className={"demi-message is-" + item.role}
                >
                  <p>{item.content}</p>
                  {item.trace ? (
                    <details className="demi-message-trace">
                      <summary>Ver qué consultó</summary>
                      <div>
                        <span>{item.trace.model}</span>
                        <span>
                          {item.trace.toolCalls.length
                            ? item.trace.toolCalls.map((tool) => toolLabel(tool.name)).join(" · ")
                            : "Sin herramientas"}
                        </span>
                        <span>
                          {item.trace.inputTokens + item.trace.outputTokens} tokens ·{" "}
                          {moneyFromMicros(item.trace.estimatedCostUsdMicros)}
                        </span>
                      </div>
                    </details>
                  ) : null}
                </article>
              ))}
              {isPending ? (
                <article className="demi-message is-assistant is-loading" aria-live="polite">
                  <span />
                  <span />
                  <span />
                </article>
              ) : null}
            </div>
          )}
        </div>

        <form className="demi-composer" onSubmit={submit}>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Escribe como si fuera WhatsApp…"
            rows={2}
            maxLength={2000}
            disabled={isPending}
            aria-label="Mensaje para Demi"
          />
          <button type="submit" disabled={isPending || !message.trim()}>
            Enviar
          </button>
        </form>
      </section>

      <aside className="demi-debug">
        <div className="demi-debug-card">
          <span className="demi-debug-label">Conexión OpenAI</span>
          <strong className={openAIConfigured ? "is-ok" : "is-warning"}>
            {openAIConfigured ? "Configurada" : "Pendiente"}
          </strong>
          <p>
            {openAIConfigured
              ? "La llave está disponible únicamente en el servidor."
              : "La demo visual funciona, pero no puede conversar hasta configurar la llave en Preview."}
          </p>
        </div>

        <div className="demi-debug-card">
          <span className="demi-debug-label">Último turno</span>
          {lastTrace ? (
            <>
              <strong>{lastTrace.model}</strong>
              <p>
                {lastTrace.modelCalls} llamada{lastTrace.modelCalls === 1 ? "" : "s"} al
                modelo · {lastTrace.toolCalls.length} tool
                {lastTrace.toolCalls.length === 1 ? "" : "s"}
              </p>
              <dl>
                <div>
                  <dt>Entrada</dt>
                  <dd>{lastTrace.inputTokens.toLocaleString("es-MX")}</dd>
                </div>
                <div>
                  <dt>Cache</dt>
                  <dd>{lastTrace.cachedInputTokens.toLocaleString("es-MX")}</dd>
                </div>
                <div>
                  <dt>Salida</dt>
                  <dd>{lastTrace.outputTokens.toLocaleString("es-MX")}</dd>
                </div>
                <div>
                  <dt>Razonamiento</dt>
                  <dd>{lastTrace.reasoningTokens.toLocaleString("es-MX")}</dd>
                </div>
                <div>
                  <dt>Costo estimado</dt>
                  <dd>{moneyFromMicros(lastTrace.estimatedCostUsdMicros)}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p>Envía un mensaje para ver modelo, tools, tokens y costo estimado.</p>
          )}
        </div>

        <div className="demi-debug-card">
          <span className="demi-debug-label">Protecciones activas</span>
          <ul>
            <li>Studio Flow = fuente de verdad</li>
            <li>Sin acceso SQL para el modelo</li>
            <li>Tenant tomado del contexto autenticado</li>
            <li>Reservas en dos pasos: preparar → confirmar → ejecutar</li>
            <li>Cancelaciones: motivo → consecuencia → confirmar → ejecutar</li>
            <li>Reagendado y lista de espera siguen bloqueados</li>
            <li>store:false en OpenAI</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
