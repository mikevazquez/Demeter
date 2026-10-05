"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import {
  canSearchStudents,
  canSelectStudentCandidate,
  hasSelectedStudent,
  normalizeStudentSearch,
} from "@/lib/admin/student-picker";

import {
  bookStudentFromToday,
  searchStudentsForToday,
  type TodayStudentCandidate,
} from "../actions";

export function ExistingStudentAddForm({
  sessionId,
  returnDate,
  returnTo,
}: {
  sessionId: string;
  returnDate: string;
  returnTo?: string;
}) {
  const [query, setQuery] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [matches, setMatches] = useState<TodayStudentCandidate[]>([]);
  const [isPending, startTransition] = useTransition();
  const requestIdRef = useRef(0);

  const normalizedQuery = normalizeStudentSearch(query);
  const selectedCandidate = matches.find((candidate) => candidate.id === selectedStudentId);

  useEffect(() => {
    if (!canSearchStudents(query)) return;

    const requestId = ++requestIdRef.current;
    const timer = window.setTimeout(() => {
      startTransition(async () => {
        const result = await searchStudentsForToday(sessionId, query);
        if (requestId === requestIdRef.current) setMatches(result);
      });
    }, 220);

    return () => window.clearTimeout(timer);
  }, [normalizedQuery, query, sessionId]);

  return (
    <form action={bookStudentFromToday} className="today-add-form is-existing">
      <input type="hidden" name="session_id" value={sessionId} />
      <input type="hidden" name="return_date" value={returnDate} />
      <input type="hidden" name="student_id" value={selectedStudentId} />
      {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}

      <div className="grid gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedStudentId("");
          }}
          placeholder="Busca por nombre…"
          aria-label="Buscar alumna"
          autoComplete="off"
          className="min-h-12 w-full rounded-xl border border-white/15 bg-black/25 px-3.5 text-base text-white outline-none transition placeholder:text-zinc-500 focus:border-fuchsia-500/60"
        />

        {normalizedQuery ? (
          <div
            className="grid max-h-60 gap-1.5 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-1"
            role="listbox"
            aria-busy={isPending}
          >
            {!canSearchStudents(query) ? (
              <div className="px-3 py-4 text-center text-xs text-zinc-500">
                Escribe al menos 2 letras.
              </div>
            ) : isPending && !matches.length ? (
              <div className="px-3 py-4 text-center text-xs text-zinc-500">Buscando alumnas…</div>
            ) : matches.length ? (
              matches.map((candidate) => {
                const canFallbackToWalkin = walkinFallbackDetails.has(candidate.detail);
                const disabled = !candidate.eligible && !canFallbackToWalkin;
                const selected = candidate.id === selectedStudentId;

                return (
                  <button
                    key={candidate.id}
                    type="button"
                    disabled={disabled}
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      if (disabled) return;
                      setSelectedStudentId(candidate.id);
                      setQuery(candidate.fullName);
                    }}
                    className={[
                      "flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition",
                      selected
                        ? "border-fuchsia-500/50 bg-fuchsia-500/10"
                        : "border-transparent bg-white/[0.035]",
                      disabled
                        ? "cursor-not-allowed opacity-40"
                        : "hover:border-fuchsia-500/35 hover:bg-fuchsia-500/[0.07]",
                    ].join(" ")}
                  >
                    <span className="min-w-0 truncate text-sm font-semibold text-white">
                      {candidate.fullName}
                    </span>
                    <small className="max-w-[46%] shrink-0 text-right text-[11px] text-zinc-500">
                      {candidate.detail}
                    </small>
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-4 text-center text-xs text-zinc-500">
                No encontramos alumnas con ese nombre.
              </div>
            )}
          </div>
        ) : null}
      </div>

      <button className="primary-button" type="submit" disabled={!hasSelectedStudent(selectedStudentId)}>
        {selectedCandidate ? `Agregar ${selectedCandidate.fullName}` : "Selecciona una alumna"}
      </button>
    </form>
  );
}
