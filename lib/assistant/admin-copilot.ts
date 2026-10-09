import "server-only";

export type DemiAdminRuleCategory =
  "behavior" | "commercial" | "booking" | "payment" | "communication" | "safety";

export type DemiAdminAction =
  | {
      type: "set_booking_behavior";
      field: "prospect_require_payment_before_booking";
      value: boolean;
      label: string;
    }
  | {
      type: "set_handoff_policy";
      reason_code: string;
      enabled?: boolean;
      blocking?: boolean;
      label: string;
    }
  | {
      type: "set_product";
      product_name: string;
      price_minor?: number;
      active?: boolean;
      assistant_visible?: boolean;
      online_purchasable?: boolean;
      label: string;
    }
  | {
      type: "set_class_price";
      activity_name: string;
      price_minor: number | null;
      label: string;
    }
  | {
      type: "upsert_rule";
      rule_key: string;
      category: DemiAdminRuleCategory;
      instruction: string;
      enabled: boolean;
      label: string;
    };

export type DemiAdminPlan = {
  summary: string;
  requires_development: boolean;
  development_reason: string | null;
  actions: DemiAdminAction[];
};

type OpenAIResponse = {
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
};

function outputText(body: OpenAIResponse) {
  return (body.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text ?? "")
    .join("\n")
    .trim();
}

