import Link from "next/link";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { createInstructor } from "./actions";

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
  const { data: people } = personIds.length
    ? await supabase.from("persons").select("id, first_name, last_name").in("id", personIds)
    : { data: [] };
  const { data: contacts } = personIds.length
    ? await supabase
        .from("person_contacts")
        .select("person_id, kind, value, is_primary")
        .in("person_id", personIds)
    : { data: [] };

  const peopleMap = new Map((people ?? []).map((person) => [person.id, person]));
  const rows = (instructors ?? [])
    .map((instructor) => {
      const person = peopleMap.get(instructor.person_id);
      const name =
        [person?.first_name, person?.last_name].filter(Boolean).join(" ") || "Instructor";
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
    <main className="dashboard-shell admin-module-page">
      <header className="module-header">
        <div>
          <h1>Equipo</h1>
          <p>Miembros del estudio.</p>
        </div>
        {canWrite ? (
          <details className="module-create-details">
            <summary className="module-primary-action">＋ Nueva</summary>
            <form action={createInstructor} className="module-create-panel">
              <input name="first_name" required placeholder="Nombre" />
              <input name="last_name" placeholder="Apellido" />
              <input name="phone" type="tel" placeholder="Teléfono opcional" />
              <input name="email" type="email" placeholder="Correo opcional" />
              <textarea name="bio" placeholder="Bio / especialidad opcional" />
              <button className="primary-button" type="submit">
                Crear integrante
              </button>
            </form>
          </details>
        ) : null}
      </header>

      {errorMessage ? <div className="notice error">{errorMessage}</div> : null}

      <div className="module-toolbar">
        <nav className="module-tabs" aria-label="Estado del equipo">
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
        <form method="get" className="module-search">
          <input type="hidden" name="status" value={status} />
          <input name="q" type="search" defaultValue={query} placeholder="Buscar en el equipo" />
        </form>
      </div>

      {rows.length === 0 ? (
        <section className="module-empty">
          {query
            ? "No encontramos integrantes con esa búsqueda."
            : "No hay integrantes en este estado."}
        </section>
      ) : (
        <section className="module-list">
          {rows.map((item) => {
            const initials = item.name
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part.slice(0, 1).toUpperCase())
              .join("");
            return (
              <Link
                className="module-list-row team-list-row"
                key={item.id}
                href={`/admin/instructores/${item.id}`}
              >
                <span className="team-avatar">{initials || "E"}</span>
                <span className="module-row-copy">
                  <strong>{item.name}</strong>
                  <small>{item.bio?.trim() || "Miembro del equipo"}</small>
                </span>
                <span className="status-chip is-active">
                  {item.status === "active" ? "Activo" : "Inactivo"}
                </span>
                <span className="module-chevron" aria-hidden="true">
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
