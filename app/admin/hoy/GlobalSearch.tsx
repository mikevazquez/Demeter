"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { searchPeople, type PersonSearchResult } from "./search-actions";
export default function GlobalSearch() {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonSearchResult[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const normalized = query.replace(/\s/g, "");
  useEffect(() => {
    if (normalized.length < 2) return;
    let disposed = false;
    const timer = window.setTimeout(() => {
      searchPeople(query)
        .then((items) => {
          if (!disposed) {
            setResults(items);
            setState("ready");
          }
        })
        .catch(() => {
          if (!disposed) setState("error");
        });
    }, 220);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [normalized, query]);
  return (
    <>
      <button
        className="flow-icon-button"
        type="button"
        aria-label="Buscar alumna"
        onClick={() => {
          dialog.current?.showModal();
          input.current?.focus();
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="10" cy="10" r="7" />
          <path d="m15 15 6 6" />
        </svg>
      </button>
      <dialog
        ref={dialog}
        className="flow-sheet"
        aria-labelledby="global-search-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <header>
          <h2 id="global-search-title">Buscar</h2>
          <button
            className="flow-icon-button"
            aria-label="Cerrar búsqueda"
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </header>
        <input
          ref={input}
          type="search"
          placeholder="Nombre, apellido o teléfono"
          aria-label="Nombre, apellido o teléfono"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setResults([]);
            setState("loading");
          }}
        />
        <div
          className="flow-search-results"
          aria-live="polite"
          aria-busy={normalized.length >= 2 && state === "loading"}
        >
          {normalized.length < 2 ? (
            <p>Busca entre alumnas, prospectos y exalumnas.</p>
          ) : state === "loading" ? (
            <p>Buscando…</p>
          ) : state === "error" ? (
            <p>No pudimos buscar. Intenta de nuevo.</p>
          ) : results.length ? (
            results.map((person) => (
              <Link key={person.id} href={person.href} onClick={() => dialog.current?.close()}>
                <span className="flow-person-avatar" aria-hidden="true">
                  {person.full_name
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((part) => part[0])
                    .join("")}
                </span>
                <span className="flow-person-copy">
                  <strong>{person.full_name}</strong>
                  <small>
                    {person.phone}
                    {person.inactive ? " · inactiva" : ""}
                  </small>
                </span>
                <span className="flow-person-stage">{person.stage}</span>
              </Link>
            ))
          ) : (
            <p>Nadie coincide con “{query}”.</p>
          )}
        </div>
      </dialog>
    </>
  );
}
