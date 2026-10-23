import Link from "next/link";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import {
  mandatoryReadiness,
  POLE_CATALOG_LEVEL_LABEL,
  POLE_KEY_TARGET_LEVEL,
  POLE_MANDATORY_MAX,
  POLE_NEXT_STUDENT_LEVEL,
  POLE_STUDENT_LEVEL_LABEL,
  POLE_STUDENT_LEVELS,
  type PoleCatalogLevel,
  type PoleStudentLevel,
} from "@/lib/pole/level-settings";

import {
  approvePoleLevelAction,
  generatePoleTemplatesAction,
  proposePoleMandatoryAction,
  setPoleMandatoryAction,
  setPoleMinimumAction,
} from "./actions";
import styles from "./obligatorias.module.css";

type SettingRow = {
  level_key: PoleStudentLevel;
  catalog_level: PoleCatalogLevel;
  min_score_to_advance: number | null;
};

type MandatoryRow = {
  level_key: PoleStudentLevel;
  figure_element_id: string;
  status: "proposed" | "approved";
  unlocks_count: number;
};

type ProfileRow = {
  element_id: string;
  catalog_level: string;
  in_core_program: boolean;
  requires_authorization: boolean;
  sort_order: number;
};

const MESSAGES: Record<string, string> = {
  proposed: "Propuesta actualizada. Las figuras aprobadas se conservaron.",
  approved: "Figura aprobada como obligatoria.",
  approved_level: "Nivel aprobado.",
  proposed_state: "La figura volvió a propuesta.",
  removed: "Figura quitada de las obligatorias.",
  minimum: "Mínimo actualizado.",
  pole_mandatory_limit:
    "Cada nivel admite como máximo 5 obligatorias. Quita una antes de agregar otra.",
  pole_mandatory_level_mismatch: "La figura no pertenece al nivel del catálogo de ese nivel.",
  pole_minimum_invalid: "El mínimo debe estar entre 1 y 100. Élite no tiene mínimo porque no sube.",
  forbidden: "Tu rol no puede cambiar la configuración de evaluaciones.",
  invalid: "Revisa los datos e intenta de nuevo.",
  save_failed: "No se pudo guardar. Intenta de nuevo.",
};

const READINESS_LABEL = {
  missing: "Sin obligatorias",
  proposed: "Propuesta sin aprobar",
  partial: "Aprobación incompleta",
  ready: "Listo para evaluar",
} as const;

