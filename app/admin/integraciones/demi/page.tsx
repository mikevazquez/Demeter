import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import DemiChat from "./DemiChat";
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

  const [
    { data: config },
    { data: monthCalls },
    { count: conversations },
    { data: students },
    { data: prospectContacts },
  ] = await Promise.all([
    supabase
      .from("assistant_configs")
      .select(
        "assistant_name,mode,model,reasoning_effort,monthly_budget_usd_micros,conversation_budget_usd_micros",
      )
      .eq("studio_id", studio.id)
      .maybeSingle(),
    supabase
      .from("assistant_model_calls")
      .select("estimated_cost_usd_micros,input_tokens,output_tokens")
      .eq("studio_id", studio.id)
      .gte("created_at", monthStartIso()),
    supabase
      .from("assistant_conversations")
      .select("id", { count: "exact", head: true })
      .eq("studio_id", studio.id),
    supabase
      .from("students")
      .select("id,full_name")
      .eq("studio_id", studio.id)
      .eq("active", true)
      .eq("lifecycle_status", "active")
      .order("full_name")
      .limit(60),
    supabase
      .from("crm_contacts")
      .select("id,person_id,lifecycle_status")
      .eq("studio_id", studio.id)
      .is("converted_student_id", null)
      .in("lifecycle_status", ["prospect", "trial"])
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  if (!config) {
    return (
      <main className="demi-page">
        <Link className="demi-back" href="/admin/integraciones">
          ← Integraciones
        </Link>
        <section className="demi-unavailable">
          <h1>Demi todavía no está configurada</h1>
          <p>La arquitectura existe, pero este tenant aún no tiene configuración del asistente.</p>
        </section>
      </main>
    );
  }

  const prospectPersonIds = (prospectContacts ?? [])
    .map((contact) => contact.person_id)
    .filter((id): id is string => Boolean(id));

  const { data: prospectPersons } = prospectPersonIds.length
    ? await supabase
        .from("persons")
        .select("id,first_name,last_name")
        .eq("studio_id", studio.id)
        .in("id", prospectPersonIds)
    : { data: [] as Array<{ id: string; first_name: string; last_name: string | null }> };

  const prospectPersonMap = new Map((prospectPersons ?? []).map((person) => [person.id, person]));

  const prospects = (prospectContacts ?? [])
    .map((contact) => {
      const person = prospectPersonMap.get(contact.person_id);
      if (!person) return null;
      const name = [person.first_name, person.last_name].filter(Boolean).join(" ").trim();
      return {
        id: contact.id,
        name: name || "Prospecto",
        lifecycleStatus: contact.lifecycle_status,
      };
    })
    .filter((prospect): prospect is { id: string; name: string; lifecycleStatus: string } =>
      Boolean(prospect),
    );

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
          <Link className="demi-back" href="/admin/integraciones">
            ← Integraciones
          </Link>
          <div className="demi-eyebrow">Asistente interno</div>
          <h1>🤖 {config.assistant_name}</h1>
          <p>
            Conversa con el asistente usando datos reales de {studio.name}. Ya puede reservar,
            cancelar, reagendar y entrar a lista de espera con confirmación explícita.
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
          <span>Conversaciones</span>
          <strong>{conversations ?? 0}</strong>
          <small>Límite por conversación {money(config.conversation_budget_usd_micros)}</small>
        </article>
      </section>

      <section className="demi-notice">
        <strong>Regla de la demo:</strong> si Studio Flow no devuelve el dato, Demi debe decir que
        no lo encontró. Para reservar, cancelar, reagendar o entrar a lista de espera, primero debe
        validar el estado real y después pedir una confirmación nueva antes de ejecutar.
      </section>

      <DemiChat
        assistantName={config.assistant_name}
        openAIConfigured={openAIConfigured}
        students={(students ?? []).map((student) => ({
          id: student.id,
          name: student.full_name,
        }))}
        prospects={prospects}
      />
    </main>
  );
}
