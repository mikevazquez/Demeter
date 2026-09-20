import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function benefitLabel(kind: string, value: unknown) {
  const definition = asObject(value);

  if (kind === "percentage_discount") {
    return `${Number(definition.percent ?? 0)}% de descuento`;
  }
  if (kind === "fixed_discount") {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 0,
    }).format(Number(definition.amount_minor ?? 0) / 100);
  }
  if (kind === "credits") {
    const credits = Number(definition.credits ?? 0);
    return `${credits} crédito${credits === 1 ? "" : "s"}`;
  }
  if (kind === "validity_extension") {
    const days = Number(definition.days ?? 0);
    return `${days} día${days === 1 ? "" : "s"} extra${days === 1 ? "" : "s"}`;
  }
  if (kind === "surcharge_waiver") return String(definition.label ?? "Sin recargo");

  return String(definition.label ?? definition.description ?? "Beneficio especial");
}

export default async function StudentRewardsSummary({
  studentId,
}: {
  studentId: string;
}) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.REWARDS_READ);

  const [rewardsResult, participationsResult, cyclesResult, achievementsResult, incidentsResult] =
    await Promise.all([
      supabase
        .from("reward_instances")
        .select("id,rule_id,version_number,kind,status,benefit_definition,expires_at,created_at")
        .eq("studio_id", studio.id)
        .eq("student_id", studentId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("reward_participations")
        .select("id,rule_id,joined_version_number,status,updated_at")
        .eq("studio_id", studio.id)
        .eq("student_id", studentId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("reward_cycles")
        .select("id,participation_id,rule_id,version_number,status,updated_at")
        .eq("studio_id", studio.id)
        .eq("student_id", studentId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("reward_achievement_unlocks")
        .select("id,title_snapshot,unlocked_at")
        .eq("studio_id", studio.id)
        .eq("student_id", studentId)
        .order("unlocked_at", { ascending: false }),
      supabase
        .from("reward_incidents")
        .select("id,status,priority,summary,opened_at")
        .eq("studio_id", studio.id)
        .eq("student_id", studentId)
        .not("status", "eq", "closed")
        .order("opened_at", { ascending: false }),
    ]);

  const rewards = rewardsResult.data ?? [];
  const participations = participationsResult.data ?? [];
  const cycles = cyclesResult.data ?? [];
  const achievements = achievementsResult.data ?? [];
  const incidents = incidentsResult.data ?? [];

  const ruleIds = [...new Set(participations.map((item) => item.rule_id))];
  const versionsResult = ruleIds.length
    ? await supabase
        .from("reward_rule_versions")
        .select("rule_id,version_number,name,family,human_summary")
        .in("rule_id", ruleIds)
    : { data: [] as Array<{
        rule_id: string;
        version_number: number;
        name: string;
        family: string;
        human_summary: string;
      }> };

  const versions = versionsResult.data ?? [];
  const versionMap = new Map(
    versions.map((version) => [
      `${version.rule_id}:${version.version_number}`,
      version,
    ]),
  );

  const available = rewards.filter((reward) => reward.status === "available");
  const activeCycles = cycles.filter((cycle) => ["open", "frozen"].includes(cycle.status));

  const loyaltyParticipation = participations.find((participation) => {
    const version = versionMap.get(
      `${participation.rule_id}:${participation.joined_version_number}`,
    );
    return version?.family === "loyalty";
  });

  const loyaltyCycle = loyaltyParticipation
    ? activeCycles.find((cycle) => cycle.participation_id === loyaltyParticipation.id) ??
      cycles.find((cycle) => cycle.participation_id === loyaltyParticipation.id)
    : null;

  const loyaltySnapshotResult = loyaltyCycle
    ? await supabase
        .from("reward_progress_snapshots")
        .select("progress,calculated_at")
        .eq("studio_id", studio.id)
        .eq("cycle_id", loyaltyCycle.id)
        .order("calculated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const loyaltyProgress = asObject(loyaltySnapshotResult.data?.progress);
  const currentLoyalty =
    typeof loyaltyProgress["loyalty.current_consecutive_periods"] === "number"
      ? Number(loyaltyProgress["loyalty.current_consecutive_periods"])
      : null;

  const notable = [
    ...available.slice(0, 2).map((reward) => ({
      key: `reward:${reward.id}`,
      label: benefitLabel(reward.kind, reward.benefit_definition),
      detail: reward.expires_at ? "Disponible · con vigencia" : "Disponible",
    })),
    ...activeCycles
      .filter((cycle) => !loyaltyCycle || cycle.id !== loyaltyCycle.id)
      .slice(0, Math.max(0, 3 - Math.min(available.length, 2)))
      .map((cycle) => {
        const participation = participations.find(
          (item) => item.id === cycle.participation_id,
        );
        const version = participation
          ? versionMap.get(
              `${participation.rule_id}:${participation.joined_version_number}`,
            )
          : null;

        return {
          key: `cycle:${cycle.id}`,
          label: version?.name ?? "Progreso activo",
          detail: cycle.status === "frozen" ? "Progreso pausado" : "En progreso",
        };
      }),
  ].slice(0, 3);

  return (
    <section
      className="panel"
      data-rewards-summary
      aria-label="Resumen de recompensas de la alumna"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">REWARDS</p>
          <h2>Fidelidad y recompensas</h2>
          <p>Resumen contextual. Las acciones sensibles se gestionan desde el perfil Rewards.</p>
        </div>
        <Link
          href={`/admin/recompensas/alumnas/${studentId}`}
          className="ghost-button"
        >
          Ver perfil Rewards
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <span className="text-xs text-zinc-500">Disponibles</span>
          <strong className="mt-1 block text-lg text-white">{available.length}</strong>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <span className="text-xs text-zinc-500">Progresos activos</span>
          <strong className="mt-1 block text-lg text-white">{activeCycles.length}</strong>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <span className="text-xs text-zinc-500">Fidelidad actual</span>
          <strong className="mt-1 block text-lg text-white">
            {currentLoyalty === null
              ? loyaltyParticipation
                ? "En seguimiento"
                : "Sin regla"
              : `${currentLoyalty} periodo${currentLoyalty === 1 ? "" : "s"}`}
          </strong>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <span className="text-xs text-zinc-500">Logros</span>
          <strong className="mt-1 block text-lg text-white">{achievements.length}</strong>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <span className="text-xs text-zinc-500">Incidencias</span>
          <strong
            className={
              incidents.some((incident) => incident.priority === "critical")
                ? "mt-1 block text-lg text-rose-300"
                : "mt-1 block text-lg text-white"
            }
          >
            {incidents.length}
          </strong>
        </div>
      </div>

      {notable.length ? (
        <div className="mt-4 grid gap-2 md:grid-cols-3">
          {notable.map((item) => (
            <div
              key={item.key}
              className="rounded-xl border border-fuchsia-500/15 bg-fuchsia-500/[0.05] p-3"
            >
              <strong className="block text-sm text-white">{item.label}</strong>
              <span className="mt-1 block text-xs text-zinc-500">{item.detail}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-white/10 bg-black/15 p-4 text-sm text-zinc-500">
          Todavía no hay recompensas o progresos destacados para esta alumna.
        </div>
      )}
    </section>
  );
}
