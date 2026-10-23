"use client";

import { useActionState, useId, useMemo, useState } from "react";

import { enrollProgram } from "../actions";

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX")
    .trim();
}

export function EnrollmentForm({
  programId,
  students,
  options,
  requestId,
}: {
  programId: string;
  students: { id: string; name: string }[];
  options: { id: string; name: string }[];
  requestId: string;
}) {
  const [state, action, pending] = useActionState(enrollProgram, { error: null });
  const [query, setQuery] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputId = useId();
  const listboxId = `${inputId}-matches`;

  const matches = useMemo(() => {
    const normalizedQuery = normalizeSearch(query);
    if (normalizedQuery.length < 2) return [];

    return students
      .map((student) => ({
        ...student,
        normalizedName: normalizeSearch(student.name),
      }))
      .filter((student) => student.normalizedName.includes(normalizedQuery))
      .sort((a, b) => {
        const aStarts = a.normalizedName.startsWith(normalizedQuery);
        const bStarts = b.normalizedName.startsWith(normalizedQuery);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        return a.name.localeCompare(b.name, "es-MX");
      })
      .slice(0, 8);
  }, [query, students]);

  const chooseStudent = (student: { id: string; name: string }) => {
    setSelectedStudent(student);
    setQuery(student.name);
    setOpen(false);
    setActiveIndex(0);
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSelectedStudent(null);
    setActiveIndex(0);
    setOpen(normalizeSearch(value).length >= 2);
  };

  return (
    <form action={action} className="activities-stage">
      <h2>Inscribir y asegurar cupo</h2>
      <p>
        Registra un pago recibido. Se guardan la compra y todas las reservas juntas; si falta un
        lugar, no se registra ningún cargo.
      </p>
      <input name="program_id" value={programId} type="hidden" />
      <input name="request_id" value={requestId} type="hidden" />
      <input name="student_id" value={selectedStudent?.id ?? ""} type="hidden" />
      <div className="activities-form-grid">
        <div className="activities-field activities-student-search">
          <label htmlFor={inputId}>Alumna</label>
          <div className="activities-combobox">
            <input
              id={inputId}
              type="search"
              value={query}
              placeholder="Escribe el nombre de la alumna"
              autoComplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-controls={listboxId}
              aria-expanded={open && normalizeSearch(query).length >= 2}
              aria-activedescendant={
                open && matches[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined
              }
              onChange={(event) => handleQueryChange(event.target.value)}
              onFocus={() => {
                if (normalizeSearch(query).length >= 2 && !selectedStudent) setOpen(true);
              }}
              onBlur={() => setOpen(false)}
              onKeyDown={(event) => {
                if (!open || matches.length === 0) {
                  if (event.key === "ArrowDown" && normalizeSearch(query).length >= 2) {
                    setOpen(true);
                  }
                  return;
                }

                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((current) => (current + 1) % matches.length);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((current) => (current - 1 + matches.length) % matches.length);
                } else if (event.key === "Enter" && matches[activeIndex]) {
                  event.preventDefault();
                  chooseStudent(matches[activeIndex]);
                } else if (event.key === "Escape") {
                  setOpen(false);
                }
              }}
            />
            {query ? (
              <button
                type="button"
                className="activities-combobox-clear"
                aria-label="Limpiar alumna"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setQuery("");
                  setSelectedStudent(null);
                  setOpen(false);
                  setActiveIndex(0);
                }}
              >
                ×
              </button>
            ) : null}
            {open && normalizeSearch(query).length >= 2 ? (
              <div id={listboxId} role="listbox" className="activities-combobox-results">
                {matches.length ? (
                  matches.map((student, index) => (
                    <button
                      key={student.id}
                      id={`${listboxId}-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={selectedStudent?.id === student.id}
                      className={index === activeIndex ? "is-active" : undefined}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => chooseStudent(student)}
                    >
                      <strong>{student.name}</strong>
                    </button>
                  ))
                ) : (
                  <p className="activities-combobox-empty">
                    No encontramos alumnas con ese nombre.
                  </p>
                )}
              </div>
            ) : null}
          </div>
          <small>
            {selectedStudent
              ? "Alumna seleccionada. Puedes borrar el nombre para cambiarla."
              : "Escribe al menos 2 letras y elige una coincidencia."}
          </small>
        </div>
        <label className="activities-field">
          <span>Qué compra</span>
          <select name="session_id">
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="activities-field">
          <span>Pago recibido por</span>
          <select name="payment_method">
            <option value="cash">Efectivo</option>
            <option value="transfer">Transferencia verificada</option>
          </select>
        </label>
        <label className="activities-field">
          <span>Referencia</span>
          <input name="reference" maxLength={100} />
        </label>
      </div>
      <label>
        <input name="payment_verified" type="checkbox" required /> Ya recibí y verifiqué el pago
        completo de la opción elegida.
      </label>
      {state.error ? (
        <p role="alert" className="activities-inline-error">
          {state.error}
        </p>
      ) : null}
      <p>
        <button
          type="submit"
          className="activities-next-button"
          disabled={pending || !selectedStudent}
        >
          {pending ? "Inscribiendo…" : "Registrar pago e inscripción"}
        </button>
      </p>
    </form>
  );
}
