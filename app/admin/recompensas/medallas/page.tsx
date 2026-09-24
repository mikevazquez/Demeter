import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { RewardsShell } from "../RewardsNav";
import { SectionCard } from "../ui";

type MedalKey = "bronze" | "silver" | "gold" | "diamond";

type MedalRow = {
  level_key: MedalKey;
  level_order: number;
  title: string;
  required_active_days: number;
  max_no_shows: number;
  min_continuity_months: number;
  max_renewal_gap_days: number;
  waitlist_priority: number;
  private_discount_pct: number;
  event_discount_pct: number;
  monthly_guest_invites: number;
};

function benefitCopy(level: MedalRow) {
  const items: string[] = [
    level.waitlist_priority === 1
      ? "Prioridad básica en lista de espera"
      : level.waitlist_priority === 2
        ? "Mayor prioridad en lista de espera"
        : level.waitlist_priority === 3
          ? "Prioridad alta en lista de espera"
          : "Prioridad máxima en lista de espera",
  ];

  if (level.event_discount_pct) items.push(`${level.event_discount_pct}% en talleres y eventos`);
  if (level.private_discount_pct) items.push(`${level.private_discount_pct}% en clases privadas`);
  if (level.monthly_guest_invites) {
    items.push(
      `${level.monthly_guest_invites} pase${level.monthly_guest_invites === 1 ? "" : "s"} de invitada al mes`,
    );
  }
  if (level.level_key !== "bronze") {
    items.push("Acceso anticipado a inscripciones y promociones");
  }
  if (level.level_key === "diamond") {
    items.push("Experiencias premium de Demeter");
  }
  return items;
}

export default async function AdminMedalsPage() {
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_READ);
  const { data } = await ctx.supabase
    .from("reward_status_level_definitions")
    .select(
      "level_key,level_order,title,required_active_days,max_no_shows,min_continuity_months,max_renewal_gap_days,waitlist_priority,private_discount_pct,event_discount_pct,monthly_guest_invites",
    )
    .eq("studio_id", ctx.studio.id)
    .order("level_order");

  const levels = (data ?? []) as MedalRow[];

  return (
    <RewardsShell>
      <header>
        <p className="eyebrow">REWARDS · MEDALLAS</p>
        <h1 className="dashboard-title">Medallas mensuales</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
          Cada ciclo se asigna directamente la Medalla más alta cuyos cuatro requisitos se cumplan.
          El onboarding solo habilita el acceso al sistema.
        </p>
      </header>

      <SectionCard eyebrow="REGLAS" title="Requisitos por Medalla">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-[0.12em] text-zinc-500">
                <th className="px-3 py-3">Medalla</th>
                <th className="px-3 py-3">Días activos</th>
                <th className="px-3 py-3">No show</th>
                <th className="px-3 py-3">Continuidad</th>
                <th className="px-3 py-3">Renovación</th>
              </tr>
            </thead>
            <tbody>
              {levels.map((level) => (
                <tr key={level.level_key} className="border-b border-white/[0.06] text-zinc-300">
                  <td className="px-3 py-4 font-semibold text-white">Medalla {level.title}</td>
                  <td className="px-3 py-4">{level.required_active_days}</td>
                  <td className="px-3 py-4">≤ {level.max_no_shows}</td>
                  <td className="px-3 py-4">{level.min_continuity_months} meses</td>
                  <td className="px-3 py-4">≤ {level.max_renewal_gap_days} días</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <strong className="text-sm text-white">Días activos</strong>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              Cuenta fechas distintas con al menos una asistencia attended. Varias clases el mismo
              día siguen contando como un solo día activo.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <strong className="text-sm text-white">No show</strong>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              Se cuenta por reserva con estado no_show. Varias faltas el mismo día cuentan por
              separado.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <strong className="text-sm text-white">Continuidad</strong>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              Se reinicia después de 30 días consecutivos sin ninguna asistencia attended.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <strong className="text-sm text-white">Renovación</strong>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              Mide los días entre el vencimiento del paquete anterior y la siguiente renovación.
            </p>
          </div>
        </div>
      </SectionCard>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {levels.map((level) => (
          <article
            key={level.level_key}
            className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#FF0A8A]">
              Medalla
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">{level.title}</h2>
            <div className="mt-4 space-y-2">
              {benefitCopy(level).map((item) => (
                <p key={item} className="text-xs leading-5 text-zinc-400">
                  <span className="mr-2 text-emerald-300">✓</span>
                  {item}
                </p>
              ))}
            </div>
          </article>
        ))}
      </section>

      <p className="text-xs leading-5 text-zinc-500">
        Esta primera versión usa reglas fijas aprobadas. Los cambios posteriores deberán versionarse
        para no alterar evaluaciones históricas ya cerradas.
      </p>
    </RewardsShell>
  );
}
