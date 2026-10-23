// NEB-01-21 · Uso de Demi por estudio (migración 20261023166000_neb01_demi_usage).

export type DemiUsage = {
  days: number;
  totals: {
    calls: number;
    errors: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    costUsdMicros: number;
    conversations: number;
  };
  daily: Array<{ day: string; calls: number; tokens: number; costUsdMicros: number }>;
  models: Array<{ model: string; calls: number; costUsdMicros: number }>;
  topConversations: Array<{
    conversationId: string;
    calls: number;
    costUsdMicros: number;
    lastAt: string;
  }>;
};

const n = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const rows = (value: unknown) => (Array.isArray(value) ? (value as Record<string, unknown>[]) : []);

export function parseDemiUsage(raw: unknown): DemiUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const totals = (data.totals ?? {}) as Record<string, unknown>;
  return {
    days: n(data.days) || 30,
    totals: {
      calls: n(totals.calls),
      errors: n(totals.errors),
      inputTokens: n(totals.input_tokens),
      cachedInputTokens: n(totals.cached_input_tokens),
      outputTokens: n(totals.output_tokens),
      costUsdMicros: n(totals.cost_usd_micros),
      conversations: n(totals.conversations),
    },
    daily: rows(data.daily).map((row) => ({
      day: String(row.day ?? ""),
      calls: n(row.calls),
      tokens: n(row.tokens),
      costUsdMicros: n(row.cost_usd_micros),
    })),
    models: rows(data.models).map((row) => ({
      model: String(row.model ?? "—"),
      calls: n(row.calls),
      costUsdMicros: n(row.cost_usd_micros),
    })),
    topConversations: rows(data.top_conversations).map((row) => ({
      conversationId: String(row.conversation_id ?? ""),
      calls: n(row.calls),
      costUsdMicros: n(row.cost_usd_micros),
      lastAt: String(row.last_at ?? ""),
    })),
  };
}

/** Costo promedio por conversación en micros de dólar (0 si no hubo). */
export function averageCostPerConversation(usage: DemiUsage) {
  return usage.totals.conversations
    ? Math.round(usage.totals.costUsdMicros / usage.totals.conversations)
    : 0;
}
