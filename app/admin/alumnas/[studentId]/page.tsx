import Link from "next/link";
import { notFound } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { setStudentLifecycle, updateDynamicProfileFields, updateStudent } from "./actions";

const structuralFieldKeys = new Set(["first_name", "last_name", "phone", "email"]);

function optionValues(options: unknown): string[] {
  if (Array.isArray(options))
    return options.filter((value): value is string => typeof value === "string");

  if (options && typeof options === "object" && "choices" in options) {
    const choices = (options as { choices?: unknown }).choices;
    if (Array.isArray(choices)) {
      return choices.filter((value): value is string => typeof value === "string");
    }
  }

  return [];
}

function scalarValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "";
}

export default async function StudentProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { studentId } = await params;
  const query = await searchParams;
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.STUDENTS_READ);

  const { data: student } = await supabase
    .from("students")
    .select(
      "id, person_id, full_name, email, phone, lifecycle_status, profile_status, created_at, archived_at",
    )
    .eq("id", studentId)
    .eq("studio_id", studio.id)
    .maybeSingle();

  if (!student) notFound();

  const [{ data: person }, { data: contacts }, { data: definitions }, { data: fieldValues }] =
    await Promise.all([
      student.person_id
        ? supabase
            .from("persons")
            .select("id, first_name, last_name")
            .eq("id", student.person_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      student.person_id
        ? supabase
            .from("person_contacts")
            .select("kind, value, is_primary")
            .eq("person_id", student.person_id)
            .order("kind")
        : Promise.resolve({ data: [] }),
      supabase
        .from("profile_field_definitions")
        .select("id, key, label, field_type, required, options, sort_order")
        .eq("studio_id", studio.id)
        .eq("entity_type", "student")
        .eq("active", true)
        .order("sort_order")
        .order("label"),
      student.person_id
        ? supabase
            .from("profile_field_values")
            .select("definition_id, value")
            .eq("person_id", student.person_id)
        : Promise.resolve({ data: [] }),
    ]);

  const phone = contacts?.find((item) => item.kind === "phone")?.value ?? student.phone;
  const email = contacts?.find((item) => item.kind === "email")?.value ?? student.email ?? "";
  const firstName = person?.first_name ?? student.full_name.split(" ")[0] ?? "";
  const lastName = person?.last_name ?? student.full_name.split(" ").slice(1).join(" ");
  const canEdit = can(CAPABILITIES.STUDENTS_WRITE);
  const canArchive = can(CAPABILITIES.STUDENTS_ARCHIVE);
  const dynamicDefinitions = (definitions ?? []).filter(
    (definition) => !structuralFieldKeys.has(definition.key),
  );
  const valueMap = new Map((fieldValues ?? []).map((item) => [item.definition_id, item.value]));

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <Link className="back-link compact" href="/admin/alumnas">
            ← Alumnas
          </Link>
          <p className="eyebrow">PERFIL 360 · {studio.name}</p>
          <h1 className="dashboard-title">{student.full_name}</h1>
          <p>Expediente operativo de la alumna.</p>
        </div>
        <div className="toolbar-actions">
          <span className="role-pill">{student.lifecycle_status}</span>
        </div>
      </header>

      {query.saved ? <div className="notice success">Cambios guardados correctamente.</div> : null}
      {query.error ? (
        <div className="notice error">
          {query.error === "phone_exists"
            ? "Ese teléfono ya pertenece a otra alumna."
            : query.error === "profile_fields"
              ? "No se pudieron guardar los campos adicionales. Revisa sus valores."
              : "No se pudo guardar el cambio."}
        </div>
      ) : null}

      <section className="stat-grid">
        <article className="stat-card">
          <span>Expediente</span>
          <strong className="stat-word">
            {student.profile_status === "complete" ? "Completo" : "Incompleto"}
          </strong>
          <small>Según los campos requeridos configurados</small>
        </article>
        <article className="stat-card">
          <span>Estado</span>
          <strong className="stat-word">{student.lifecycle_status}</strong>
          <small>Ciclo operativo</small>
        </article>
        <article className="stat-card">
          <span>Teléfono</span>
          <strong className="stat-word">{phone}</strong>
          <small>Formato E.164</small>
        </article>
      </section>

      <section className="panel-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">DATOS PERSONALES</p>
              <h2>Información de contacto</h2>
            </div>
          </div>

          {canEdit ? (
            <form action={updateStudent} className="compact-form">
              <input type="hidden" name="student_id" value={student.id} />
              <div className="form-split">
                <input name="first_name" required defaultValue={firstName} placeholder="Nombre" />
                <input name="last_name" defaultValue={lastName ?? ""} placeholder="Apellido" />
              </div>
              <input name="phone" type="tel" required defaultValue={phone} placeholder="Teléfono" />
              <input name="email" type="email" defaultValue={email} placeholder="Correo" />
              <button className="primary-button" type="submit">
                Guardar cambios
              </button>
            </form>
          ) : (
            <div className="student-list">
              <div className="student-row">
                <div>
                  <strong>{student.full_name}</strong>
                  <span>{phone}</span>
                  {email ? <span>{email}</span> : null}
                </div>
              </div>
            </div>
          )}
        </article>

        <article className="panel">
          <p className="eyebrow">RESUMEN OPERATIVO</p>
          <h2>Perfil 360</h2>
          <div className="student-list">
            <div className="student-row">
              <div>
                <strong>Paquete activo</strong>
                <span>Se integrará desde F6 Productos/Créditos.</span>
              </div>
            </div>
            <div className="student-row">
              <div>
                <strong>Próximas clases</strong>
                <span>Se integrará desde F5 Agenda.</span>
              </div>
            </div>
            <div className="student-row">
              <div>
                <strong>Documentos y notas</strong>
                <span>Se integrarán en sus fases correspondientes sin duplicar datos.</span>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">CAMPOS ADICIONALES</p>
            <h2>Información configurable</h2>
          </div>
          <span className="count-badge">{dynamicDefinitions.length}</span>
        </div>

        {dynamicDefinitions.length === 0 ? (
          <div className="empty-state">
            No hay campos adicionales configurados para alumnas. El expediente base ya usa nombre,
            apellido, teléfono y correo.
          </div>
        ) : canEdit ? (
          <form action={updateDynamicProfileFields} className="compact-form">
            <input type="hidden" name="student_id" value={student.id} />
            {dynamicDefinitions.map((definition) => {
              const fieldName = `field_${definition.id}`;
              const currentValue = valueMap.get(definition.id);
              const options = optionValues(definition.options);

              if (definition.field_type === "long_text") {
                return (
                  <label key={definition.id}>
                    <span>
                      {definition.label}
                      {definition.required ? " *" : ""}
                    </span>
                    <textarea
                      name={fieldName}
                      required={definition.required}
                      defaultValue={scalarValue(currentValue)}
                    />
                  </label>
                );
              }

              if (definition.field_type === "boolean") {
                return (
                  <label key={definition.id} className="checkbox-field">
                    <input
                      name={fieldName}
                      type="checkbox"
                      value="true"
                      defaultChecked={currentValue === true}
                    />
                    <span>{definition.label}</span>
                  </label>
                );
              }

              if (definition.field_type === "single_select") {
                return (
                  <label key={definition.id}>
                    <span>
                      {definition.label}
                      {definition.required ? " *" : ""}
                    </span>
                    <select
                      name={fieldName}
                      required={definition.required}
                      defaultValue={scalarValue(currentValue)}
                    >
                      <option value="">Seleccionar</option>
                      {options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              }

              if (definition.field_type === "multi_select") {
                const selected = Array.isArray(currentValue)
                  ? currentValue.filter((value): value is string => typeof value === "string")
                  : [];
                return (
                  <label key={definition.id}>
                    <span>
                      {definition.label}
                      {definition.required ? " *" : ""}
                    </span>
                    <select
                      name={fieldName}
                      multiple
                      required={definition.required}
                      defaultValue={selected}
                    >
                      {options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              }

              return (
                <label key={definition.id}>
                  <span>
                    {definition.label}
                    {definition.required ? " *" : ""}
                  </span>
                  <input
                    name={fieldName}
                    type={definition.field_type === "number" ? "number" : definition.field_type}
                    required={definition.required}
                    defaultValue={scalarValue(currentValue)}
                  />
                </label>
              );
            })}
            <button className="primary-button" type="submit">
              Guardar campos adicionales
            </button>
          </form>
        ) : (
          <div className="student-list">
            {dynamicDefinitions.map((definition) => {
              const currentValue = valueMap.get(definition.id);
              const displayValue = Array.isArray(currentValue)
                ? currentValue.join(", ")
                : typeof currentValue === "boolean"
                  ? currentValue
                    ? "Sí"
                    : "No"
                  : scalarValue(currentValue) || "Sin dato";

              return (
                <div className="student-row" key={definition.id}>
                  <div>
                    <strong>{definition.label}</strong>
                    <span>{displayValue}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {canArchive ? (
        <section className="panel">
          <p className="eyebrow">ADMINISTRACIÓN</p>
          <h2>Estado de la alumna</h2>
          <div className="toolbar-actions">
            {student.lifecycle_status !== "active" ? (
              <form action={setStudentLifecycle}>
                <input type="hidden" name="student_id" value={student.id} />
                <input type="hidden" name="status" value="active" />
                <button className="primary-button" type="submit">
                  Reactivar
                </button>
              </form>
            ) : null}
            {student.lifecycle_status === "active" ? (
              <form action={setStudentLifecycle}>
                <input type="hidden" name="student_id" value={student.id} />
                <input type="hidden" name="status" value="inactive" />
                <button className="ghost-button" type="submit">
                  Marcar inactiva
                </button>
              </form>
            ) : null}
            {student.lifecycle_status !== "archived" ? (
              <form action={setStudentLifecycle}>
                <input type="hidden" name="student_id" value={student.id} />
                <input type="hidden" name="status" value="archived" />
                <button className="ghost-button" type="submit">
                  Archivar
                </button>
              </form>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
