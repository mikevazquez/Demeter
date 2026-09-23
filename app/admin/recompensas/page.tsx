import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { RewardsShell } from "./RewardsNav";
import {
  EmptyState,
  MetricCard,
  SectionCard,
  StatusBadge,
  formatDateTime,
  rewardDefinitionLabel,
} from "./ui";

export default async function RewardsControlCenterPage() {
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_READ);

  const [programsResult, rulesResult, rewardsResult, programEventsResult, onboardingResult] =
    await Promise.all([
      ctx.supabase
        .from("reward_programs")
        .select("id,status,latest_version_number,published_version_number,updated_at")
        .eq("studio_id", ctx.studio.id)
        .order("updated_at", { ascending: false }),
      ctx.supabase
        .from("reward_rules")
        .select("id,status,current_version_number,updated_at")
        .eq("studio_id", ctx.studio.id)
        .order("updated_at", { ascending: false }),
      ctx.supabase
        .from("reward_instances")
        .select("id,status,kind,benefit_definition,student_id,expires_at,created_at")
        .eq("studio_id", ctx.studio.id)
        .order("created_at", { ascending: false })
        .limit(100),
      ctx.supabase
        .from("reward_program_events")
        .select("id,event_type,program_id,student_id,details,occurred_at")
        .eq("studio_id", ctx.studio.id)
        .order("occurred_at", { ascending: false })
        .limit(8),
      ctx.supabase
        .from("reward_onboarding")
        .select(
          "student_id,documents_completed_at,profile_completed_at,first_reservation_at,first_attendance_at,bronze_unlocked_at",
        )
        .eq("studio_id", ctx.studio.id),
    ]);

  const programs = programsResult.data ?? [];
  const rules = rulesResult.data ?? [];
  const ruleIds = rules.map((rule) => rule.id);
  const versionsResult = ruleIds.length
    ? await ctx.supabase
        .from("reward_rule_versions")
        .select("rule_id,version_number,name,family,reward_definition")
        .in("rule_id", ruleIds)
    : { data: [] };
  const versions = versionsResult.data ?? [];
  const currentVersions = new Map(
    versions.map((version) => [`${version.rule_id}:${version.version_number}`, version]),
  );

  const currentRuleVersions = rules
    .map((rule) => ({
      rule,
      version: currentVersions.get(`${rule.id}:${rule.current_version_number}`),
    }))
    .filter((item) => item.version);

  const activePrograms = programs.filter((program) => program.status === "active");
  const activeChallenges = currentRuleVersions.filter(
    ({ rule, version }) => rule.status === "active" && version?.family === "challenge",
  );
  const activeAchievements = currentRuleVersions.filter(
    ({ rule, version }) => rule.status === "active" && version?.family === "achievement",
  );
  const availableRewards = (rewardsResult.data ?? []).filter(
    (reward) => reward.status === "available",
  );
  const onboardingRows = onboardingResult.data ?? [];
  const activatingStudents = onboardingRows.filter((item) => !item.bronze_unlocked_at);
  const activatedStudents = onboardingRows.filter((item) => Boolean(item.bronze_unlocked_at));

  return (
    <RewardsShell>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">PROGRESS & REWARDS · {ctx.studio.name}</p>
          <h1 className="dashboard-title">Centro de Control</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
            Configura cómo se reconoce el progreso y revisa lo que las alumnas están construyendo.
            El progreso siempre se deriva de comportamiento real.
          </p>
        </div>
        {ctx.can(CAPABILITIES.REWARDS_MANAGE) ? (
          <Link
            href="/admin/recompensas/programas/nuevo"
            className="rounded-xl bg-[#FF0A8A] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            + Nuevo programa
          </Link>
        ) : null}
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Programas activos"
          value={activePrograms.length}
          detail={`${programs.length} configurados`}
        />
        <MetricCard
          label="Retos activos"
          value={activeChallenges.length}
          detail="participación automática"
        />
        <MetricCard
          label="Logros activos"
          value={activeAchievements.length}
          detail="trayectoria permanente"
        />
        <MetricCard
          label="Recompensas disponibles"
          value={availableRewards.length}
          detail="listas para usar"
        />
        <MetricCard
          label="En activación"
          value={activatingStudents.length}
          detail={`${activatedStudents.length} con medalla activa`}
        />
      </section>

      <SectionCard eyebrow="ACTIVACIÓN" title="Activación de Medalla Bronce">
        <div className="grid gap-4 lg:grid-cols-[1fr_.9fr]">
          <div>
            <p className="text-sm leading-6 text-zinc-400">
              La Medalla Bronce ya no se entrega por crear una alumna. Se desbloquea cuando completa
              los cuatro hitos del onboarding. Las alumnas que ya tenían una medalla conservan su
              estado anterior.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {[
                [
                  "1",
                  "Aceptar documentos obligatorios",
                  "Se completa con evidencia de Documentos.",
                ],
                ["2", "Completar perfil", "Foto, correo y fecha de nacimiento."],
                [
                  "3",
                  "Realizar primera reserva",
                  "La reserva queda como hito aunque después se cancele.",
                ],
                ["4", "Asistir a primera clase", "Requiere una reserva con estado attended."],
              ].map(([number, title, detail]) => (
                <div key={number} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#FF0A8A]">
                    Paso {number}
                  </span>
                  <strong className="mt-1 block text-sm text-white">{title}</strong>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">{detail}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-[#CD7F32]/30 bg-[#CD7F32]/[0.06] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#E6A56A]">
              Resultado
            </p>
            <h3 className="mt-2 text-xl font-semibold text-white">Medalla Bronce</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Al completar los cuatro pasos se activa automáticamente la primera medalla y comienzan
              sus beneficios. Rewards y los niveles técnicos permanecen separados.
            </p>
            <div className="mt-4 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs text-zinc-400">
              Requisitos fijos en v1 · no editables
            </div>
          </div>
        </div>
      </SectionCard>

      <section className="grid gap-4 lg:grid-cols-3">
        {[
          {
            title: "Programas",
            copy: "Programas permanentes, acumulativos o secuenciales.",
            href: "/admin/recompensas/programas",
          },
          {
            title: "Retos especiales",
            copy: "Campañas temporales con objetivo, medalla o recompensa opcional.",
            href: "/admin/recompensas/retos",
          },
          {
            title: "Logros",
            copy: "Medallas permanentes visibles o secretas.",
            href: "/admin/recompensas/logros",
          },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-[#FF0A8A]/35 hover:bg-white/[0.05]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#FF0A8A]">
              CONFIGURAR
            </p>
            <h2 className="mt-2 text-xl font-semibold text-white">{item.title}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">{item.copy}</p>
          </Link>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
        <SectionCard
          eyebrow="SEGUIMIENTO"
          title="Actividad reciente"
          action={
            <Link
              href="/admin/recompensas/seguimiento"
              className="text-sm font-semibold text-zinc-400 hover:text-white"
            >
              Ver seguimiento →
            </Link>
          }
        >
          {!programEventsResult.data?.length ? (
            <EmptyState title="Todavía no hay hitos de programa">
              Aparecerán cuando una alumna entre, avance o complete un nivel.
            </EmptyState>
          ) : (
            <div className="grid gap-2">
              {programEventsResult.data.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3"
                >
                  <div>
                    <strong className="text-sm text-white">
                      {event.event_type === "level_completed"
                        ? "Nivel completado"
                        : event.event_type === "program_completed"
                          ? "Programa completado"
                          : event.event_type === "joined"
                            ? "Nueva participación"
                            : "Actualización de progreso"}
                    </strong>
                    <p className="mt-1 text-xs text-zinc-500">
                      {formatDateTime(event.occurred_at)}
                    </p>
                  </div>
                  <StatusBadge
                    status={event.event_type === "program_completed" ? "completed" : "active"}
                  />
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          eyebrow="RECOMPENSAS"
          title="Disponibles ahora"
          action={
            <Link
              href="/admin/recompensas/generadas"
              className="text-sm font-semibold text-zinc-400 hover:text-white"
            >
              Ver todas →
            </Link>
          }
        >
          {!availableRewards.length ? (
            <EmptyState title="Sin recompensas disponibles" />
          ) : (
            <div className="grid gap-2">
              {availableRewards.slice(0, 6).map((reward) => (
                <Link
                  key={reward.id}
                  href={`/admin/recompensas/generadas/${reward.id}`}
                  className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 transition hover:border-[#FF0A8A]/30"
                >
                  <div className="flex items-center justify-between gap-3">
                    <strong className="text-sm text-white">
                      {rewardDefinitionLabel(reward.benefit_definition)}
                    </strong>
                    <StatusBadge status={reward.status} />
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {reward.expires_at
                      ? `Vence ${formatDateTime(reward.expires_at)}`
                      : "Sin vencimiento fijo"}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>
      </section>
    </RewardsShell>
  );
}
