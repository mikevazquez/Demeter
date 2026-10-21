"use client";

import { useMemo, useState, useTransition } from "react";

import { savePoleClassResultsAction, setProfessionalPoleAuthorizationAction } from "./pole-actions";
import styles from "./pole-class-combo.module.css";

type StudentState = {
  studentId: string;
  name: string;
  levelTitle: string;
  completedAtLevel: number;
  totalAtLevel: number;
};

type FigureState = {
  elementId: string;
  name: string;
  originalName: string;
  slug: string;
  type: string;
  status: "review" | "new";
};

export type PoleComboRecommendation = {
  id: string;
  level: string;
  figures: FigureState[];
  newFigureElementId: string;
  newFigureSlug: string;
};

export type PoleProfessionalSuggestion = {
  studentId: string;
  studentName: string;
  elementId: string;
  slug: string;
  name: string;
  family: string;
  authorized: boolean;
  completed: boolean;
};

export type PoleClassGroup = {
  level: "Principiante" | "Intermedio" | "Avanzado";
  label: string;
  members: StudentState[];
  recommendations: PoleComboRecommendation[];
  professionalSuggestions: PoleProfessionalSuggestion[];
};

export default function PoleClassComboClient({
  sessionId,
  groups,
  canWrite,
}: {
  sessionId: string;
  groups: PoleClassGroup[];
  canWrite: boolean;
}) {
  const [generated, setGenerated] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [optionIndex, setOptionIndex] = useState<Record<string, number>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);
  const [authorizationState, setAuthorizationState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      groups.flatMap((group) =>
        group.professionalSuggestions.map((suggestion) => [
          `${suggestion.studentId}|${suggestion.elementId}`,
          suggestion.authorized,
        ]),
      ),
    ),
  );
  const [professionalCompleted, setProfessionalCompleted] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      groups.flatMap((group) =>
        group.professionalSuggestions.map((suggestion) => [
          `${suggestion.studentId}|${suggestion.elementId}`,
          suggestion.completed,
        ]),
      ),
    ),
  );
  const [authorizationPending, setAuthorizationPending] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const activeCombos = useMemo(
    () =>
      groups
        .map((group) => {
          if (!group.recommendations.length) return null;
          const index = optionIndex[group.level] ?? 0;
          return {
            group,
            combo: group.recommendations[index % group.recommendations.length],
          };
        })
        .filter(
          (
            item,
          ): item is {
            group: PoleClassGroup;
            combo: PoleComboRecommendation;
          } => Boolean(item),
        ),
    [groups, optionIndex],
  );

  const totalStudents = groups.reduce((sum, group) => sum + group.members.length, 0);

  function nextOption(group: PoleClassGroup) {
    setOptionIndex((current) => ({
      ...current,
      [group.level]: ((current[group.level] ?? 0) + 1) % Math.max(group.recommendations.length, 1),
    }));
    setChecked({});
    setSaved(false);
  }

  function saveResults() {
    if (!canWrite) return;

    const entries = activeCombos.flatMap(({ group, combo }) =>
      group.members
        .filter((student) => checked[`${group.level}|${student.studentId}`] === true)
        .map((student) => ({
          studentId: student.studentId,
          elementId: combo.newFigureElementId,
        })),
    );

    startTransition(async () => {
      const result = await savePoleClassResultsAction(sessionId, entries);
      if (result.ok) setSaved(true);
    });
  }

  function toggleProfessionalAuthorization(suggestion: PoleProfessionalSuggestion) {
    if (!canWrite) return;

    const key = `${suggestion.studentId}|${suggestion.elementId}`;
    const nextValue = !(authorizationState[key] ?? suggestion.authorized);
    setAuthorizationPending(key);

    startTransition(async () => {
      try {
        const result = await setProfessionalPoleAuthorizationAction(
          sessionId,
          suggestion.studentId,
          suggestion.elementId,
          nextValue,
        );

        if (result.ok) {
          setAuthorizationState((current) => ({ ...current, [key]: nextValue }));
        }
      } finally {
        setAuthorizationPending(null);
      }
    });
  }

  function markProfessionalAchievement(suggestion: PoleProfessionalSuggestion) {
    if (!canWrite) return;

    const key = `${suggestion.studentId}|${suggestion.elementId}`;
    setAuthorizationPending(key);

    startTransition(async () => {
      try {
        const result = await savePoleClassResultsAction(sessionId, [
          {
            studentId: suggestion.studentId,
            elementId: suggestion.elementId,
          },
        ]);

        if (result.ok) {
          setProfessionalCompleted((current) => ({ ...current, [key]: true }));
        }
      } finally {
        setAuthorizationPending(null);
      }
    });
  }

  if (!groups.length) return null;

  return (
    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <div>
          <p>COMBO DE CLASE</p>
          <h3>Pole por niveles</h3>
          <span>
            {totalStudents} {totalStudents === 1 ? "alumna" : "alumnas"} · {groups.length}{" "}
            {groups.length === 1 ? "nivel" : "niveles"}
          </span>
        </div>

        {!generated ? (
          <button className={styles.primary} type="button" onClick={() => setGenerated(true)}>
            Generar combos
          </button>
        ) : (
          <button
            className={styles.secondary}
            type="button"
            onClick={() => setShowResults((value) => !value)}
          >
            {showResults ? "Ver combos" : "Registrar resultados"}
          </button>
        )}
      </div>

      {!generated ? (
        <div className={styles.readyState}>
          <strong>Listo para generar</strong>
          <span>
            Studio Flow usará el nivel y las figuras logradas de las alumnas inscritas en esta
            clase.
          </span>
        </div>
      ) : !showResults ? (
        <div className={styles.comboStack}>
          {groups.map((group) => {
            if (!group.recommendations.length) {
              return (
                <article className={styles.card} key={group.level}>
                  <div className={styles.groupHeader}>
                    <div>
                      <span>{group.label}</span>
                      <strong>{group.members.map((student) => student.name).join(" · ")}</strong>
                    </div>
                  </div>
                  <p className={styles.emptyMessage}>
                    No hay una figura nueva disponible que todas las alumnas de este nivel tengan
                    preparada por prerrequisitos.
                  </p>
                </article>
              );
            }

            const index = optionIndex[group.level] ?? 0;
            const combo = group.recommendations[index % group.recommendations.length];

            return (
              <article className={styles.card} key={group.level}>
                <div className={styles.groupHeader}>
                  <div>
                    <span>{group.label}</span>
                    <strong>{group.members.map((student) => student.name).join(" · ")}</strong>
                  </div>
                  {group.recommendations.length > 1 ? (
                    <button type="button" onClick={() => nextOption(group)}>
                      Otra opción
                    </button>
                  ) : null}
                </div>

                <div className={styles.studentProgress}>
                  {group.members.map((student) => (
                    <span key={student.studentId}>
                      {student.name}: {student.completedAtLevel}/{student.totalAtLevel}
                    </span>
                  ))}
                </div>

                <div className={styles.sequence}>
                  {combo.figures.map((figure, figureIndex) => (
                    <div
                      className={figure.status === "new" ? styles.sequenceNew : styles.sequenceRow}
                      key={figure.elementId}
                    >
                      <span className={styles.position}>{figureIndex + 1}</span>
                      <div>
                        <strong>{figure.name}</strong>
                        <small>
                          {figure.originalName} · {figure.type}
                        </small>
                      </div>
                      <b>{figure.status === "new" ? "Nueva" : "Repaso"}</b>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className={styles.comboStack}>
          {activeCombos.map(({ group, combo }) => {
            const newFigure = combo.figures.find(
              (figure) => figure.elementId === combo.newFigureElementId,
            );
            if (!newFigure) return null;

            return (
              <article className={styles.card} key={group.level}>
                <div className={styles.validationHeader}>
                  <div>
                    <span>{group.label}</span>
                    <strong>{newFigure.name}</strong>
                  </div>
                  <b>Figura nueva</b>
                </div>

                <div className={styles.validationList}>
                  {group.members.map((student) => {
                    const key = `${group.level}|${student.studentId}`;
                    return (
                      <label className={styles.validationRow} key={student.studentId}>
                        <div>
                          <strong>{student.name}</strong>
                          <small>{student.levelTitle}</small>
                        </div>
                        <span>
                          <input
                            type="checkbox"
                            checked={checked[key] ?? false}
                            onChange={(event) =>
                              setChecked((current) => ({
                                ...current,
                                [key]: event.target.checked,
                              }))
                            }
                            disabled={!canWrite || saved}
                          />
                          La logró
                        </span>
                      </label>
                    );
                  })}
                </div>
              </article>
            );
          })}

          {groups.some((group) => group.professionalSuggestions.length) ? (
            <article className={styles.card}>
              <div className={styles.validationHeader}>
                <div>
                  <span>PROFESIONAL</span>
                  <strong>Autorizaciones individuales</strong>
                </div>
                <b className={styles.professionalBadge}>Alto riesgo</b>
              </div>
              <div className={styles.validationList}>
                {groups.flatMap((group) =>
                  group.professionalSuggestions.map((suggestion) => {
                    const key = `${suggestion.studentId}|${suggestion.elementId}`;
                    const authorized = authorizationState[key] ?? suggestion.authorized;
                    const completed = professionalCompleted[key] ?? suggestion.completed;

                    return (
                      <div className={styles.professionalRow} key={key}>
                        <div>
                          <strong>{suggestion.studentName}</strong>
                          <small>
                            {suggestion.name} · {suggestion.family}
                          </small>
                        </div>
                        <div className={styles.professionalActions}>
                          {completed ? (
                            <span className={styles.professionalDone}>Lograda ✓</span>
                          ) : authorized && canWrite ? (
                            <button
                              type="button"
                              className={styles.authorizedButton}
                              onClick={() => markProfessionalAchievement(suggestion)}
                              disabled={authorizationPending === key}
                            >
                              {authorizationPending === key ? "Guardando…" : "La logró"}
                            </button>
                          ) : null}
                          {canWrite && !completed ? (
                            <button
                              type="button"
                              className={
                                authorized ? styles.authorizedButton : styles.authorizeButton
                              }
                              onClick={() => toggleProfessionalAuthorization(suggestion)}
                              disabled={authorizationPending === key}
                            >
                              {authorizationPending === key
                                ? "Guardando…"
                                : authorized
                                  ? "Revocar"
                                  : "Autorizar"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  }),
                )}
              </div>
            </article>
          ) : null}

          {canWrite ? (
            <button
              className={styles.save}
              type="button"
              onClick={saveResults}
              disabled={isPending}
            >
              {isPending ? "Guardando…" : "Guardar progreso"}
            </button>
          ) : null}

          {saved ? (
            <div className={styles.success} role="status">
              Progreso guardado.
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
