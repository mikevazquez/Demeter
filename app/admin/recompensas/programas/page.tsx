import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { RewardsShell } from "../RewardsNav";
import { EmptyState, StatusBadge, asObject } from "../ui";

export default async function ProgramsPage() {
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_READ);
  const { data: programs } = await ctx.supabase
    .from("reward_programs")
    .select(
      "id,status,latest_version_number,published_version_number,first_published_at,last_published_at,updated_at",
    )
    .eq("studio_id", ctx.studio.id)
    .order("updated_at", { ascending: false });

  const programIds = (programs ?? []).map((program) => program.id);
  const versionsResult = programIds.length
    ? await ctx.supabase
        .from("reward_program_versions")
        .select(
          "program_id,version_number,name,description,progression_mode,audience_definition,created_at",
        )
        .in("program_id", programIds)
    : { data: [] };

  const versionMap = new Map(
    (versionsResult.data ?? []).map((version) => [
      `${version.program_id}:${version.version_number}`,
      version,
    ]),
  );

  return (
    <RewardsShell>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">PROGRAMAS · {ctx.studio.name}</p>
          <h1 className="dashboard-title">Programas</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Trayectorias permanentes con niveles acumulativos o secuenciales.
          </p>
        </div>
        {ctx.can(CAPABILITIES.REWARDS_MANAGE) ? (
          <Link
            href="/admin/recompensas/programas/nuevo"
            className="rounded-xl bg-[#FF0A8A] px-4 py-2.5 text-sm font-semibold text-white"
          >
            + Nuevo programa
          </Link>
        ) : null}
      </header>

      {!programs?.length ? (
        <EmptyState title="Todavía no hay programas">
          Crea el primero y configura sus niveles antes de publicarlo.
        </EmptyState>
      ) : (
        <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {programs.map((program) => {
            const versionNumber = program.latest_version_number;
            const version = versionMap.get(`${program.id}:${versionNumber}`);
            const audience = asObject(version?.audience_definition);
            const hasDraft = program.published_version_number !== program.latest_version_number;
            return (
              <Link
                key={program.id}
                href={`/admin/recompensas/programas/${program.id}`}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-[#FF0A8A]/35"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#FF0A8A]">
                      {version?.progression_mode === "sequential" ? "SECUENCIAL" : "ACUMULATIVO"}
                    </p>
                    <h2 className="mt-2 text-lg font-semibold text-white">
                      {version?.name ?? "Programa"}
                    </h2>
                  </div>
                  <StatusBadge status={program.status} />
                </div>
                <p className="mt-3 line-clamp-2 text-sm leading-6 text-zinc-400">
                  {version?.description || "Sin descripción."}
                </p>
                <div className="mt-5 flex flex-wrap gap-2 text-xs text-zinc-500">
                  <span className="rounded-full border border-white/10 px-2.5 py-1">
                    {audience.scope === "all_students" ? "Todas" : "Activas"}
                  </span>
                  {hasDraft ? (
                    <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-amber-300">
                      Cambios sin publicar
                    </span>
                  ) : null}
                  <span className="rounded-full border border-white/10 px-2.5 py-1">
                    v{versionNumber}
                  </span>
                </div>
              </Link>
            );
          })}
        </section>
      )}
    </RewardsShell>
  );
}
