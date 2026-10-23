import Link from "next/link";
import { notFound } from "next/navigation";

import {
  PLATFORM_MODULES,
  PLATFORM_PLANS,
  formatMxn,
  modulePriceLabel,
  platformPlan,
} from "@/lib/platform/catalog";
import {
  STATUS_LABEL,
  auditActionLabel,
  formatDateMx,
  formatMinorMxn,
  formatUsdMicros,
  loadPlatformStudioDetail,
  type PlatformStudioDetail,
} from "@/lib/platform/console";
import { loadSupportState } from "@/lib/platform/support";
import { createClient } from "@/lib/supabase/server";

import { setStudioModuleAction, setStudioPlanAction, setStudioStatusAction } from "../../actions";
import { SupportBar, SupportTab } from "./SupportPanel";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABS = [
  { key: "numeros", label: "Números" },
  { key: "plan", label: "Plan y módulos" },
  { key: "cobros", label: "Cobros" },
  { key: "bitacora", label: "Bitácora" },
] as const;
// NEB-01-17 · Solo con sesión de soporte abierta.
const SUPPORT_TABS = [
  { key: "diagnostico", label: "Diagnóstico" },
  { key: "paquetes", label: "Paquetes" },
  { key: "horario", label: "Horario" },
] as const;
type SupportTabKey = (typeof SUPPORT_TABS)[number]["key"];
type TabKey = (typeof TABS)[number]["key"] | SupportTabKey;

const NOTICES: Record<string, { tone: "ok" | "error"; text: string }> = {
  plan_guardado: { tone: "ok", text: "Plan guardado. Quedó en la bitácora." },
  modulo_activado: { tone: "ok", text: "Módulo activado. El estudio ya lo puede usar." },
  modulo_desactivado: { tone: "ok", text: "Módulo desactivado. Sus datos no se borran." },
  estado_guardado: { tone: "ok", text: "Estado guardado. Quedó en la bitácora." },
  founding_seats_full: { tone: "error", text: "Ya no hay lugares Founding (5 de 5)." },
  status_invalid: {
    tone: "error",
    text: "Ese estado no aplica a este plan. All Access solo se puede suspender.",
  },
  cut_day_invalid: { tone: "error", text: "El día de corte va del 1 al 28." },
  forbidden: { tone: "error", text: "Tu cuenta no es de plataforma." },
  soporte_iniciado: { tone: "ok", text: "Entraste como soporte. Se avisó a la dueña." },
  soporte_terminado: { tone: "ok", text: "Saliste del estudio. Quedó en la bitácora." },
  paquete_guardado: { tone: "ok", text: "Paquete guardado. Quedó en la bitácora con antes y después." },
  support_reason_required: { tone: "error", text: "Escribe el motivo (3 a 200 caracteres)." },
  support_session_required: {
    tone: "error",
    text: "Tu sesión de soporte terminó. Entra de nuevo para continuar.",
  },
  product_not_found: { tone: "error", text: "Ese paquete ya no existe." },
  product_name_invalid: { tone: "error", text: "El nombre debe tener de 2 a 120 caracteres." },
  product_price_invalid: { tone: "error", text: "Revisa el precio (por ejemplo 1250.00)." },
  error: { tone: "error", text: "No se pudo guardar. Intenta de nuevo." },
};

const STATUS_OPTIONS = ["invited", "active", "grace", "read_only", "suspended"] as const;