export default async function PoleMandatoryPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; level?: string; count?: string }>;
}) {
  const [ctx, qs] = await Promise.all([
    getAdminContext(CAPABILITIES.EVALUATIONS_READ),
    searchParams,
  ]);
  const canConfigure = ctx.can(CAPABILITIES.EVALUATIONS_CONFIGURE);
  const studioId = ctx.studio.id;

  const { data: anyProfile } = await ctx.supabase
    .from("pole_figure_profiles")
    .select("discipline_id")
    .eq("studio_id", studioId)
    .limit(1)
    .maybeSingle();
  const disciplineId = anyProfile?.discipline_id as string | undefined;

  const [settingsResult, mandatoryResult, profilesResult, generatedResult] = disciplineId
    ? await Promise.all([
        ctx.supabase
          .from("pole_level_settings")
          .select("level_key,catalog_level,min_score_to_advance")
          .eq("studio_id", studioId)
          .eq("discipline_id", disciplineId),
        ctx.supabase
          .from("pole_level_mandatory_figures")
          .select("level_key,figure_element_id,status,unlocks_count")
          .eq("studio_id", studioId)
          .eq("discipline_id", disciplineId),
        ctx.supabase
          .from("pole_figure_profiles")
          .select("element_id,catalog_level,in_core_program,requires_authorization,sort_order")
          .eq("studio_id", studioId)
          .eq("discipline_id", disciplineId)
          .eq("in_core_program", true)
          .order("sort_order"),
        ctx.supabase
          .from("pole_generated_templates")
          .select(
            "level_key,template_version_id,generated_at,evaluation_template_versions(version_number,status)",
          )
          .eq("studio_id", studioId)
          .eq("discipline_id", disciplineId)
          .order("generated_at", { ascending: false }),
      ])
    : [null, null, null, null];

  const unavailable = !disciplineId || Boolean(settingsResult?.error || mandatoryResult?.error);
  const settings = (settingsResult?.data ?? []) as SettingRow[];
  const mandatory = (mandatoryResult?.data ?? []) as MandatoryRow[];
  const profiles = (profilesResult?.data ?? []) as ProfileRow[];
  const generated = new Map<string, { version: number | null; status: string | null }>();
  for (const row of (generatedResult?.data ?? []) as Array<{
    level_key: string;
    evaluation_template_versions:
      | { version_number: number; status: string }
      | Array<{ version_number: number; status: string }>
      | null;
  }>) {
    if (generated.has(row.level_key)) continue;
    const version = Array.isArray(row.evaluation_template_versions)
      ? row.evaluation_template_versions[0]
      : row.evaluation_template_versions;
    generated.set(row.level_key, {
      version: version?.version_number ?? null,
      status: version?.status ?? null,
    });
  }

  const relevantIds = [
    ...new Set([
      ...mandatory.map((row) => row.figure_element_id),
      ...profiles.map((p) => p.element_id),
    ]),
  ];
  const [{ data: elements }, { data: unlockRows }] = await Promise.all([
    relevantIds.length
      ? ctx.supabase
          .from("technical_elements")
          .select("id,name,active")
          .eq("studio_id", studioId)
          .in("id", relevantIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; active: boolean }> }),
    mandatory.length
      ? ctx.supabase
          .from("pole_figure_prerequisites")
          .select("required_element_id,figure_element_id")
          .eq("studio_id", studioId)
          .in(
            "required_element_id",
            mandatory.map((row) => row.figure_element_id),
          )
      : Promise.resolve({
          data: [] as Array<{ required_element_id: string; figure_element_id: string }>,
        }),
  ]);

  const unlockedIds = [...new Set((unlockRows ?? []).map((row) => row.figure_element_id))];
  const { data: unlockedProfiles } = unlockedIds.length
    ? await ctx.supabase
        .from("pole_figure_profiles")
        .select("element_id,catalog_level")
        .eq("studio_id", studioId)
        .in("element_id", unlockedIds)
    : { data: [] as Array<{ element_id: string; catalog_level: string }> };
  const { data: unlockedElements } = unlockedIds.length
    ? await ctx.supabase.from("technical_elements").select("id,name").in("id", unlockedIds)
    : { data: [] as Array<{ id: string; name: string }> };

  const names = new Map<string, string>();
  for (const element of [...(elements ?? []), ...(unlockedElements ?? [])]) {
    names.set(element.id, element.name);
  }
  const activeIds = new Set((elements ?? []).filter((e) => e.active).map((e) => e.id));
  const unlockedLevel = new Map(
    (unlockedProfiles ?? []).map((p) => [p.element_id, p.catalog_level]),
  );

  function unlocksFor(figureId: string, level: PoleStudentLevel) {
    const target = POLE_KEY_TARGET_LEVEL[level];
    return (unlockRows ?? [])
      .filter((row) => row.required_element_id === figureId)
      .filter((row) => !target || unlockedLevel.get(row.figure_element_id) === target)
      .map((row) => names.get(row.figure_element_id))
      .filter((name): name is string => Boolean(name))
      .sort((a, b) => a.localeCompare(b, "es"));
  }

  const generatedNotice =
    qs.saved === "generated"
      ? Number(qs.count ?? 0) > 0
        ? `Se generaron ${qs.count} evaluaciones. Las que ya estaban al día no cambiaron.`
        : "No hubo cambios: las evaluaciones ya estaban al día o faltan obligatorias por aprobar."
      : null;
  const notice =
    generatedNotice ??
    (qs.error
      ? MESSAGES[qs.error]
      : qs.saved
        ? MESSAGES[qs.saved === "proposed" && qs.level ? "proposed_state" : qs.saved]
        : null);

  return (
    <main className={styles.page}>
      <div className={styles.wrap}>
        <header className={styles.header}>
          <Link className={styles.back} href="/admin/catalogo">
            ← Catálogo
          </Link>
          <div className={styles.eyebrow}>Catálogo de Pole · Evaluaciones</div>
          <h1>Obligatorias por nivel</h1>
          <p className={styles.lede}>
            Cada nivel tiene de 4 a 5 figuras llave para subir al siguiente. El sistema las propone
            según cuántas figuras desbloquean; tú las apruebas o las cambias. Un nivel sólo puede
            evaluarse cuando todas sus obligatorias están aprobadas.
          </p>
          {canConfigure && disciplineId && !unavailable ? (
            <div className={styles.headerActions}>
              <form action={generatePoleTemplatesAction}>
                <input type="hidden" name="discipline_id" value={disciplineId} />
                <button className={styles.primary} type="submit">
                  Generar evaluaciones de los niveles listos
                </button>
              </form>
              <form action={proposePoleMandatoryAction}>
                <input type="hidden" name="discipline_id" value={disciplineId} />
                <button className={styles.secondary} type="submit">
                  Proponer de nuevo (conserva las aprobadas)
                </button>
              </form>
            </div>
          ) : null}
        </header>

        {notice ? (
          <div className={qs.error ? styles.error : styles.success} role="status">
            {notice}
          </div>
        ) : null}

        {unavailable ? (
          <div className={styles.empty}>
            <strong>Configuración pendiente</strong>
            <span>
              La configuración de niveles todavía no está disponible en este entorno. Se activa
              cuando se aplique la migración de POLE-01.
            </span>
          </div>
        ) : (
          <div className={styles.levels}>
            {POLE_STUDENT_LEVELS.map((level) => {
              const setting = settings.find((row) => row.level_key === level);
              const rows = mandatory
                .filter((row) => row.level_key === level)
                .sort((a, b) =>
                  a.status === b.status
                    ? b.unlocks_count - a.unlocks_count
                    : a.status === "approved"
                      ? -1
                      : 1,
                );
              const readiness = mandatoryReadiness(rows.map((row) => row.status));
              const next = POLE_NEXT_STUDENT_LEVEL[level];
              const catalogLevel = setting?.catalog_level;
              const chosen = new Set(rows.map((row) => row.figure_element_id));
              const candidates = profiles.filter(
                (profile) =>
                  profile.catalog_level === catalogLevel &&
                  !profile.requires_authorization &&
                  activeIds.has(profile.element_id) &&
                  !chosen.has(profile.element_id),
              );

              return (
                <section className={styles.level} key={level} aria-labelledby={`level-${level}`}>
                  <div className={styles.levelHead}>
                    <div>
                      <h2 id={`level-${level}`}>{POLE_STUDENT_LEVEL_LABEL[level]}</h2>
                      <p className={styles.meta}>
                        Figuras del catálogo:{" "}
                        {catalogLevel ? POLE_CATALOG_LEVEL_LABEL[catalogLevel] : "—"}
                        {next ? ` · Sube a ${POLE_STUDENT_LEVEL_LABEL[next]}` : " · Nivel máximo"}
                      </p>
                    </div>
                    {next ? (
                      <div className={styles.badges}>
                        <span className={`${styles.badge} ${styles[readiness]}`}>
                          {READINESS_LABEL[readiness]}
                        </span>
                        {generated.get(level)?.status === "active" ? (
                          <span className={`${styles.badge} ${styles.ready}`}>
                            Evaluación v{generated.get(level)?.version} activa
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {next ? (
                    <>
                      <form className={styles.minimum} action={setPoleMinimumAction}>
                        <input type="hidden" name="discipline_id" value={disciplineId} />
                        <input type="hidden" name="level_key" value={level} />
                        <label>
                          <span>Calificación mínima para subir</span>
                          <input
                            name="minimum"
                            type="number"
                            inputMode="decimal"
                            min={1}
                            max={100}
                            step={0.5}
                            defaultValue={setting?.min_score_to_advance ?? ""}
                            disabled={!canConfigure}
                          />
                        </label>
                        {canConfigure ? (
                          <button className={styles.ghost} type="submit">
                            Guardar
                          </button>
                        ) : null}
                      </form>

                      <ol className={styles.figures}>
                        {rows.map((row) => {
                          const unlocks = unlocksFor(row.figure_element_id, level);
                          return (
                            <li className={styles.figure} key={row.figure_element_id}>
                              <div className={styles.figureText}>
                                <strong>{names.get(row.figure_element_id) ?? "Figura"}</strong>
                                <span className={styles.meta}>
                                  {row.status === "approved" ? "Aprobada" : "Propuesta"}
                                  {unlocks.length
                                    ? ` · Llave de ${unlocks.length}: ${unlocks.slice(0, 3).join(", ")}${unlocks.length > 3 ? "…" : ""}`
                                    : ""}
                                </span>
                              </div>
                              {canConfigure ? (
                                <div className={styles.figureActions}>
                                  <form action={setPoleMandatoryAction}>
                                    <input
                                      type="hidden"
                                      name="discipline_id"
                                      value={disciplineId}
                                    />
                                    <input type="hidden" name="level_key" value={level} />
                                    <input
                                      type="hidden"
                                      name="figure_id"
                                      value={row.figure_element_id}
                                    />
                                    <input
                                      type="hidden"
                                      name="state"
                                      value={row.status === "approved" ? "proposed" : "approved"}
                                    />
                                    <button
                                      className={
                                        row.status === "approved" ? styles.ghost : styles.primary
                                      }
                                      type="submit"
                                    >
                                      {row.status === "approved" ? "Desaprobar" : "Aprobar"}
                                    </button>
                                  </form>
                                  <form action={setPoleMandatoryAction}>
                                    <input
                                      type="hidden"
                                      name="discipline_id"
                                      value={disciplineId}
                                    />
                                    <input type="hidden" name="level_key" value={level} />
                                    <input
                                      type="hidden"
                                      name="figure_id"
                                      value={row.figure_element_id}
                                    />
                                    <input type="hidden" name="state" value="removed" />
                                    <button
                                      className={styles.ghost}
                                      type="submit"
                                      aria-label={`Quitar ${names.get(row.figure_element_id) ?? "figura"}`}
                                    >
                                      Quitar
                                    </button>
                                  </form>
                                </div>
                              ) : null}
                            </li>
                          );
                        })}
                        {rows.length === 0 ? (
                          <li className={styles.meta}>Sin obligatorias todavía.</li>
                        ) : null}
                      </ol>

                      {canConfigure ? (
                        <div className={styles.levelFoot}>
                          {rows.some((row) => row.status === "proposed") ? (
                            <form action={approvePoleLevelAction}>
                              <input type="hidden" name="discipline_id" value={disciplineId} />
                              <input type="hidden" name="level_key" value={level} />
                              <button className={styles.primary} type="submit">
                                Aprobar todas las propuestas
                              </button>
                            </form>
                          ) : null}
                          {rows.length < POLE_MANDATORY_MAX && candidates.length ? (
                            <form className={styles.add} action={setPoleMandatoryAction}>
                              <input type="hidden" name="discipline_id" value={disciplineId} />
                              <input type="hidden" name="level_key" value={level} />
                              <input type="hidden" name="state" value="approved" />
                              <label>
                                <span>Agregar figura</span>
                                <select name="figure_id" required defaultValue="">
                                  <option value="" disabled>
                                    Elige una figura del programa base
                                  </option>
                                  {candidates.map((candidate) => (
                                    <option key={candidate.element_id} value={candidate.element_id}>
                                      {names.get(candidate.element_id) ?? "Figura"}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <button className={styles.ghost} type="submit">
                                Agregar
                              </button>
                            </form>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className={styles.meta}>
                      Élite no tiene obligatorias ni mínimo porque es el nivel máximo. Sus
                      evaluaciones usan figuras Profesional y la coach confirma cada una en vivo.
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
