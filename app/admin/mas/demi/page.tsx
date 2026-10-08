import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import DemiWorkbench from "@/app/admin/integraciones/demi/DemiWorkbench";
import DemiLayers from "./DemiLayers";
import type { PromptVersion } from "@/lib/assistant/prompt-workbench";
import "../../integraciones/demi/workbench.css";
import "../../integraciones/demi/demi.css";
import "./demi-layers.css";

const USD_TO_MXN_FALLBACK = 18.5;

async function getUsdToMxnRate() {
  try {
    const response = await fetch("https://open.er-api.com/v6/latest/USD", {
      next: { revalidate: 86_400 },
    });
    if (!response.ok) throw new Error("exchange_rate_unavailable");

    const data = (await response.json()) as {
      result?: string;
      time_last_update_utc?: string;
      rates?: { MXN?: number };
    };
    const rate = Number(data.rates?.MXN);
    if (data.result !== "success" || !Number.isFinite(rate) || rate <= 0) {
      throw new Error("exchange_rate_invalid");
    }

    return {
      rate,
      updatedAt: data.time_last_update_utc ?? "actualización diaria",
      fallback: false,
    };
  } catch {
    return {
      rate: USD_TO_MXN_FALLBACK,
      updatedAt: "tipo de cambio de referencia",
      fallback: true,
    };
  }
}

function money(value: number | null, usdToMxn: number) {
  if (value == null) return "Sin límite";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((value / 1_000_000) * usdToMxn);
}

function monthStartIso() {
  const timeZone = "America/Mexico_City";
  const now = new Date();
  const monthParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(monthParts.find((part) => part.type === "year")?.value);
  const month = Number(monthParts.find((part) => part.type === "month")?.value);
  const guess = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const localParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(guess);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(localParts.find((part) => part.type === type)?.value);
  const localAsUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  const offsetMs = localAsUtc - guess.getTime();
  return new Date(guess.getTime() - offsetMs).toISOString();
}

export default async function DemiDemoPage() {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  const [
    { data: config },
    { data: monthCalls },
    { data: versions, error: versionsError },
    { data: handoffPolicies },
    { data: learningProposals },
    { data: adminChanges },
    exchangeRate,
  ] = await Promise.all([
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
    supabase
      .from("assistant_handoff_policies")
      .select("id,reason_code,label,description,enabled,blocking,sort_order")
      .eq("studio_id", studio.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("assistant_learning_proposals")
      .select("id,title,evidence,proposed_instruction,status,created_at")
      .eq("studio_id", studio.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("assistant_admin_change_requests")
      .select("id,instruction,summary,plan,status,error_code,created_at,applied_at")
      .eq("studio_id", studio.id)
      .order("created_at", { ascending: false })
      .limit(20),
    getUsdToMxnRate(),
  ]);

  if (!config) {
    return (
      <main className="demi-page demi-settings-page">
        <Link className="demi-back" href="/admin/mas">
          ← Más
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
    <main className="demi-page demi-settings-page">
      <header className="demi-header">
        <div>
          <Link className="demi-back" href="/admin/notificaciones">
            ← Comunicación
          </Link>
          <div className="demi-eyebrow">Asistente del estudio · configuración por capas</div>
          <h1>Demi 2.0</h1>
          <p>Personalidad, contexto, objetivos, reglas y acciones para acompañar cada conversación.</p>
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
          <strong>{money(spent, exchangeRate.rate)}</strong>
          <small>Límite aprox. {money(config.monthly_budget_usd_micros, exchangeRate.rate)}</small>
        </article>
        <article>
          <span>Tokens del mes</span>
          <strong>{tokens.toLocaleString("es-MX")}</strong>
          <small>{monthCalls?.length ?? 0} llamadas</small>
        </article>
        <article>
          <span>Límite por conversación</span>
          <strong>{money(config.conversation_budget_usd_micros, exchangeRate.rate)}</strong>
          <small>Incluye las pruebas de instrucciones</small>
        </article>
      </section>

      <p className="demi-cost-note">
        Montos estimados de uso de OpenAI en MXN. Tipo de cambio de referencia: 1 USD ={" "}
        {new Intl.NumberFormat("es-MX", { maximumFractionDigits: 4 }).format(exchangeRate.rate)} MXN
        {exchangeRate.fallback ? " (respaldo)" : ` · actualizado ${exchangeRate.updatedAt}`} ·{" "}
        <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer">
          fuente del tipo de cambio
        </a>
      </p>

      <DemiLayers activeInstructions={config.personality_instructions ?? ""} initialInstructions={(versions?.[0]?.kind === "draft" ? versions[0].instructions : config.personality_instructions) ?? ""} />

      <section className="demi-advanced-workbench"><h2>Pruebas y operación de Demi</h2><p>Prueba conversaciones en Sandbox, revisa escalamiento y conserva el historial de versiones.</p>
      <DemiWorkbench
        assistantName={config.assistant_name}
        activeInstructions={config.personality_instructions}
        versions={(versions ?? []) as PromptVersion[]}
        storageReady={!versionsError}
        openAIConfigured={openAIConfigured}
        sandbox={process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("hedouonyhynuvwbckdlg") === true}
        handoffPolicies={handoffPolicies ?? []}
        learningProposals={learningProposals ?? []}
        adminChanges={adminChanges ?? []}
      />
      </section>
    </main>
  );
}
