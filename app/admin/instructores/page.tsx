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
          ? "No se pudo crear el instructor."
          : null;

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <Link className="back-link compact" href="/admin">
            ← Hoy
          </Link>
          <p className="eyebrow">INSTRUCTORES · {studio.name}</p>
          <h1 className="dashboard-title">Instructores</h1>
          <p>Perfiles operativos, disciplinas y estado. El acceso se administra por separado.</p>
        </div>
      </header>
      {errorMessage ? <div className="notice error">{errorMessage}</div> : null}
      <section className="agenda-layout">
        <div className="agenda-main">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">EQUIPO</p>
                <h2>{status === "active" ? "Activos" : "Inactivos"}</h2>
              </div>
              <span className="count-badge">{rows.length}</span>
            </div>
            <form className="compact-form" method="get">
              <div className="form-split">
                <input
                  name="q"
                  type="search"
                  defaultValue={query}
                  placeholder="Buscar por nombre, teléfono o correo"
                />
                <select name="status" defaultValue={status}>
                  <option value="active">Activos</option>
                  <option value="inactive">Inactivos</option>
                </select>
              </div>
              <button className="ghost-button" type="submit">
                Buscar
              </button>
            </form>
            {rows.length === 0 ? (
              <div className="empty-state">
                {query
                  ? "No encontramos instructores con esa búsqueda."
                  : "Todavía no hay instructores en este estado."}
              </div>
            ) : (
              <div className="student-list">
                {rows.map((item) => (
                  <Link
                    className="student-row"
                    key={item.id}
                    href={`/admin/instructores/${item.id}`}
                  >
                    <div>
                      <strong>{item.name}</strong>
                      <span>
                        {[item.phone, item.email].filter(Boolean).join(" · ") ||
                          "Sin contacto registrado"}
                      </span>
                    </div>
                    <div className="student-package-summary">
                      <strong>{item.status === "active" ? "Activo" : "Inactivo"}</strong>
                      <span>Perfil operativo</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </article>
        </div>
        <aside className="agenda-sidebar">
          <article className="panel compact-panel">
            <p className="eyebrow">ALTA</p>
            <h2>Nuevo instructor</h2>
            <p>Crear el perfil no crea credenciales ni acceso al portal.</p>
            {canWrite ? (
              <form action={createInstructor} className="compact-form">
                <div className="form-split">
                  <input name="first_name" required placeholder="Nombre" />
                  <input name="last_name" placeholder="Apellido" />
                </div>
                <input name="phone" type="tel" placeholder="Teléfono opcional" />
                <input name="email" type="email" placeholder="Correo opcional" />
                <textarea name="bio" placeholder="Bio / especialidad opcional" />
                <button className="primary-button" type="submit">
                  Crear instructor
                </button>
              </form>
            ) : (
              <div className="empty-state">
                Puedes consultar instructores, pero no modificarlos.
              </div>
            )}
          </article>
        </aside>
      </section>
    </main>
  );
}
