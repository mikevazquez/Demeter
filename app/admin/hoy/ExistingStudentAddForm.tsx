"use client";

import { useMemo, useState } from "react";

import { bookStudentFromToday } from "../actions";

type Candidate = {
  id: string;
  fullName: string;
  eligible: boolean;
  detail: string;
};

const walkinFallbackDetails = new Set(["sin paquete activo", "fuera de paquete", "sin créditos"]);

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function ExistingStudentAddForm({
  sessionId,
  returnDate,
  returnTo,
  candidates,
  canPostCloseAdd,
}: {
  sessionId: string;
  returnDate: string;
  returnTo?: string;
  candidates: Candidate[];
  canPostCloseAdd: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");

  const normalizedQuery = normalizeSearch(query);
  const matches = useMemo(() => {
    if (!normalizedQuery) return [];

    return candidates
      .filter((candidate) => normalizeSearch(candidate.fullName).includes(normalizedQuery))
      .slice(0, 8);
  }, [candidates, normalizedQuery]);

  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedStudentId);

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
          placeholder="Buscar alumna por nombre"
          aria-label="Buscar alumna por nombre"
          autoComplete="off"
          className="min-h-12 w-full rounded-xl border border-white/15 bg-black/25 px-3.5 text-base text-white outline-none transition placeholder:text-zinc-500 focus:border-fuchsia-500/60"
        />

        {normalizedQuery ? (
          <div
            className="grid max-h-60 gap-1.5 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-1"
            role="listbox"
          >
            {matches.length ? (
              matches.map((candidate) => {
                const canFallbackToWalkin = walkinFallbackDetails.has(candidate.detail);
                const disabled = !canPostCloseAdd && !candidate.eligible && !canFallbackToWalkin;
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
                      {canPostCloseAdd
                        ? "Agregar después del cierre"
                        : `${candidate.detail}${canFallbackToWalkin ? " · walk-in / venta pendiente" : ""}`}
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
        ) : (
          <p className="m-0 px-0.5 text-xs text-zinc-500">
            Escribe el nombre para ver coincidencias.
          </p>
        )}
      </div>

      {selectedCandidate ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-fuchsia-500/25 bg-fuchsia-500/[0.06] px-3 py-2.5">
          <span className="text-[11px] text-zinc-500">Seleccionada</span>
          <strong className="min-w-0 truncate text-xs text-white">
            {selectedCandidate.fullName}
          </strong>
        </div>
      ) : null}

      <button className="primary-button" type="submit" disabled={!selectedStudentId}>
        Agregar
      </button>
    </form>
  );
}
