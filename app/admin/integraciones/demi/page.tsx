import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import DemiWorkbench from "./DemiWorkbench";
import type { PromptVersion } from "@/lib/assistant/prompt-workbench";
import "./workbench.css";
import "./demi.css";

function money(value: number | null) {
  if (value == null) return "Sin límite";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 1_000_000);
}

function monthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export default async function DemiDemoPage() {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  const [{ data: config }, { data: monthCalls }, { data: versions, error: versionsError }] =
    await Promise.all([
      supabase
        .from("assistant_configs")
        .select(
          "assistant_name,mode,model,reasoning_effort,personality_instructions,monthly_budget_usd_micros,conversation_budget_usd_micros",
        )
        .eq("studio_id", studio.id)
        .maybeSingle(),
      supabase
        .from("assistant_model_calls")
        .select("estimated_cost_usd_micros,input_tokens,output_tokens")
        .eq("studio_id", studio.id)
        .gte("created_at", monthStartIso()),
      supabase
        .from("assistant_prompt_versions")
        .select("id,kind,instructions,note,created_at")
        .eq("studio_id", studio.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  if (!config) {
    return (
      <main className="demi-page">
        <Link className="demi-back" href="/admin/notificaciones">
          ← Comunicación
        </Link>
        <section className="demi-unavailable">
          <h1>Demi todavía no está configurada</h1>
          <p>La arquitectura existe, pero este tenant aún no tiene configuración del asistente.</p>
        </section>
      </main>
    );
  }

  const spent = (monthCalls ?? []).reduce(
    (total, row) => total + Number(row.estimated_cost_usd_micros ?? 0),
    0,
  );
  const tokens = (monthCalls ?? []).reduce(
    (total, row) => total + Number(row.input_tokens ?? 0) + Number(row.output_tokens ?? 0),
    0,
  );
  const openAIConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());

  return (
    <main className="demi-page">
      <header className="demi-header">
        <div>
          <Link className="demi-back" href="/admin/notificaciones">
            ← Comunicación
          </Link>
          <div className="demi-eyebrow">Comportamiento y pruebas</div>
          <h1>🤖 {config.assistant_name}</h1>
          <p>
            Configura cómo responde {config.assistant_name}, mejora sus instrucciones y prueba
            conversaciones antes de activar una versión.
          </p>
        </div>
        <span className="demi-mode">Modo {config.mode}</span>
      </header>

      <section className="demi-kpis">
        <article>
          <span>Modelo</span>
          <strong>{config.model}</strong>
          <small>Razonamiento {config.reasoning_effort}</small>
        </article>
        <article>
          <span>Gasto del mes</span>
          <strong>{money(spent)}</strong>
          <small>Límite {money(config.monthly_budget_usd_micros)}</small>
        </article>
        <article>
          <span>Tokens del mes</span>
          <strong>{tokens.toLocaleString("es-MX")}</strong>
          <small>{monthCalls?.length ?? 0} llamadas</small>
        </article>
        <article>
          <span>Límite por conversación</span>
          <strong>{money(config.conversation_budget_usd_micros)}</strong>
          <small>Incluye las pruebas de instrucciones</small>
        </article>
      </section>

      <DemiWorkbench
        assistantName={config.assistant_name}
        activeInstructions={config.personality_instructions}
        versions={(versions ?? []) as PromptVersion[]}
        storageReady={!versionsError}
        openAIConfigured={openAIConfigured}
        sandbox={process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("hedouonyhynuvwbckdlg") === true}
      />
    </main>
  );
}
