import type { SupabaseClient } from "@supabase/supabase-js";

import { formatDateMx, formatUsdMicros } from "@/lib/platform/console";
import { averageCostPerConversation, parseDemiUsage } from "@/lib/platform/demi-usage";

/** NEB-01-21 · Cuánto cuesta Demi en este estudio (últimos 30 días, sin texto de mensajes). */
export async function DemiUsageTab({
  supabase,
  studioId,
}: {
  supabase: SupabaseClient;
  studioId: string;
}) {
  const { data, error } = await supabase.rpc("platform_studio_demi_usage", {
    p_studio: studioId,
    p_days: 30,
  });
  const usage = error ? null : parseDemiUsage(data);
  if (!usage) {
    return <p className="neb-notice is-error">No se pudo leer el uso de Demi.</p>;
  }
  const maxDailyCost = Math.max(1, ...usage.daily.map((day) => day.costUsdMicros));
  return (
    <>
      <section className="neb-kpis">
        <article className="neb-kpi">
          <span>Costo {usage.days} días</span>
          <strong>{formatUsdMicros(usage.totals.costUsdMicros)}</strong>
          <small>{usage.totals.calls} llamadas · {usage.totals.errors} con error</small>
        </article>
        <article className="neb-kpi">
          <span>Por conversación</span>
          <strong>{formatUsdMicros(averageCostPerConversation(usage))}</strong>
          <small>{usage.totals.conversations} conversaciones</small>
        </article>
        <article className="neb-kpi">
          <span>Tokens</span>
          <strong>{(usage.totals.inputTokens + usage.totals.outputTokens).toLocaleString("es-MX")}</strong>
          <small>
            {usage.totals.cachedInputTokens.toLocaleString("es-MX")} de entrada en caché
          </small>
        </article>
      </section>

      <h2 className="neb-subtitle">Por día</h2>
      {usage.daily.length ? (
        <ol className="neb-audit">
          {usage.daily.map((day) => (
            <li key={day.day}>
              <time dateTime={day.day}>{formatDateMx(day.day)}</time>
              <span>
                <span
                  className="neb-bar"
                  style={{ width: `${Math.max(4, Math.round((day.costUsdMicros / maxDailyCost) * 100))}%` }}
                  aria-hidden="true"
                />
                {formatUsdMicros(day.costUsdMicros)} · {day.calls} llamadas
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="neb-muted">Sin uso de Demi en este periodo.</p>
      )}

      <h2 className="neb-subtitle">Por modelo</h2>
      <ul>
        {usage.models.map((model) => (
          <li key={model.model}>
            {model.model} · {model.calls} llamadas · {formatUsdMicros(model.costUsdMicros)}
          </li>
        ))}
      </ul>

      <h2 className="neb-subtitle">Conversaciones más caras</h2>
      <ol className="neb-audit">
        {usage.topConversations.map((conversation) => (
          <li key={conversation.conversationId}>
            <time dateTime={conversation.lastAt}>{formatDateMx(conversation.lastAt)}</time>
            <span>
              {formatUsdMicros(conversation.costUsdMicros)} · {conversation.calls} llamadas ·{" "}
              {conversation.conversationId.slice(0, 8)}
            </span>
          </li>
        ))}
      </ol>
      <p className="neb-muted">
        Aún no incluye la transcripción de audios; se suma cuando se integre la rama de Demi.
      </p>
    </>
  );
}