export default async function PlataformaEstudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; estado?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const supabase = await createClient("admin");
  const [detail, support] = await Promise.all([
    loadPlatformStudioDetail(supabase, id),
    loadSupportState(supabase, id),
  ]);
  if (!detail) notFound();

  const supportActive = support?.active === true;
  const tabs = supportActive ? [...SUPPORT_TABS, ...TABS] : TABS;
  const tab: TabKey = tabs.some((item) => item.key === query.tab)
    ? (query.tab as TabKey)
    : "numeros";
  const supportTab = SUPPORT_TABS.find((item) => item.key === tab)?.key ?? null;
  const notice = query.estado ? (NOTICES[query.estado] ?? NOTICES.error) : null;
  const ent = detail.entitlements;

  return (
    <>
      <Link href="/plataforma" className="neb-back">
        ← Estudios
      </Link>
      <section className="neb-hero">
        <p className="neb-eyebrow">
          {detail.studio.slug ? `${detail.studio.slug}.nebora.mx` : "Estudio"}
        </p>
        <h1>{detail.studio.brandName}</h1>
        {ent ? (
          <div className="neb-studio-meta">
            <span className={`neb-pill is-${ent.status}`}>{STATUS_LABEL[ent.status]}</span>
            <span className="neb-pill">{ent.planLabel}</span>
            <span className="neb-pill">{formatMxn(ent.monthlyPriceMxn)} al mes</span>
          </div>
        ) : null}
      </section>

      {notice ? (
        <p className={`neb-notice is-${notice.tone}`} role="status">
          {notice.text}
        </p>
      ) : null}

      <SupportBar studioId={id} state={support} />

      <nav className="neb-tabs" aria-label="Secciones del estudio">
        {tabs.map((item) => (
          <Link
            key={item.key}
            href={`/plataforma/estudios/${id}?tab=${item.key}`}
            aria-current={item.key === tab ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {supportTab ? (
        <SupportTab
          supabase={supabase}
          studioId={id}
          tab={supportTab}
          timeZone="America/Mexico_City"
        />
      ) : null}
      {tab === "numeros" ? <NumbersTab detail={detail} /> : null}
      {tab === "plan" ? <PlanTab detail={detail} /> : null}
      {tab === "cobros" ? <BillingTab detail={detail} /> : null}
      {tab === "bitacora" ? <AuditTab detail={detail} /> : null}
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <article className="neb-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </article>
  );
}

// NEB-01-11 · Todo lo del estudio en un solo lugar.
function NumbersTab({ detail }: { detail: PlatformStudioDetail }) {
  const ent = detail.entitlements;
  const demiTokens = detail.demiMonth.inputTokens + detail.demiMonth.outputTokens;
  return (
    <>
      <h2 className="neb-subtitle">Alumnas</h2>
      <section className="neb-kpis">
        <Stat
          label="Activas"
          value={detail.students.active}
          hint={`${detail.students.total} registradas`}
        />
        <Stat label="Con paquete vigente" value={detail.studentsWithPackage} />
        <Stat label="Nuevas este mes" value={detail.students.newThisMonth} />
      </section>

      <h2 className="neb-subtitle">Operación del mes</h2>
      <section className="neb-kpis">
        <Stat
          label="Clases esta semana"
          value={detail.classes.thisWeek}
          hint={`${detail.classes.thisMonth} en el mes`}
        />
        <Stat
          label="Reservas"
          value={detail.reservationsMonth.booked}
          hint={`${detail.reservationsMonth.attended} asistencias · ${detail.reservationsMonth.cancelled} canceladas`}
        />
        <Stat
          label="Ventas del estudio"
          value={formatMinorMxn(detail.salesMonth.totalMinor)}
          hint={`${detail.salesMonth.count} ventas confirmadas`}
        />
      </section>

      <h2 className="neb-subtitle">Demi este mes</h2>
      <section className="neb-kpis">
        <Stat
          label="Tokens"
          value={demiTokens.toLocaleString("es-MX")}
          hint={`${detail.demiMonth.calls} llamadas a la IA`}
        />
        <Stat
          label="Costo de IA"
          value={formatUsdMicros(detail.demiMonth.costUsdMicros)}
          hint="estimado, lo paga Nébora"
        />
        <Stat label="Demi" value={ent?.modules.demi ? "Activa" : "No contratada"} />
      </section>

      <h2 className="neb-subtitle">Cuenta</h2>
      <section className="neb-kpis">
        <Stat
          label="Paquete"
          value={ent?.planLabel ?? "—"}
          hint={ent ? `${formatMxn(ent.monthlyPriceMxn)} al mes` : undefined}
        />
        <Stat
          label="Fecha de corte"
          value={ent?.cutDay ? `Día ${ent.cutDay}` : "Sin definir"}
          hint={detail.nextCutOn ? `renueva el ${formatDateMx(detail.nextCutOn)}` : undefined}
        />
        <Stat
          label="Founding"
          value={
            ent?.plan === "founding"
              ? `Hasta ${formatDateMx(ent.foundingEndsOn)}`
              : ent?.foundingAlumni
                ? "Ex-Founding · 30 %"
                : "No"
          }
        />
        <Stat label="Último acceso del dueño" value={formatDateMx(detail.ownerLastSignInAt)} />
      </section>

      <h2 className="neb-subtitle">Módulos</h2>
      <ul className="neb-module-chips">
        {PLATFORM_MODULES.map((entry) => (
          <li key={entry.key} className={ent?.modules[entry.key] ? "is-on" : "is-off"}>
            {entry.label} · {ent?.modules[entry.key] ? "activo" : "apagado"}
          </li>
        ))}
      </ul>
    </>
  );
}

// NEB-01-12 · Cambiar plan, corte, módulos y estado. Todo queda en la bitácora.
function PlanTab({ detail }: { detail: PlatformStudioDetail }) {
  const ent = detail.entitlements;
  if (!ent) return <p className="neb-muted">No se pudieron leer los derechos del estudio.</p>;
  const plan = platformPlan(ent.plan);
  const requested = new Set(detail.pendingRequests.map((item) => item.module));
  const statusOptions = ent.plan === "allaccess" ? (["suspended"] as const) : STATUS_OPTIONS;

  return (
    <>
      <section className="neb-card">
        <h2>Plan</h2>
        <form action={setStudioPlanAction} className="neb-form">
          <input type="hidden" name="studio" value={detail.studio.id} />
          <label>
            Paquete
            <select name="plan" defaultValue={ent.plan}>
              {PLATFORM_PLANS.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                  {entry.sellable ? ` · ${formatMxn(entry.monthlyPriceMxn)}` : " · interno"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Día de corte (1 a 28)
            <input
              type="number"
              name="cut_day"
              min={1}
              max={28}
              inputMode="numeric"
              defaultValue={ent.cutDay ?? ""}
            />
          </label>
          <button type="submit" className="neb-button">
            Guardar plan
          </button>
        </form>
        <p className="neb-muted">
          Al pasar de Founding a otro plan, el estudio queda como ex-Founding con 30 % para siempre.
          Founding tiene 5 lugares.
        </p>
      </section>

      <section className="neb-card">
        <h2>Módulos</h2>
        <ul className="neb-module-list">
          {PLATFORM_MODULES.map((entry) => {
            const included = plan.includedModules.includes(entry.key);
            const active = ent.modules[entry.key];
            return (
              <li key={entry.key} className={requested.has(entry.key) ? "is-requested" : undefined}>
                <div>
                  <strong>{entry.label}</strong>
                  <small>
                    {included
                      ? `Incluido en ${plan.label}`
                      : active
                        ? `Contratado aparte · ${modulePriceLabel(entry.key)}`
                        : `No contratado · ${modulePriceLabel(entry.key)}`}
                    {requested.has(entry.key) ? " · el estudio lo pidió" : ""}
                  </small>
                </div>
                {included ? (
                  <span className="neb-pill is-active">Incluido</span>
                ) : (
                  <form action={setStudioModuleAction}>
                    <input type="hidden" name="studio" value={detail.studio.id} />
                    <input type="hidden" name="module" value={entry.key} />
                    <input type="hidden" name="active" value={active ? "false" : "true"} />
                    <button type="submit" className={active ? "neb-button is-ghost" : "neb-button"}>
                      {active ? "Desactivar" : "Activar"}
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
        <p className="neb-muted">
          Activar aquí no cobra: el cobro automático llega con Stripe (NEB-01-07 y NEB-01-34).
        </p>
      </section>

      <section className="neb-card">
        <h2>Estado de la cuenta</h2>
        <form action={setStudioStatusAction} className="neb-form">
          <input type="hidden" name="studio" value={detail.studio.id} />
          <label>
            Estado
            <select name="status" defaultValue={ent.status}>
              {ent.status === "internal" ? (
                <option value="internal" disabled>
                  Interno
                </option>
              ) : null}
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABEL[status]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="neb-button is-ghost">
            Guardar estado
          </button>
        </form>
        <p className="neb-muted">
          Solo lectura y suspendido no borran nada: el estudio ve sus datos pero no vende ni
          reserva. All Access suspendido se reactiva eligiendo All Access en el plan.
        </p>
      </section>
    </>
  );
}

function BillingTab({ detail }: { detail: PlatformStudioDetail }) {
  const ent = detail.entitlements;
  return (
    <section className="neb-card">
      <h2>Cobros</h2>
      <p>
        Mensualidad: <strong>{ent ? formatMxn(ent.monthlyPriceMxn) : "—"}</strong>
        {detail.nextCutOn ? ` · siguiente corte ${formatDateMx(detail.nextCutOn)}` : ""}
      </p>
      {detail.graceStartedAt ? (
        <p className="neb-notice is-error">
          En gracia desde {formatDateMx(detail.graceStartedAt)}.
        </p>
      ) : null}
      <p className="neb-muted">
        Los pagos, facturas y reintentos aparecen aquí cuando se conecte Stripe (NEB-01-07).
      </p>
    </section>
  );
}

function AuditTab({ detail }: { detail: PlatformStudioDetail }) {
  if (detail.audit.length === 0) return <p className="neb-muted">Sin movimientos todavía.</p>;
  return (
    <ol className="neb-audit">
      {detail.audit.map((entry, index) => (
        <li key={`${entry.occurredAt}-${index}`}>
          <time dateTime={entry.occurredAt}>{formatDateMx(entry.occurredAt)}</time>
          <span>{auditActionLabel(entry)}</span>
        </li>
      ))}
    </ol>
  );
}
