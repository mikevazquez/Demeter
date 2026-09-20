import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { RewardsShell } from "../RewardsNav";
import { EmptyState, StatusBadge } from "../ui";

export default async function RewardsTrackingPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_READ);
  const search = String(query.q ?? "").trim();
  const type = ["programs", "challenges", "achievements"].includes(String(query.type))
    ? String(query.type)
    : "programs";

  let studentsQuery = ctx.supabase
    .from("students")
    .select("id,full_name,lifecycle_status")
    .eq("studio_id", ctx.studio.id)
    .order("full_name")
    .limit(100);
  if (search) studentsQuery = studentsQuery.ilike("full_name", `%${search}%`);
  const { data: students } = await studentsQuery;
  const studentIds = (students ?? []).map((student) => student.id);

  const programResult = studentIds.length
    ? await ctx.supabase
        .from("reward_program_participations")
        .select("id,program_id,student_id,status,current_level_order,program_version_number,updated_at")
        .eq("studio_id", ctx.studio.id)
        .in("student_id", studentIds)
        .order("updated_at", { ascending: false })
    : { data: [] };

  const ruleResult = studentIds.length
    ? await ctx.supabase
        .from("reward_participations")
        .select("id,rule_id,student_id,status,joined_version_number,updated_at")
        .eq("studio_id", ctx.studio.id)
        .in("student_id", studentIds)
        .order("updated_at", { ascending: false })
    : { data: [] };

  const studentMap = new Map((students ?? []).map((student) => [student.id, student]));
  const programIds = [...new Set((programResult.data ?? []).map((row) => row.program_id))];
  const programVersionsResult = programIds.length
    ? await ctx.supabase
        .from("reward_program_versions")
        .select("program_id,version_number,name")
        .in("program_id", programIds)
    : { data: [] };
  const programMap = new Map(
    (programVersionsResult.data ?? []).map((row) => [
      `${row.program_id}:${row.version_number}`,
      row.name,
    ]),
  );

  const ruleIds = [...new Set((ruleResult.data ?? []).map((row) => row.rule_id))];
  const ruleVersionsResult = ruleIds.length
    ? await ctx.supabase
        .from("reward_rule_versions")
        .select("rule_id,version_number,name,family")
        .in("rule_id", ruleIds)
    : { data: [] };
  const ruleMap = new Map(
    (ruleVersionsResult.data ?? []).map((row) => [
      `${row.rule_id}:${row.version_number}`,
      row,
    ]),
  );

  const programRows = (programResult.data ?? []).map((row) => ({
    id: row.id,
    studentId: row.student_id,
    name:
      programMap.get(`${row.program_id}:${row.program_version_number}`) ?? "Programa",
    detail:
      row.status === "completed"
        ? "Programa completado"
        : `Nivel actual ${row.current_level_order ?? "—"}`,
    status: row.status,
  }));

  const ruleRows = (ruleResult.data ?? [])
    .map((row) => {
      const version = ruleMap.get(`${row.rule_id}:${row.joined_version_number}`);
      return { row, version };
    })
    .filter(({ version }) =>
      type === "challenges"
        ? version?.family === "challenge"
        : version?.family === "achievement",
    )
    .map(({ row, version }) => ({
      id: row.id,
      studentId: row.student_id,
      name: version?.name ?? "Progreso",
      detail: row.status === "fulfilled" ? "Completado" : "En progreso",
      status: row.status,
    }));

  const rows = type === "programs" ? programRows : ruleRows;

  return (
    <RewardsShell>
      <header>
        <p className="eyebrow">SEGUIMIENTO · {ctx.studio.name}</p>
        <h1 className="dashboard-title">Seguimiento</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Observa progreso real. Desde aquí no se puede editar ni fabricar avance.
        </p>
      </header>

      <form className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:grid-cols-[1fr_220px_auto]">
        <input
          name="q"
          defaultValue={search}
          placeholder="Buscar alumna"
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
        />
        <select
          name="type"
          defaultValue={type}
          className="rounded-xl border border-white/10 bg-[#111114] px-3 py-2.5 text-white"
        >
          <option value="programs">Programas</option>
          <option value="challenges">Retos</option>
          <option value="achievements">Logros</option>
        </select>
        <button className="rounded-xl border border-[#FF0A8A]/30 bg-[#FF0A8A]/10 px-4 py-2.5 text-sm font-semibold text-[#ff64b6]">
          Aplicar
        </button>
      </form>

      {!rows.length ? (
        <EmptyState title="No hay progreso que coincida con estos filtros" />
      ) : (
        <section className="grid gap-2">
          {rows.map((row) => {
            const student = studentMap.get(row.studentId);
            return (
              <Link
                key={row.id}
                href={`/admin/recompensas/seguimiento/${row.studentId}`}
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 transition hover:border-[#FF0A8A]/35"
              >
                <div>
                  <strong className="text-white">{student?.full_name ?? "Alumna"}</strong>
                  <p className="mt-1 text-sm text-zinc-400">
                    {row.name} · {row.detail}
                  </p>
                </div>
                <StatusBadge status={row.status} />
              </Link>
            );
          })}
        </section>
      )}
    </RewardsShell>
  );
}
