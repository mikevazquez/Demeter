"use client";

import { useMemo, useState, useTransition } from "react";

import { generateCombo, groupStudentsByLevel, type ComboStudent } from "@/lib/pole/combo-generator";
import { POLE_LEVEL_LABEL, type PoleFigure, type PoleGroupLevel } from "@/lib/pole/types";

import {
  savePolePlanAction,
  setPoleAuthorizationAction,
  validatePoleFiguresAction,
  type PoleActionResult,
} from "./pole-actions";

export type PlannerStudent = {
  id: string;
  name: string;
  level: PoleGroupLevel | null;
  levelTitle: string | null;
  proEligible: boolean;
  achieved: string[];
  authorized: string[];
};

export type PlannerSavedPlan = {
  catalog_level: PoleGroupLevel;
  element_ids: string[];
  new_element_id: string | null;
};

const ERROR_COPY: Record<string, string> = {
  evaluation_access_denied: "No tienes permiso para esta acción.",
  pole_validation_student_not_in_session: "Una de las alumnas ya no tiene reserva en esta clase.",
  pole_authorization_student_not_eligible:
    "Sólo se autorizan figuras Profesional a alumnas de nivel Avanzado o Élite.",
  pole_authorization_not_professional: "Esa figura no es de nivel Profesional.",
  pole_plan_invalid_figures: "El combo tiene figuras que no son válidas.",
};

