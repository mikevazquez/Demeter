import Link from "next/link";

import { formatDateTime } from "@/lib/student/portal";
import {
  getStudentRewardsContext,
  isChallengeVersion,
  rewardBenefitLabel,
  rewardObject,
} from "@/lib/student/rewards";

import { RewardsEmpty, StateChip } from "../components";

type TimelineKind = "achievement" | "program" | "challenge" | "reward" | "streak";

type TimelineEvent = {
  id: string;
  kind: TimelineKind;
  title: string;
  detail: string | null;
  occurredAt: string;
  href: string | null;
  status: string | null;
};

const filters = [
  { key: "all", label: "Todo" },
  { key: "achievement", label: "Logros" },
  { key: "program", label: "Programas" },
  { key: "challenge", label: "Retos" },
  { key: "reward", label: "Recompensas" },
] as const;

function monthKey(date: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    month: "long",
    year: "numeric",
    timeZone,
  }).format(new Date(date));
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isPastDate(value: string) {
  return Date.parse(value) < Date.now();
}

export default async function StudentJourneyPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getStudentRewardsContext();
  const activeView = filters.some((item) => item.key === query.view) ? query.view! : "all";
  const events: TimelineEvent[] = [];

  for (const unlock of ctx.programUnlocks) {
    const participation = ctx.programParticipations.find(
      (item) => item.id === unlock.participation_id,
    );
    const version = participation
      ? ctx.programVersionMap.get(
          `${participation.program_id}:${participation.program_version_number}`,
        )
      : undefined;

    events.push({
      id: `program-level-${unlock.id}`,
      kind: "program",
      title: `Nivel conseguido: ${unlock.title_snapshot}`,
      detail: version?.name ?? "Programa",
      occurredAt: unlock.unlocked_at,
      href: participation ? `/student/recompensas/programas/${participation.id}` : null,
      status: "Conseguido",
    });
  }

  for (const event of ctx.programEvents.filter((item) => item.event_type === "program_completed")) {
    const participation = event.participation_id
      ? ctx.programParticipations.find((item) => item.id === event.participation_id)
      : null;
    const version = ctx.programVersionMap.get(
      `${event.program_id}:${event.program_version_number}`,
    );

    events.push({
      id: `program-completed-${event.id}`,
      kind: "program",
      title: `Programa completado: ${version?.name ?? "Programa"}`,
      detail: "Completaste todos los niveles de este programa.",
      occurredAt: event.occurred_at,
      href: participation ? `/student/recompensas/programas/${participation.id}` : null,
      status: "Completado",
    });
  }

  for (const achievement of ctx.achievements) {
    events.push({
      id: `achievement-${achievement.id}`,
      kind: "achievement",
      title: `Logro conseguido: ${achievement.title_snapshot}`,
      detail: "Se agregó permanentemente a tu colección.",
      occurredAt: achievement.unlocked_at,
      href: "/student/recompensas/logros",
      status: "Conseguido",
    });
  }

  for (const participation of ctx.participations) {
    if (ctx.programRuleIds.has(participation.rule_id)) continue;

    const version = ctx.versionMap.get(
      `${participation.rule_id}:${participation.joined_version_number}`,
    );
    if (!isChallengeVersion(version)) continue;

    const rule = ctx.ruleMap.get(participation.rule_id);
    const cycle = ctx.latestCycleByParticipation.get(participation.id) ?? null;
    const completedAt = participation.fulfilled_at ?? cycle?.fulfilled_at ?? null;
    const endedAt =
      participation.closed_at ??
      cycle?.closed_at ??
      rule?.scheduled_end_at ??
      cycle?.window_end_at ??
      null;

    if (completedAt) {
      events.push({
        id: `challenge-completed-${participation.id}`,
        kind: "challenge",
        title: `Reto completado: ${version?.name ?? "Reto especial"}`,
        detail: "Cumpliste la meta dentro de su periodo.",
        occurredAt: completedAt,
        href: `/student/recompensas/retos/${participation.id}`,
        status: "Completado",
      });
    } else if (
      endedAt &&
      (participation.status === "closed" ||
        ["finished", "cancelled"].includes(rule?.status ?? "") ||
        isPastDate(endedAt))
    ) {
      events.push({
        id: `challenge-ended-${participation.id}`,
        kind: "challenge",
        title: `Reto finalizado: ${version?.name ?? "Reto especial"}`,
        detail: "El periodo terminó sin completar la meta.",
        occurredAt: endedAt,
        href: `/student/recompensas/retos/${participation.id}`,
        status: "No completado",
      });
    }
  }

  for (const reward of ctx.rewards) {
    events.push({
      id: `reward-earned-${reward.id}`,
      kind: "reward",
      title: `Ganaste: ${rewardBenefitLabel(reward)}`,
      detail: "La recompensa se agregó a tu cuenta.",
      occurredAt: reward.created_at,
      href: `/student/recompensas/recompensa/${reward.id}`,
      status: reward.status === "available" ? "Disponible" : null,
    });

    if (reward.status === "redeemed" && reward.redeemed_at) {
      events.push({
        id: `reward-used-${reward.id}`,
        kind: "reward",
        title:
          reward.delivery_mode === "auto_apply"
            ? `Se aplicó automáticamente: ${rewardBenefitLabel(reward)}`
            : `Utilizaste: ${rewardBenefitLabel(reward)}`,
        detail: null,
        occurredAt: reward.redeemed_at,
        href: `/student/recompensas/recompensa/${reward.id}`,
        status: "Utilizada",
      });
    }

    if (reward.status === "expired" && reward.expires_at) {
      events.push({
        id: `reward-expired-${reward.id}`,
        kind: "reward",
        title: `Venció: ${rewardBenefitLabel(reward)}`,
        detail: "La recompensa permanece en tu historial.",
        occurredAt: reward.expires_at,
        href: `/student/recompensas/recompensa/${reward.id}`,
        status: "Vencida",
      });
    }

    if (reward.status === "revoked" && reward.revoked_at) {
      events.push({
        id: `reward-adjusted-${reward.id}`,
        kind: "reward",
        title: `Recompensa ajustada: ${rewardBenefitLabel(reward)}`,
        detail: "El ajuste quedó registrado en tu historial.",
        occurredAt: reward.revoked_at,
        href: `/student/recompensas/recompensa/${reward.id}`,
        status: "Ajustada",
      });
    }
  }

  let bestWeeks = 0;
  for (const snapshot of [...ctx.snapshots].sort(
    (left, right) => Date.parse(left.calculated_at) - Date.parse(right.calculated_at),
  )) {
    const progress = rewardObject(snapshot.progress);
    const best = Number(progress["attendance.streak.weeks.best"] ?? 0);
    if (!Number.isFinite(best) || best <= bestWeeks || best <= 0) continue;

    bestWeeks = best;
    events.push({
      id: `streak-${snapshot.id}`,
      kind: "streak",
      title: `Nueva racha: ${best} ${best === 1 ? "semana" : "semanas"}`,
      detail: "Nuevo récord de constancia.",
      occurredAt: snapshot.calculated_at,
      href: "/student/recompensas",
      status: "Hito",
    });
  }

  const filtered = events
    .filter((event) => activeView === "all" || event.kind === activeView)
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));

  const groups = new Map<string, TimelineEvent[]>();
  for (const event of filtered) {
    const key = monthKey(event.occurredAt, ctx.studio.timezone);
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }

  const completedChallenges = events.filter(
    (event) => event.kind === "challenge" && event.status === "Completado",
  ).length;

  function filterHref(view: string) {
    return view === "all"
      ? "/student/recompensas/trayectoria"
      : `/student/recompensas/trayectoria?view=${view}`;
  }

  return (
    <main className="space-y-5 pb-4">
      <header>
        <Link
          href="/student/recompensas"
          className="text-xs font-semibold text-fuchsia-300 transition hover:text-fuchsia-200"
        >
          ← Mi progreso
        </Link>
        <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.22em] text-fuchsia-300">
          Historial
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Mi trayectoria
        </h1>
        <p className="mt-1.5 text-sm text-zinc-400">
          Tus hitos permanecen aquí, desde los más recientes hasta el inicio.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
          <strong className="text-xl text-white">{ctx.achievements.length}</strong>
          <p className="mt-1 text-[11px] text-zinc-500">logros</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
          <strong className="text-xl text-white">{ctx.programUnlocks.length}</strong>
          <p className="mt-1 text-[11px] text-zinc-500">niveles</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
          <strong className="text-xl text-white">{completedChallenges}</strong>
          <p className="mt-1 text-[11px] text-zinc-500">retos completados</p>
        </div>
        <div className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.06] p-3.5">
          <strong className="text-xl text-white">
            {ctx.rewards.filter((item) => item.status === "available").length}
          </strong>
          <p className="mt-1 text-[11px] text-zinc-500">recompensas disponibles</p>
        </div>
      </section>

      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max gap-2">
          {filters.map((item) => (
            <Link
              key={item.key}
              href={filterHref(item.key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${activeView === item.key ? "border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-200" : "border-white/10 bg-white/[0.03] text-zinc-400"}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>

      {filtered.length ? (
        <section className="space-y-6">
          {[...groups.entries()].map(([month, monthEvents]) => (
            <div key={month}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                {capitalize(month)}
              </h2>
              <div className="relative space-y-2 before:absolute before:bottom-5 before:left-[17px] before:top-5 before:w-px before:bg-white/10">
                {monthEvents.map((event) => {
                  const content = (
                    <>
                      <span
                        aria-hidden="true"
                        className={`relative z-10 mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${event.kind === "achievement" ? "border-amber-300/20 bg-amber-300/10 text-amber-200" : event.kind === "reward" ? "border-fuchsia-400/20 bg-fuchsia-400/10 text-fuchsia-200" : event.kind === "challenge" ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200" : "border-white/10 bg-[#15161d] text-zinc-300"}`}
                      >
                        {event.kind === "achievement"
                          ? "★"
                          : event.kind === "reward"
                            ? "◆"
                            : event.kind === "challenge"
                              ? "✦"
                              : event.kind === "streak"
                                ? "↟"
                                : "◇"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-start justify-between gap-2">
                          <strong className="text-sm text-white">{event.title}</strong>
                          {event.status ? <StateChip>{event.status}</StateChip> : null}
                        </span>
                        {event.detail ? (
                          <span className="mt-1 block text-xs leading-5 text-zinc-400">
                            {event.detail}
                          </span>
                        ) : null}
                        <span className="mt-1.5 block text-[11px] text-zinc-600">
                          {formatDateTime(event.occurredAt, ctx.studio.timezone)}
                        </span>
                      </span>
                    </>
                  );

                  return event.href ? (
                    <Link
                      key={event.id}
                      href={event.href}
                      className="relative flex gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-3.5 transition hover:border-fuchsia-500/20"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div
                      key={event.id}
                      className="relative flex gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-3.5"
                    >
                      {content}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      ) : (
        <RewardsEmpty
          title="Tu trayectoria empieza aquí"
          detail="Tus logros, programas, retos, rachas y recompensas aparecerán aquí conforme avances."
          actionHref="/student/reservar"
          actionLabel="Explorar clases"
        />
      )}

      {ctx.achievements.length ? (
        <Link
          href="/student/recompensas/logros"
          className="flex min-h-12 items-center justify-between rounded-2xl border border-white/10 bg-white/[0.025] px-4 text-sm font-semibold text-zinc-300"
        >
          <span>Ver todos mis logros</span>
          <span className="text-fuchsia-300">→</span>
        </Link>
      ) : null}
    </main>
  );
}
