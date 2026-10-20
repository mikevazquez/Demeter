"use client";

import { useMemo, useState, useTransition } from "react";

import { savePoleClassResultsAction } from "./pole-actions";
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

export type PoleClassGroup = {
  level: "Principiante" | "Intermedio" | "Avanzado";
  label: string;
  members: StudentState[];
  recommendations: PoleComboRecommendation[];
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
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [optionIndex, setOptionIndex] = useState<Record<string, number>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);
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

  if (!groups.length) return null;

  return (
    <section className={styles.panel}>
      <nav className={styles.stepper} aria-label="Progreso de la clase Pole">
        {[
          [1, "Abrir la clase"],
          [2, "Combos por nivel"],
          [3, "Validar al final"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-current={step === value ? "step" : undefined}
            className={step > Number(value) ? styles.pastStep : undefined}
            onClick={() => setStep(Number(value) as 1 | 2 | 3)}
          >
            <i />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {step === 1 ? (
        <div className={styles.stage}>
          <div className={styles.explain}>
            <p className={styles.eyebrow}>PASO 1 DE 3</p>
            <h2>La instructora abre su clase</h2>
            <p>
              Studio Flow ya conoce el nivel de cada alumna y qué figuras domina por validaciones
              anteriores.
            </p>
            <ul>
              <li>Las alumnas se agrupan por su nivel actual.</li>
              <li>Cada nivel recibirá su propio combo.</li>
              <li>Profesional nunca entra al generador automático.</li>
            </ul>
            <button className={styles.primary} type="button" onClick={() => setStep(2)}>
              Generar combos para esta clase
            </button>
          </div>

          <div className={styles.card}>
            <div className={styles.classHeader}>
              <span>POLE FITNESS · CLASE ABIERTA</span>
              <strong>{totalStudents} alumnas reservadas</strong>
            </div>
            <div className={styles.roster}>
              {groups.flatMap((group) =>
                group.members.map((student) => (
                  <div className={styles.rosterRow} key={student.studentId}>
                    <span className={styles.avatar}>{student.name.slice(0, 1).toUpperCase()}</span>
                    <div>
                      <strong>{student.name}</strong>
                      <small>
                        Ya domina {student.completedAtLevel} de {student.totalAtLevel} figuras de su
                        nivel
                      </small>
                    </div>
                    <b>{group.level}</b>
                  </div>
                )),
              )}
            </div>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className={styles.stage}>
          <div className={styles.explain}>
            <p className={styles.eyebrow}>PASO 2 DE 3</p>
            <h2>Studio Flow arma un combo por nivel</h2>
            <p>
              Cada grupo recibe figuras que todas ya dominan y una sola figura nueva para la que ya
              cumplen los prerrequisitos.
            </p>
            <ul>
              <li>Repaso para preparar el cuerpo y la técnica.</li>
              <li>Una figura nueva destacada por grupo.</li>
              <li>“Otra opción” cambia solo el combo de ese nivel.</li>
            </ul>
            <div className={styles.actions}>
              <button type="button" onClick={() => setStep(1)}>
                Atrás
              </button>
              <button className={styles.primary} type="button" onClick={() => setStep(3)}>
                Dar la clase
              </button>
            </div>
          </div>

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
                      No hay todavía una figura nueva con todos los prerrequisitos cumplidos para
                      este grupo.
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

                  <div className={styles.sequence}>
                    {combo.figures.map((figure, figureIndex) => (
                      <div
                        className={
                          figure.status === "new" ? styles.sequenceNew : styles.sequenceRow
                        }
                        key={figure.elementId}
                      >
                        <span className={styles.position}>{figureIndex + 1}</span>
                        <div>
                          <strong>{figure.name}</strong>
                          <small>
                            {figure.originalName} · {figure.type}
                          </small>
                        </div>
                        <b>{figure.status === "new" ? "Nueva" : "Ya la saben"}</b>
                      </div>
                    ))}
                  </div>

                  <p className={styles.why}>
                    {group.members.map((student) => student.name).join(" y ")} ya cumplen los pasos
                    previos de la figura nueva, así que hoy pueden intentarla.
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className={styles.stage}>
          <div className={styles.explain}>
            <p className={styles.eyebrow}>PASO 3 DE 3</p>
            <h2>Al terminar, marca quién la logró</h2>
            <p>
              Solo valida a las alumnas que realmente consiguieron la figura nueva. Las demás se
              quedan pendientes para otra clase.
            </p>
            <div className={styles.actions}>
              <button type="button" onClick={() => setStep(2)}>
                Atrás
              </button>
              {canWrite ? (
                <button
                  className={styles.primary}
                  type="button"
                  onClick={saveResults}
                  disabled={isPending}
                >
                  {isPending ? "Guardando…" : "Guardar progreso"}
                </button>
              ) : null}
            </div>
          </div>

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
                            <small>
                              intentó {newFigure.name} · {student.levelTitle}
                            </small>
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

            {saved ? (
              <div className={styles.success} role="status">
                Progreso guardado. Las figuras validadas ya aparecen como logradas en el perfil y
                permiten que la alumna agregue su foto.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
