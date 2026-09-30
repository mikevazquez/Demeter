import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import { createInstructor } from "./actions";
import "./team-v2.css";

function TeamIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="26"
      height="26"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c.4-3.5 2.4-5.5 5.5-5.5s5.1 2 5.5 5.5" />
      <path d="M16 6.5a2.6 2.6 0 0 1 0 5.1M17 14c2.1.6 3.3 2.2 3.5 5" />
    </svg>
  );
}

export default async function InstructorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; error?: string }>;
}) {
  const params = await searchParams;
  const query = String(params.q ?? "").trim();
  const status = params.status === "inactive" ? "inactive" : "active";
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.INSTRUCTORS_READ);
  const canWrite = can(CAPABILITIES.INSTRUCTORS_WRITE);

  const { data: instructors } = await supabase
    .from("instructors")
    .select("id, person_id, status, bio, created_at")
    .eq("studio_id", studio.id)
    .eq("status", status)
    .order("created_at", { ascending: false });

  const personIds = (instructors ?? []).map((item) => item.person_id);
  const [{ data: people }, { data: contacts }] = await Promise.all([
    personIds.length
      ? supabase.from("persons").select("id, first_name, last_name").in("id", personIds)
      : Promise.resolve({ data: [] }),
    personIds.length
      ? supabase
          .from("person_contacts")
          .select("person_id, kind, value, is_primary")
          .in("person_id", personIds)
      : Promise.resolve({ data: [] }),
  ]);

  const peopleMap = new Map((people ?? []).map((person) => [person.id, person]));
  const rows = (instructors ?? [])
    .map((instructor) => {
      const person = peopleMap.get(instructor.person_id);
      const name =
        [person?.first_name, person?.last_name].filter(Boolean).join(" ") || "Integrante";
      const personContacts = (contacts ?? []).filter(
        (item) => item.person_id === instructor.person_id,
      );
      const phone = personContacts.find((item) => item.kind === "phone")?.value ?? "";
      const email = personContacts.find((item) => item.kind === "email")?.value ?? "";
      return { ...instructor, name, phone, email };
    })
    .filter(
      (item) =>
        !query ||
        `${item.name} ${item.phone} ${item.email}`.toLowerCase().includes(query.toLowerCase()),
    );

  const errorMessage =
    params.error === "first_name_required"
      ? "El nombre es obligatorio."
      : params.error === "phone_invalid"
        ? "Ingresa un teléfono válido."
        : params.error
          ? "No se pudo crear el integrante."
          : null;

  return (
    <main className="team-v2">
      <header className="team-v2-header">
        <div>
          <h1>Equipo</h1>
          <p>Administra a las personas que imparten clases y su acceso operativo.</p>
        </div>

        {canWrite ? (
          <details className="team-v2-create">
            <summary className="team-v2-primary">
              <span aria-hidden="true">＋</span> Integrante
            </summary>
            <form action={createInstructor} className="team-v2-create-panel">
              <div className="team-v2-create-heading">
                <strong>Nuevo integrante</strong>
                <small>Agrega primero sus datos básicos. El acceso Coach se configura después.</small>
              </div>

              <div className="team-v2-create-grid">
                <label>
                  <span>Nombre</span>
                  <input name="first_name" required placeholder="Nombre" />
                </label>
                <label>
                  <span>Apellido</span>
                  <input name="last_name" placeholder="Apellido" />
                </label>
                <label>
                  <span>Teléfono</span>
                  <input name="phone" type="tel" placeholder="Opcional" />
                </label>
                <label>
                  <span>Correo</span>
                  <input name="email" type="email" placeholder="Opcional" />
                </label>
              </div>

              <label className="team-v2-create-bio">
                <span>Especialidad o nota</span>
                <textarea name="bio" placeholder="Ej. Pole Fitness, Flexibilidad…" />
              </label>

              <button className="team-v2-primary" type="submit">
                Crear integrante
              </button>
            </form>
          </details>
        ) : null}
      </header>

      {errorMessage ? <div className="team-v2-notice is-error">{errorMessage}</div> : null}

      <div className="team-v2-toolbar">
        <nav className="team-v2-tabs" aria-label="Estado del equipo">
          <Link className={status === "active" ? "is-active" : ""} href="/admin/instructores">
            Activos
          </Link>
          <Link
            className={status === "inactive" ? "is-active" : ""}
            href="/admin/instructores?status=inactive"
          >
            Inactivos
          </Link>
        </nav>

        <form method="get" className="team-v2-search">
          <input type="hidden" name="status" value={status} />
          <span aria-hidden="true">⌕</span>
          <input name="q" type="search" defaultValue={query} placeholder="Buscar integrante" />
        </form>
      </div>

      {rows.length === 0 ? (
        <section className="team-v2-empty">
          <strong>{query ? "No encontramos resultados" : "No hay integrantes aquí"}</strong>
          <p>
            {query
              ? "Prueba con otro nombre, teléfono o correo."
              : status === "active"
                ? "Los integrantes activos aparecerán en esta lista."
                : "No hay integrantes inactivos."}
          </p>
        </section>
      ) : (
        <section className="team-v2-list">
          {rows.map((item) => {
            const initials = item.name
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part.slice(0, 1).toUpperCase())
              .join("");

            return (
              <Link
                className="team-v2-row"
                key={item.id}
                href={`/admin/instructores/${item.id}`}
              >
                <span className="team-v2-avatar">
                  {initials || <TeamIcon />}
                </span>

                <span className="team-v2-row-copy">
                  <strong>{item.name}</strong>
                  <small>{item.bio?.trim() || "Integrante del equipo"}</small>
                  {item.email || item.phone ? (
                    <span>{item.email || item.phone}</span>
                  ) : (
                    <span>Sin datos de contacto</span>
                  )}
                </span>

                <span className={`team-v2-status ${item.status === "active" ? "is-active" : ""}`}>
                  {item.status === "active" ? "Activo" : "Inactivo"}
                </span>

                <span className="team-v2-chevron" aria-hidden="true">
                  ›
                </span>
              </Link>
            );
          })}
        </section>
      )}
    </main>
  );
}
