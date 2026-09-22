"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { SessionOperations } from "./SessionOperations";

export type TodayRosterItem = {
  id: string;
  studentName: string;
  status: string;
  packageLabel: string;
  creditsLabel: string;
  expiresLabel: string;
  studentId?: string | null;
  evaluationInvitationId?: string | null;
  evaluationStatus?: string | null;
  attendanceSource?: string | null;
  checkedInAt?: string | null;
};

export type TodayCandidate = {
  id: string;
  fullName: string;
  eligible: boolean;
  detail: string;
};

export type TodayClassItem = {
  id: string;
  time: string;
  startsAt: string;
  endsAt: string;
  name: string;
  instructor: string;
  space: string;
  occupied: number;
  capacity: number;
  color: string;
  sessionStatus: string;
  roster: TodayRosterItem[];
  candidates: TodayCandidate[];
  available: number;
  evaluationCount: number;
  returnTo: string;
};

type TodayClassesProps = {
  classes: TodayClassItem[];
  returnDate: string;
  canAttendance: boolean;
  canBook: boolean;
  canCreateStudent: boolean;
  canCorrectCompleted?: boolean;
  serverNow: string;
};

export function TodayClasses({
  classes,
  returnDate,
  canAttendance,
  canBook,
  canCreateStudent,
  canCorrectCompleted = true,
  serverNow,
}: TodayClassesProps) {
  const router = useRouter();
  const initialNow = useMemo(() => new Date(serverNow).getTime(), [serverNow]);
  const [now, setNow] = useState(initialNow);
  const effectiveNow = Math.max(now, initialNow);

  useEffect(() => {
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      setNow(initialNow + (Date.now() - startedAt));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [initialNow]);

  const hasLiveOrClosingSession = classes.some((item) => {
    if (item.sessionStatus !== "scheduled") return false;
    return effectiveNow >= new Date(item.startsAt).getTime();
  });

  useEffect(() => {
    if (!hasLiveOrClosingSession) return;
    const interval = window.setInterval(() => router.refresh(), 8000);
    return () => window.clearInterval(interval);
  }, [hasLiveOrClosingSession, router]);

  const [openSessionId, setOpenSessionId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const hash = window.location.hash;
    if (!hash.startsWith("#session-")) return null;
    const sessionId = hash.replace("#session-", "");
    return classes.some((item) => item.id === sessionId) ? sessionId : null;
  });

  if (!classes.length) {
    return <div className="today-empty-state">No hay clases programadas para este día.</div>;
  }

  return (
    <div className="today-class-list">
      {classes.map((item) => {
        const isOpen = openSessionId === item.id;
        const startsAt = new Date(item.startsAt).getTime();
        const endsAt = new Date(item.endsAt).getTime();
        const phase =
          item.sessionStatus === "cancelled"
            ? "cancelled"
            : item.sessionStatus === "completed"
              ? "finished"
              : effectiveNow < startsAt
                ? "upcoming"
                : effectiveNow < endsAt
                  ? "live"
                  : "closing";
        const phaseLabel =
          phase === "cancelled"
            ? "Cancelada"
            : phase === "finished"
              ? "Finalizada"
              : phase === "live"
                ? "En curso"
                : phase === "closing"
                  ? "Finalizando"
                  : "Próxima";
        const remainingMs = Math.max(endsAt - effectiveNow, 0);
        const remainingSeconds = Math.floor(remainingMs / 1000);
        const hours = Math.floor(remainingSeconds / 3600);
        const minutes = Math.floor((remainingSeconds % 3600) / 60);
        const seconds = remainingSeconds % 60;
        const remainingLabel = [hours, minutes, seconds]
          .map((value) => String(value).padStart(2, "0"))
          .join(":");

        return (
          <article
            className={`today-class-card${isOpen ? " is-open" : ""}`}
            key={item.id}
            style={{ "--class-accent": item.color } as React.CSSProperties}
          >
            <button
              className="today-class-summary"
              type="button"
              onClick={() => {
                const next = isOpen ? null : item.id;
                setOpenSessionId(next);
                const url = new URL(window.location.href);
                url.hash = next ? `session-${next}` : "";
                window.history.replaceState(null, "", url.toString());
              }}
              aria-expanded={isOpen}
              aria-controls={`session-${item.id}`}
            >
              <span className="today-class-accent" aria-hidden="true" />
              <span className="today-class-time">
                <i aria-hidden="true" />
                {item.time}
              </span>
              <span className="today-class-copy">
                <strong>{item.name}</strong>
                <small>
                  {item.instructor} · {item.space}
                </small>
                <span className="today-class-state-row">
                  <span className={`today-class-state is-${phase}`}>{phaseLabel}</span>
                  {phase === "live" ? (
                    <span className="today-class-countdown" aria-label="Tiempo restante">
                      ◷ {remainingLabel}
                    </span>
                  ) : null}
                </span>
                {item.evaluationCount > 0 ? (
                  <small className="today-class-evaluation-summary">
                    {item.evaluationCount}{" "}
                    {item.evaluationCount === 1
                      ? "evaluación programada"
                      : "evaluaciones programadas"}
                  </small>
                ) : null}
              </span>
              <span className="today-class-capacity">
                {item.occupied}/{item.capacity}
              </span>
              <span className="today-class-chevron" aria-hidden="true">
                {isOpen ? "⌃" : "⌄"}
              </span>
            </button>

            {isOpen ? (
              <SessionOperations
                sessionId={item.id}
                returnDate={returnDate}
                sessionStatus={item.sessionStatus}
                startsAt={item.startsAt}
                endsAt={item.endsAt}
                roster={item.roster}
                candidates={item.candidates}
                available={item.available}
                canAttendance={canAttendance}
                canBook={canBook}
                canCreateStudent={canCreateStudent}
                canCorrectCompleted={canCorrectCompleted}
                returnTo={item.returnTo}
                initiallyOpen
                showToggle={false}
              />
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
