"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { markPoleFigureFromClassAction } from "./pole-actions";
import styles from "./pole-class-combo.module.css";

type StudentState = {
  studentId: string;
  name: string;
  levelTitle: string;
  completed: boolean;
};

type FigureState = {
  elementId: string;
  name: string;
  originalName: string;
  slug: string;
  status: "review" | "new";
  students: StudentState[];
};

export type PoleComboRecommendation = {
  id: string;
  level: string;
  figures: FigureState[];
  newFigureElementId: string;
};

function MarkButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending}>
      {pending ? "Guardando…" : "Marcar hecha"}
    </button>
  );
}

export default function PoleClassComboClient({
  sessionId,
  recommendations,
  studentCount,
  canWrite,
}: {
  sessionId: string;
  recommendations: PoleComboRecommendation[];
  studentCount: number;
  canWrite: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);

  if (!recommendations.length || !studentCount) return null;

  const combo = recommendations[index % recommendations.length];
  const newFigure = combo.figures.find((figure) => figure.elementId === combo.newFigureElementId);

  return (
    <section className={styles.panel}>
      <div className={styles.heading}>
        <div>
          <p>CATÁLOGO · COMBO DE CLASE</p>
          <h2>Generador para las alumnas agendadas</h2>
          <span>
            El combo usa el nivel más bajo del grupo y prioriza figuras ya conocidas como apoyo,
            dejando una figura nueva para trabajar hoy.
          </span>
        </div>
        {!visible ? (
          <button className={styles.generate} type="button" onClick={() => setVisible(true)}>
            Generar combo
          </button>
        ) : null}
      </div>

      {visible ? (
        <>
          <div className={styles.comboHeader}>
            <div>
              <span>Combo sugerido</span>
              <strong>{combo.level}</strong>
            </div>
            {recommendations.length > 1 ? (
              <button
                type="button"
                onClick={() => setIndex((value) => (value + 1) % recommendations.length)}
              >
                Generar otro
              </button>
            ) : null}
          </div>

          <div className={styles.sequence}>
            {combo.figures.map((figure, figureIndex) => (
              <article
                key={figure.elementId}
                className={figure.status === "new" ? styles.newFigure : styles.reviewFigure}
              >
                <div className={styles.figureTop}>
                  <span className={styles.position}>{figureIndex + 1}</span>
                  <div>
                    <strong>{figure.name}</strong>
                    {figure.originalName !== figure.name ? (
                      <small>{figure.originalName}</small>
                    ) : null}
                  </div>
                  <b>{figure.status === "new" ? "Nueva" : "Repaso"}</b>
                </div>

                <div className={styles.students}>
                  {figure.students.map((student) => (
                    <div key={student.studentId} className={styles.studentRow}>
                      <div>
                        <strong>{student.name}</strong>
                        <span>{student.levelTitle}</span>
                      </div>
                      {student.completed ? (
                        <em>✓ Hecha</em>
                      ) : figure.status === "new" ? (
                        <form action={markPoleFigureFromClassAction}>
                          <input type="hidden" name="session_id" value={sessionId} />
                          <input type="hidden" name="student_id" value={student.studentId} />
                          <input type="hidden" name="element_id" value={figure.elementId} />
                          <MarkButton />
                        </form>
                      ) : (
                        <em className={styles.pending}>Pendiente</em>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>

          {newFigure ? (
            <div className={styles.newSummary}>
              <div>
                <span>Figura nueva de hoy</span>
                <strong>{newFigure.name}</strong>
              </div>
              <p>
                Al terminar la clase, marca como hecha únicamente a las alumnas que realmente la
                lograron. Después se habilita la foto en su portal.
              </p>
            </div>
          ) : null}
        </>
      ) : (
        <div className={styles.placeholder}>
          <span>{studentCount}</span>
          <p>
            {studentCount === 1
              ? "1 alumna agendada lista para generar su combo."
              : `${studentCount} alumnas agendadas listas para generar el combo del grupo.`}
          </p>
        </div>
      )}
    </section>
  );
}
