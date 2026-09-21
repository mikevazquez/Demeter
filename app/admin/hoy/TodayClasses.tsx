"use client";

import { useEffect, useMemo, useState } from "react";

import { SessionOperations } from "./SessionOperations";

export type TodayRosterItem = {
  id: string;
  studentName: string;
  status: string;
  packageLabel: string;
  creditsLabel: string;
  expiresLabel: string;
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
  returnTo: string;
};

type TodayClassesProps = {
  classes: TodayClassItem[];
  returnDate: string;
  canAttendance: boolean;
  canBook: boolean;
  canCreateStudent: boolean;
};

export function TodayClasses({
  classes,
  returnDate,
  canAttendance,
  canBook,
  canCreateStudent,
}: TodayClassesProps) {
  const ids = useMemo(() => new Set(classes.map((item) => item.id)), [classes]);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#session-")) return;
    const sessionId = hash.replace("#session-", "");
    if (ids.has(sessionId)) setOpenSessionId(sessionId);
  }, [ids]);

  if (!classes.length) {
    return <div className="today-empty-state">No hay clases programadas para este día.</div>;
  }

  return (
    <div className="today-class-list">
      {classes.map((item) => {
        const isOpen = openSessionId === item.id;
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
                roster={item.roster}
                candidates={item.candidates}
                available={item.available}
                canAttendance={canAttendance}
                canBook={canBook}
                canCreateStudent={canCreateStudent}
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