function parseJson(text: string) {
  const cleaned = text
    .replace(/^\`\`\`json\s*/i, "")
    .replace(/\`\`\`$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const bookingBehaviorFields = new Set(["prospect_require_payment_before_booking"]);
const categories = new Set([
  "behavior",
  "commercial",
  "booking",
  "payment",
  "communication",
  "safety",
]);

function cleanPlan(raw: Record<string, unknown> | null): DemiAdminPlan | null {
  if (!raw) return null;
  const summary = typeof raw.summary === "string" ? raw.summary.trim().slice(0, 1200) : "";
  const requiresDevelopment = raw.requires_development === true;
  const developmentReason =
    typeof raw.development_reason === "string" && raw.development_reason.trim()
      ? raw.development_reason.trim().slice(0, 1200)
      : null;
  const source = Array.isArray(raw.actions) ? raw.actions : [];
  const actions: DemiAdminAction[] = [];

  for (const item of source) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const type = String(row.type ?? "");
    const label =
      String(row.label ?? "")
        .trim()
        .slice(0, 240) || "Actualizar configuración";

    if (type === "set_booking_behavior") {
      const field = String(row.field ?? "");
      if (!bookingBehaviorFields.has(field) || typeof row.value !== "boolean") continue;
      actions.push({
        type,
        field: "prospect_require_payment_before_booking",
        value: row.value,
        label,
      });
      continue;
    }

    if (type === "set_handoff_policy") {
      const reason_code = String(row.reason_code ?? "").trim();
      if (!reason_code) continue;
      const enabled = typeof row.enabled === "boolean" ? row.enabled : undefined;
      const blocking = typeof row.blocking === "boolean" ? row.blocking : undefined;
      if (enabled === undefined && blocking === undefined) continue;
      actions.push({ type, reason_code, enabled, blocking, label });
      continue;
    }

    if (type === "set_product") {
      const product_name = String(row.product_name ?? "").trim();
      if (!product_name) continue;
      const price_minor =
        typeof row.price_minor === "number" &&
        Number.isInteger(row.price_minor) &&
        row.price_minor >= 0
          ? row.price_minor
          : undefined;
      const active = typeof row.active === "boolean" ? row.active : undefined;
      const assistant_visible =
        typeof row.assistant_visible === "boolean" ? row.assistant_visible : undefined;
      const online_purchasable =
        typeof row.online_purchasable === "boolean" ? row.online_purchasable : undefined;
      if (
        price_minor === undefined &&
        active === undefined &&
        assistant_visible === undefined &&
        online_purchasable === undefined
      )
        continue;
      actions.push({
        type,
        product_name,
        price_minor,
        active,
        assistant_visible,
        online_purchasable,
        label,
      });
      continue;
    }

    if (type === "set_class_price") {
      const activity_name = String(row.activity_name ?? "").trim();
      const price_minor = row.price_minor === null ? null : Number(row.price_minor);
      if (
        !activity_name ||
        (price_minor !== null && (!Number.isInteger(price_minor) || price_minor < 0))
      )
        continue;
      actions.push({ type, activity_name, price_minor, label });
      continue;
    }

    if (type === "upsert_rule") {
      const rule_key = String(row.rule_key ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "_")
        .slice(0, 120);
      const category = String(row.category ?? "behavior");
      const instruction = String(row.instruction ?? "")
        .trim()
        .slice(0, 2000);
      if (rule_key.length < 3 || !categories.has(category) || !instruction) continue;
      actions.push({
        type,
        rule_key,
        category: category as DemiAdminRuleCategory,
        instruction,
        enabled: row.enabled !== false,
        label,
      });
    }
  }

  if (!summary) return null;
  return {
    summary,
    requires_development: requiresDevelopment,
    development_reason: developmentReason,
    actions,
  };
}

export async function proposeDemiAdminPlan(input: {
  instruction: string;
  state: Record<string, unknown>;
  model?: string;
}): Promise<DemiAdminPlan> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("openai_not_configured");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: input.model || "gpt-5.6",
      store: false,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: `Eres el configurador administrativo de Demi para Studio Flow. Convierte una instrucción del dueño del estudio en un plan seguro y tipado. Devuelve SOLO JSON válido.

FORMATO:
{"summary":"...","requires_development":false,"development_reason":null,"actions":[...]}

ACCIONES PERMITIDAS:
1. {"type":"set_booking_behavior","field":"prospect_require_payment_before_booking","value":true|false,"label":"..."}
2. {"type":"set_handoff_policy","reason_code":"uno existente","enabled":true|false,"blocking":true|false,"label":"..."}
3. {"type":"set_product","product_name":"nombre exacto existente","price_minor":entero_en_centavos,"active":true|false,"assistant_visible":true|false,"online_purchasable":true|false,"label":"..."}
4. {"type":"set_class_price","activity_name":"nombre exacto existente","price_minor":entero_en_centavos_o_null,"label":"..."}
5. {"type":"upsert_rule","rule_key":"clave.estable","category":"behavior|commercial|booking|payment|communication|safety","instruction":"regla clara para Demi","enabled":true,"label":"..."}

REGLAS:
- Usa únicamente nombres y reason_code que existan en CURRENT_STATE.
- No inventes SQL, tablas, endpoints, código, IDs ni capacidades.
- CURRENT_STATE.studio_flow_rules son restricciones duras de Studio Flow y son SOLO LECTURA desde este configurador. Nunca propongas cambiarlas ni saltarlas.
- CURRENT_STATE.demi_booking_behavior controla decisiones más estrictas de Demi. Demi puede ser más restrictiva que Studio Flow, nunca menos. Para prospectos que deban pagar antes de reservar usa set_booking_behavior.
- Si Studio Flow prohíbe una acción, ninguna regla, prompt ni comportamiento de Demi puede habilitarla. Si el administrador pide algo que contradice una restricción dura, no lo representes como cambio aplicable: marca requires_development=true y explica que Studio Flow prevalece.
- Para que el lenguaje de Demi sea coherente con un comportamiento, añade también upsert_rule cuando sea útil.
- Los montos se expresan en centavos: $150 MXN = 15000.
- Si la petición no puede representarse de forma fiel con las acciones permitidas, marca requires_development=true y explica por qué. Puedes incluir las acciones seguras que sí apliquen, pero no finjas que resuelven lo demás.
- No apliques nada: solo prepara el plan.
- Mantén summary y labels en español claro.`,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `CURRENT_STATE:\n${JSON.stringify(input.state)}\n\nINSTRUCCIÓN DEL ADMINISTRADOR:\n${input.instruction}`,
            },
          ],
        },
      ],
      max_output_tokens: 3500,
    }),
    cache: "no-store",
  });

  if (!response.ok) throw new Error("admin_plan_failed");
  const body = (await response.json()) as OpenAIResponse;
  const plan = cleanPlan(parseJson(outputText(body)));
  if (!plan) throw new Error("admin_plan_invalid");
  return plan;
}
