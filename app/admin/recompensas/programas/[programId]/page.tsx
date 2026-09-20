import Link from "next/link";
import { notFound } from "next/navigation";

import PendingActionButton from "@/app/admin/components/PendingActionButton";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import {
  deleteProgramLevelAction,
  publishProgramAction,
  startProgramVersionAction,
  transitionProgramAction,
  updateProgramDraftAction,
} from "../../actions";
import { RewardsShell } from "../../RewardsNav";
import {
  StatusBadge,
  asObject,
  conditionsLabel,
  rewardDefinitionLabel,
} from "../../ui";

export default async function ProgramDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { programId } = await params;
  const query = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_READ);

  const { data: program } = await ctx.supabase
    .from("reward_programs")
    .select(
      "id,status,latest_version_number,published_version_number,first_published_at,last_published_at,paused_at,archived_at",
    )
    .eq("id", programId)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  if (!program) notFound();

  const { data: versions } = await ctx.supabase
    .from("reward_program_versions")
    .select(
      "program_id,version_number,name,description,progression_mode,audience_definition,presentation_definition,created_at",
    )
    .eq("program_id", programId)
    .order("version_number", { ascending: false });

  const latestVersion = (versions ?? []).find(
    (version) => version.version_number === program.latest_version_number,
  );
  if (!latestVersion) notFound();

  const hasDraft = program.published_version_number !== program.latest_version_number;
  const canManage = ctx.can(CAPABILITIES.REWARDS_MANAGE);
  const audience = asObject(latestVersion.audience_definition);

  const { data: levels } = await ctx.supabase
    .from("reward_program_levels")
    .select(
      "id,level_key,level_order,title,description,rule_id,rule_version_number,level_visibility,reward_visibility",
    )
    .eq("program_id", programId)
    .eq("program_version_number", program.latest_version_number)
    .order("level_order");

  const ruleIds = [...new Set((levels ?? []).map((level) => level.rule_id))];
  const ruleVersionsResult = ruleIds.length
    ? await ctx.supabase
        .from("reward_rule_versions")
        .select("rule_id,version_number,condition_definition,reward_definition")
        .in("rule_id", ruleIds)
    : { data: [] };
  const ruleVersionMap = new Map(
    (ruleVersionsResult.data ?? []).map((version) => [
      `${version.rule_id}:${version.version_number}`,
      version,
    ]),
  );

  const [{ count: participationCount }, { count: unlockCount }] = await Promise.all([
    ctx.supabase
      .from("reward_program_participations")
      .select("id", { count: "exact", head: true })
      .eq("program_id", programId),
    ctx.supabase
      .from("reward_program_level_unlocks")
      .select("id", { count: "exact", head: true })
      .eq("program_id", programId),
  ]);

  return (
    <RewardsShell>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/recompensas/programas"
            className="text-sm font-semibold text-zinc-400 hover:text-white"
          >
            ← Programas
          </Link>
          <p className="mt-4 eyebrow">
            PROGRAMA · v{program.latest_version_number}
            {hasDraft ? " · BORRADOR" : ""}
          </p>
          <h1 className="dashboard-title">{latestVersion.name}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
            {latestVersion.description || "Sin descripción."}
          </p>
        </div>
        <StatusBadge status={program.status} />
      </header>

      {query.saved ? <div className="notice success">Cambios guardados correctamente.</div> : null}
      {query.error ? <div className="notice error">{query.error}</div> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Progresión</p>
          <strong className="mt-2 block text-white">
            {latestVersion.progression_mode === "sequential" ? "Secuencial" : "Acumulativa"}
          </strong>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Audiencia</p>
          <strong className="mt-2 block text-white">
            {audience.scope === "all_students" ? "Todas" : "Activas"}
          </strong>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Participaciones</p>
          <strong className="mt-2 block text-white">{participationCount ?? 0}</strong>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Niveles conseguidos</p>
          <strong className="mt-2 block text-white">{unlockCount ?? 0}</strong>
        </div>
      </section>

      {canManage && hasDraft ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#FF0A8A]">
            CONFIGURACIÓN DEL BORRADOR
          </p>
          <form action={updateProgramDraftAction} className="mt-4 grid gap-4 md:grid-cols-2">
            <input type="hidden" name="program_id" value={program.id} />
            <label className="grid gap-1 text-sm text-zinc-300 md:col-span-2">
              Nombre
              <input
                name="name"
                required
                defaultValue={latestVersion.name}
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
              />
            </label>
            <label className="grid gap-1 text-sm text-zinc-300 md:col-span-2">
              Descripción
              <textarea
                name="description"
                rows={3}
                defaultValue={latestVersion.description ?? ""}
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
              />
            </label>
            <label className="grid gap-1 text-sm text-zinc-300">
              Progresión
              <select
                name="progression_mode"
                defaultValue={latestVersion.progression_mode}
                className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
              >
                <option value="cumulative">Acumulativa</option>
                <option value="sequential">Secuencial</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm text-zinc-300">
              Audiencia
              <select
                name="audience_scope"
                defaultValue={String(audience.scope ?? "all_active_students")}
                className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
              >
                <option value="all_active_students">Alumnas activas</option>
                <option value="all_students">Todas las alumnas</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm text-zinc-300">
              Elegibilidad
              <select
                name="eligibility_mode"
                defaultValue={String(audience.eligibility_mode ?? "continuous")}
                className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
              >
                <option value="continuous">Continua</option>
                <option value="lock_on_join">Se conserva al entrar</option>
              </select>
            </label>
            <div className="flex items-end justify-end">
              <PendingActionButton
                className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-white"
                pendingLabel="Guardando…"
              >
                Guardar configuración
              </PendingActionButton>
            </div>
          </form>
        </section>
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#FF0A8A]">
              NIVELES
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">
              Ruta del programa
            </h2>
          </div>
          {canManage && hasDraft ? (
            <Link
              href={`/admin/recompensas/programas/${program.id}/niveles/nuevo`}
              className="rounded-xl bg-[#FF0A8A] px-4 py-2.5 text-sm font-semibold text-white"
            >
              + Agregar nivel
            </Link>
          ) : null}
        </div>

        {!levels?.length ? (
          <div className="mt-5 rounded-2xl border border-dashed border-white/10 p-7 text-center text-sm text-zinc-500">
            Este borrador todavía no tiene niveles.
          </div>
        ) : (
          <div className="mt-5 grid gap-3">
            {levels.map((level) => {
              const ruleVersion = ruleVersionMap.get(
                `${level.rule_id}:${level.rule_version_number}`,
              );
              return (
                <article
                  key={level.id}
                  className="rounded-2xl border border-white/10 bg-black/20 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#FF0A8A]">
                        NIVEL {level.level_order}
                        {level.level_visibility === "hidden" ? " · OCULTO" : ""}
                      </p>
                      <h3 className="mt-1 text-lg font-semibold text-white">{level.title}</h3>
                      <p className="mt-2 text-sm text-zinc-400">
                        {conditionsLabel(ruleVersion?.condition_definition)}
                      </p>
                      <p className="mt-2 text-xs text-zinc-500">
                        {level.reward_visibility === "surprise"
                          ? "Recompensa sorpresa"
                          : rewardDefinitionLabel(ruleVersion?.reward_definition)}
                      </p>
                    </div>

                    {canManage && hasDraft ? (
                      <div className="flex gap-2">
                        <Link
                          href={`/admin/recompensas/programas/${program.id}/niveles/${encodeURIComponent(level.level_key)}`}
                          className="rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-white"
                        >
                          Configurar
                        </Link>
                        <form action={deleteProgramLevelAction}>
                          <input type="hidden" name="program_id" value={program.id} />
                          <input type="hidden" name="level_key" value={level.level_key} />
                          <button className="rounded-xl border border-rose-500/20 px-3 py-2 text-sm font-semibold text-rose-300">
                            Quitar
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {canManage ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-zinc-500">
                ESTADO DEL PROGRAMA
              </p>
              <p className="mt-2 text-sm text-zinc-400">
                Lo conseguido por las alumnas nunca se elimina al cambiar el estado.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!hasDraft && program.status !== "archived" ? (
                <form action={startProgramVersionAction}>
                  <input type="hidden" name="program_id" value={program.id} />
                  <PendingActionButton
                    className="rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-white"
                    pendingLabel="Preparando…"
                  >
                    Crear nueva versión
                  </PendingActionButton>
                </form>
              ) : null}

              {hasDraft && levels?.length ? (
                <form action={publishProgramAction}>
                  <input type="hidden" name="program_id" value={program.id} />
                  <PendingActionButton
                    className="rounded-xl bg-[#FF0A8A] px-3 py-2 text-sm font-semibold text-white"
                    pendingLabel="Publicando…"
                  >
                    Publicar versión
                  </PendingActionButton>
                </form>
              ) : null}

              {program.status === "active" ? (
                <form action={transitionProgramAction}>
                  <input type="hidden" name="program_id" value={program.id} />
                  <input type="hidden" name="action" value="pause" />
                  <button className="rounded-xl border border-amber-500/20 px-3 py-2 text-sm font-semibold text-amber-300">
                    Pausar
                  </button>
                </form>
              ) : null}

              {program.status === "paused" ? (
                <form action={transitionProgramAction}>
                  <input type="hidden" name="program_id" value={program.id} />
                  <input type="hidden" name="action" value="resume" />
                  <button className="rounded-xl border border-emerald-500/20 px-3 py-2 text-sm font-semibold text-emerald-300">
                    Reanudar
                  </button>
                </form>
              ) : null}

              {program.status !== "archived" ? (
                <form action={transitionProgramAction}>
                  <input type="hidden" name="program_id" value={program.id} />
                  <input type="hidden" name="action" value="archive" />
                  <button className="rounded-xl border border-rose-500/20 px-3 py-2 text-sm font-semibold text-rose-300">
                    Archivar
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </RewardsShell>
  );
}