function errorMessage(result: PoleActionResult) {
  return result.ok ? null : (ERROR_COPY[result.error] ?? "No se pudo guardar. Intenta de nuevo.");
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function PolePlanner({
  sessionId,
  figures,
  students,
  savedPlans,
  canWrite,
}: {
  sessionId: string;
  figures: PoleFigure[];
  students: PlannerStudent[];
  savedPlans: PlannerSavedPlan[];
  canWrite: boolean;
}) {
  const byId = useMemo(() => new Map(figures.map((figure) => [figure.id, figure])), [figures]);
  const comboStudents = useMemo<ComboStudent[]>(
    () =>
      students.map((student) => ({
        id: student.id,
        name: student.name.split(/\s+/)[0] || student.name,
        level: student.level,
        achieved: new Set(student.achieved),
      })),
    [students],
  );
  const groups = useMemo(() => groupStudentsByLevel(comboStudents), [comboStudents]);
  const [options, setOptions] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      savedPlans.map((plan) => [plan.catalog_level, plan.element_ids.join(",")] as const),
    ),
  );
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const combos = groups.map((group) => ({
    group,
    combo: generateCombo(group, figures, options[group.level] ?? 0),
  }));

  const coreTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const figure of figures) {
      if (figure.core && figure.level !== "profesional") {
        totals[figure.level] = (totals[figure.level] ?? 0) + 1;
      }
    }
    return totals;
  }, [figures]);

  function coreDone(student: PlannerStudent) {
    const level = student.level ?? "principiante";
    return student.achieved.filter((id) => {
      const figure = byId.get(id);
      return figure?.core && figure.level === level;
    }).length;
  }

  function nextOption(level: string) {
    setOptions((current) => ({ ...current, [level]: (current[level] ?? 0) + 1 }));
    setMessage(null);
  }

  function regenerateAll() {
    setOptions((current) =>
      Object.fromEntries(groups.map((group) => [group.level, (current[group.level] ?? 0) + 1])),
    );
    setMessage(null);
  }

  function savePlan(
    level: PoleGroupLevel,
    sequence: string[],
    newId: string,
    studentIds: string[],
  ) {
    startTransition(async () => {
      const result = await savePolePlanAction({
        sessionId,
        level,
        elementIds: sequence,
        newElementId: newId,
        studentIds,
      });
      if (result.ok) {
        setSaved((current) => ({ ...current, [level]: sequence.join(",") }));
        setMessage({ tone: "success", text: "Combo guardado en la clase." });
      } else {
        setMessage({ tone: "danger", text: errorMessage(result)! });
      }
    });
  }

  const validationRows = combos.flatMap(({ group, combo }) =>
    combo
      ? group.students.map((student) => ({
          key: `${student.id}|${combo.newFigureId}`,
          studentId: student.id,
          studentName: student.name,
          elementId: combo.newFigureId,
          alreadyAchieved: student.achieved.has(combo.newFigureId),
        }))
      : [],
  );

  function saveValidation() {
    const items = validationRows
      .filter((row) => checks[row.key] && !row.alreadyAchieved)
      .map((row) => ({ studentId: row.studentId, elementId: row.elementId }));
    if (!items.length) {
      setMessage({ tone: "danger", text: "Marca al menos a una alumna que logró su figura." });
      return;
    }
    startTransition(async () => {
      const result = await validatePoleFiguresAction({ sessionId, items });
      if (result.ok) {
        setChecks({});
        setMessage({
          tone: "success",
          text: `Guardado: ${items.length} ${items.length === 1 ? "figura lograda" : "figuras logradas"}.`,
        });
      } else {
        setMessage({ tone: "danger", text: errorMessage(result)! });
      }
    });
  }

  const proEligible = students.filter((student) => student.proEligible);

  return (
    <section className="panel pole-planner" aria-labelledby="pole-planner-title">
      <div className="pole-planner-head">
        <div>
          <p className="eyebrow">FIGURAS DE POLE</p>
          <h2 id="pole-planner-title">Combos por nivel</h2>
          <p className="muted">
            Cada combo usa figuras que el grupo ya domina y agrega una figura nueva cuyo paso previo
            ya cumplen todas. Nunca incluye figuras Profesional.
          </p>
        </div>
        {groups.length ? (
          <button type="button" className="secondary-button" onClick={regenerateAll}>
            Generar combos de nuevo
          </button>
        ) : null}
      </div>

      {message ? (
        <p
          className={`ui-badge ui-badge-${message.tone} pole-planner-message`}
          role={message.tone === "danger" ? "alert" : "status"}
        >
          {message.text}
        </p>
      ) : null}

      {!students.length ? (
        <div className="ui-state ui-state-empty">
          <strong>Sin alumnas reservadas</strong>
          <div>Cuando haya reservas, aquí aparecerán los combos por nivel.</div>
        </div>
      ) : (
        <>
          <ul className="pole-student-list">
            {students.map((student) => (
              <li key={student.id}>
                <span className="pole-avatar" aria-hidden="true">
                  {student.name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="pole-student-copy">
                  <strong>{student.name}</strong>
                  <small>
                    {student.level
                      ? `Ya domina ${coreDone(student)} de ${coreTotals[student.level] ?? 0} figuras de su nivel`
                      : "Sin evaluación: se trata como principiante"}
                  </small>
                </span>
                <span
                  className={`ui-badge ${student.level ? "ui-badge-neutral" : "ui-badge-warning"}`}
                >
                  {student.levelTitle ?? "Sin nivel"}
                </span>
              </li>
            ))}
          </ul>

          {combos.map(({ group, combo }) => {
            const one = group.students.length === 1;
            const isSaved = combo ? saved[group.level] === combo.sequence.join(",") : false;
            return (
              <article key={group.level} className="pole-group">
                <div className="pole-group-head">
                  <div>
                    <span className="ui-badge ui-badge-accent">
                      {group.label} · {group.students.map((student) => student.name).join(", ")}
                    </span>
                    {combo ? (
                      <small className="muted">
                        Opción {combo.index + 1} de {combo.total}
                      </small>
                    ) : null}
                  </div>
                  {combo ? (
                    <div className="pole-group-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => nextOption(group.level)}
                      >
                        Otra opción
                      </button>
                      {canWrite ? (
                        <button
                          type="button"
                          className={isSaved ? "secondary-button" : "primary-button"}
                          disabled={pending || isSaved}
                          onClick={() =>
                            savePlan(
                              group.level,
                              combo.sequence,
                              combo.newFigureId,
                              group.students.map((student) => student.id),
                            )
                          }
                        >
                          {isSaved ? "Guardado en la clase ✓" : "Usar en clase"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {group.withoutLevel.length ? (
                  <p className="ui-badge ui-badge-warning pole-planner-message">
                    {group.withoutLevel.map((student) => student.name).join(", ")}{" "}
                    {group.withoutLevel.length === 1 ? "no tiene" : "no tienen"} evaluación en esta
                    disciplina; se incluye{group.withoutLevel.length === 1 ? "" : "n"} con
                    principiantes.
                  </p>
                ) : null}

                {combo ? (
                  <>
                    <ol className="pole-sequence">
                      {combo.sequence.map((id, index) => {
                        const figure = byId.get(id);
                        const isNew = id === combo.newFigureId;
                        return (
                          <li key={id} className={isNew ? "is-new" : undefined}>
                            <span className="pole-sequence-number">{index + 1}</span>
                            <span className="pole-sequence-copy">
                              <strong>{figure?.name ?? "Figura"}</strong>
                              <small>
                                {figure?.original_name} · {figure?.type}
                                {figure && figure.level !== group.level
                                  ? ` · ${POLE_LEVEL_LABEL[figure.level]}`
                                  : ""}
                              </small>
                            </span>
                            <span
                              className={`ui-badge ${isNew ? "pole-badge-new" : "ui-badge-neutral"}`}
                            >
                              {isNew ? "Nueva" : one ? "Ya la sabe" : "Ya la saben"}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                    <p className="muted pole-why">{combo.explanation}</p>
                  </>
                ) : (
                  <p className="muted">No hay figuras nuevas disponibles para este grupo.</p>
                )}
              </article>
            );
          })}

          {canWrite && validationRows.length ? (
            <article className="pole-group">
              <div className="pole-group-head">
                <div>
                  <h3>Al terminar la clase</h3>
                  <small className="muted">
                    Marca quién logró su figura nueva. Se suma a su progreso en el portal.
                  </small>
                </div>
              </div>
              <ul className="pole-validation">
                {validationRows.map((row) => (
                  <li key={row.key}>
                    <span>
                      <strong>{row.studentName}</strong> intentó{" "}
                      <strong>{byId.get(row.elementId)?.name}</strong>
                    </span>
                    {row.alreadyAchieved ? (
                      <span className="ui-badge ui-badge-success">Lograda ✓</span>
                    ) : (
                      <label className="pole-check">
                        <input
                          type="checkbox"
                          id={`pole-check-${row.studentId}`}
                          checked={Boolean(checks[row.key])}
                          onChange={(event) =>
                            setChecks((current) => ({
                              ...current,
                              [row.key]: event.target.checked,
                            }))
                          }
                        />
                        La logró
                      </label>
                    )}
                  </li>
                ))}
              </ul>
              <div className="pole-group-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={pending}
                  onClick={saveValidation}
                >
                  {pending ? "Guardando…" : "Guardar figuras logradas"}
                </button>
              </div>
            </article>
          ) : null}

          {canWrite && proEligible.length ? (
            <ProAuthorizationCard sessionId={sessionId} figures={figures} students={proEligible} />
          ) : null}
        </>
      )}
    </section>
  );
}

export function ProAuthorizationCard({
  sessionId,
  figures,
  students,
}: {
  sessionId: string | null;
  figures: PoleFigure[];
  students: PlannerStudent[];
}) {
  const proFigures = useMemo(
    () => figures.filter((figure) => figure.level === "profesional"),
    [figures],
  );
  const byId = useMemo(() => new Map(figures.map((figure) => [figure.id, figure])), [figures]);
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [authorizedByStudent, setAuthorizedByStudent] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(students.map((student) => [student.id, student.authorized])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const authorized = authorizedByStudent[studentId] ?? [];
  const results = useMemo(() => {
    const needle = normalize(query.trim());
    if (!needle) return [];
    return proFigures
      .filter(
        (figure) =>
          !authorized.includes(figure.id) &&
          (normalize(figure.name).includes(needle) || normalize(figure.family).includes(needle)),
      )
      .slice(0, 8);
  }, [authorized, proFigures, query]);

  function toggle(elementId: string, value: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setPoleAuthorizationAction({
        sessionId,
        studentId,
        elementId,
        authorized: value,
      });
      if (!result.ok) {
        setError(errorMessage(result));
        return;
      }
      setAuthorizedByStudent((current) => {
        const list = current[studentId] ?? [];
        return {
          ...current,
          [studentId]: value ? [...list, elementId] : list.filter((id) => id !== elementId),
        };
      });
    });
  }

  return (
    <article className="pole-group pole-pro">
      <div className="pole-group-head">
        <div>
          <h3>
            Autorizar figuras Profesional{" "}
            <span className="ui-badge ui-badge-danger">Solo instructora</span>
          </h3>
          <small className="muted">
            Son figuras de alto riesgo. Solo se abren para una alumna avanzada si tú la autorizas,
            una por una. Nunca entran a los combos.
          </small>
        </div>
      </div>

      <div className="pole-pro-controls">
        {students.length > 1 ? (
          <label>
            <span>Alumna</span>
            <select
              id="pole-pro-student"
              className="ui-input"
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
            >
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p>
            <strong>{students[0]?.name}</strong>{" "}
            <span className="muted">· {students[0]?.levelTitle ?? "Avanzado"}</span>
          </p>
        )}
        <label>
          <span>Buscar figura o familia</span>
          <input
            id="pole-pro-search"
            className="ui-input"
            type="search"
            placeholder="Ej. Ayesha, Banderas, Splits"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {error ? (
        <p className="ui-badge ui-badge-danger pole-planner-message" role="alert">
          {error}
        </p>
      ) : null}

      {results.length ? (
        <ul className="pole-validation">
          {results.map((figure) => (
            <li key={figure.id}>
              <span>
                <strong>{figure.name}</strong> <small className="muted">· {figure.family}</small>
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={pending}
                onClick={() => toggle(figure.id, true)}
              >
                Autorizar
              </button>
            </li>
          ))}
        </ul>
      ) : query.trim() ? (
        <p className="muted">Sin resultados para esa búsqueda.</p>
      ) : null}

      <div>
        <small className="muted">Autorizadas ({authorized.length})</small>
        {authorized.length ? (
          <ul className="pole-validation">
            {authorized.map((id) => (
              <li key={id}>
                <span>
                  <strong>{byId.get(id)?.name ?? "Figura"}</strong>{" "}
                  <small className="muted">· {byId.get(id)?.family}</small>
                </span>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={pending}
                  onClick={() => toggle(id, false)}
                >
                  Revocar
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Todavía no tiene figuras Profesional autorizadas.</p>
        )}
      </div>
    </article>
  );
}
