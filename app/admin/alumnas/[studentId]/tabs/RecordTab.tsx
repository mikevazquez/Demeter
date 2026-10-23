import PendingActionButton from "@/app/admin/components/PendingActionButton";
import StudentPortalAccessSection from "../StudentPortalAccessSection";
import StudentDocumentsPanel from "../StudentDocumentsPanel";
import StudentLifecycleActions from "../StudentLifecycleActions";
import {
  updateCommunicationPreferences,
  updateDynamicProfileFields,
  updateStudent,
} from "../actions";
import {
  communicationFieldCopy,
  communicationOriginCopy,
  formatDateTime,
  lifecycleCopy,
  optionValues,
  scalarValue,
} from "../profile-format";
import type { Profile360Model } from "../load-profile-360";

export default function RecordTab({ model }: { model: Profile360Model }) {
  const {
    query,
    student,
    internalNote,
    canEdit,
    canReadDocuments,
    canArchive,
    phone,
    email,
    firstName,
    lastName,
    communicationPreferences,
    communicationPreferenceEvents,
    lifecycleEvents,
    timeZone,
    locale,
    dynamicDefinitions,
    valueMap,
  } = model;

  return (
    <div className="p360v2-stack">
      <section className="crm-card">
        <p className="eyebrow">NOTA INTERNA</p>
        <p className="p360v2-note">{internalNote || "Sin nota interna."}</p>
        {canEdit && dynamicDefinitions.length ? (
          <a className="crm-btn" href="#campos-adicionales">
            Editar nota y campos
          </a>
        ) : null}
      </section>
      <section className="profile360-view-panel profile360-data-view">
        <div className="profile360-view-heading">
          <div>
            <p className="eyebrow">DATOS</p>
            <h2>Datos y preferencias</h2>
            <p>Información personal y comunicación de la alumna.</p>
          </div>
        </div>
        <details id="datos-personales" className="profile360-detail scroll-mt-6">
          <summary>
            <span>
              <strong>Datos y contacto</strong>
              <small>Ver o editar información personal</small>
            </span>
            <span aria-hidden="true">›</span>
          </summary>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">EXPEDIENTE</p>
                <h2>Datos generales</h2>
              </div>
              <span className="count-badge">
                {student.profile_status === "complete" ? "Completo" : "Incompleto"}
              </span>
            </div>

            {canEdit ? (
              <form action={updateStudent} className="compact-form">
                <input type="hidden" name="student_id" value={student.id} />
                <div className="form-split">
                  <input name="first_name" required defaultValue={firstName} placeholder="Nombre" />
                  <input name="last_name" defaultValue={lastName ?? ""} placeholder="Apellido" />
                </div>
                <input
                  name="phone"
                  type="tel"
                  required
                  defaultValue={phone}
                  placeholder="Teléfono"
                />
                <input name="email" type="email" defaultValue={email} placeholder="Correo" />
                <PendingActionButton className="primary-button" pendingLabel="Guardando…">
                  Guardar cambios
                </PendingActionButton>
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
          </section>
        </details>

        {student.person_id ? (
          <details id="comunicacion" className="profile360-detail scroll-mt-6">
            <summary>
              <span>
                <strong>Preferencias de comunicación</strong>
                <small>WhatsApp, recordatorios y promociones</small>
              </span>
              <span aria-hidden="true">›</span>
            </summary>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">COMUNICACIÓN · AUT-05</p>
                  <h2>Preferencias de comunicación</h2>
                  <p>
                    Estas preferencias pertenecen a la persona y prevalecen sobre una configuración
                    global más permisiva. Un teléfono inválido se trata por separado como error de
                    datos.
                  </p>
                </div>
                <span className="status-pill">
                  {communicationPreferences.whatsappBlocked
                    ? "WhatsApp bloqueado"
                    : "WhatsApp permitido"}
                </span>
              </div>

              {canEdit ? (
                <form action={updateCommunicationPreferences} className="compact-form">
                  <input type="hidden" name="student_id" value={student.id} />
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <span className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          name="operational_enabled"
                          value="true"
                          defaultChecked={communicationPreferences.operational}
                        />
                        <strong>Operativas</strong>
                      </span>
                      <small>Reservas, cancelaciones, pagos y activaciones.</small>
                    </label>
                    <label className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <span className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          name="reminders_enabled"
                          value="true"
                          defaultChecked={communicationPreferences.reminders}
                        />
                        <strong>Recordatorios</strong>
                      </span>
                      <small>Recordatorios relacionados con reservas futuras.</small>
                    </label>
                    <label className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <span className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          name="retention_enabled"
                          value="true"
                          defaultChecked={communicationPreferences.retention}
                        />
                        <strong>Retención / seguimiento</strong>
                      </span>
                      <small>Seguimientos de experiencia, vencimiento e inactividad.</small>
                    </label>
                    <label className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <span className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          name="promotions_enabled"
                          value="true"
                          defaultChecked={communicationPreferences.promotions}
                        />
                        <strong>Promociones</strong>
                      </span>
                      <small>Beneficios, campañas y comunicaciones comerciales.</small>
                    </label>
                  </div>

                  <label className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <span className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        name="whatsapp_blocked"
                        value="true"
                        defaultChecked={communicationPreferences.whatsappBlocked}
                      />
                      <strong>Bloquear todas las comunicaciones por WhatsApp</strong>
                    </span>
                    <small>Este bloqueo prevalece sobre las cuatro categorías anteriores.</small>
                  </label>

                  <label className="grid gap-1 text-sm text-zinc-300">
                    Motivo del cambio (opcional)
                    <input
                      type="text"
                      name="reason"
                      maxLength={1000}
                      placeholder="Ej. La alumna solicitó no recibir promociones"
                      className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
                    />
                  </label>

                  <PendingActionButton
                    className="primary-button"
                    pendingLabel="Guardando preferencias…"
                  >
                    Guardar preferencias
                  </PendingActionButton>
                </form>
              ) : (
                <div className="student-list">
                  {[
                    ["Operativas", communicationPreferences.operational],
                    ["Recordatorios", communicationPreferences.reminders],
                    ["Retención / seguimiento", communicationPreferences.retention],
                    ["Promociones", communicationPreferences.promotions],
                  ].map(([label, enabled]) => (
                    <div className="student-row" key={String(label)}>
                      <div>
                        <strong>{String(label)}</strong>
                        <span>{enabled ? "Permitidas" : "Desactivadas"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-6">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">AUDITORÍA</p>
                    <h3>Últimos cambios</h3>
                  </div>
                  <span className="count-badge">{communicationPreferenceEvents.length}</span>
                </div>

                {!communicationPreferenceEvents.length ? (
                  <div className="empty-state">
                    No hay cambios registrados. Se aplican las preferencias permitidas por defecto.
                  </div>
                ) : (
                  <div className="student-list">
                    {communicationPreferenceEvents.map((event) => {
                      const changedFields = Array.isArray(event.changed_fields)
                        ? event.changed_fields
                            .map((field) => communicationFieldCopy[String(field)] ?? String(field))
                            .join(", ")
                        : "Preferencias";

                      return (
                        <div className="student-row" key={event.id}>
                          <div>
                            <strong>{changedFields}</strong>
                            <span>
                              {communicationOriginCopy[event.origin] ?? event.origin} ·{" "}
                              {formatDateTime(event.created_at, timeZone, locale)}
                            </span>
                            {event.reason ? <span>{event.reason}</span> : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </details>
        ) : null}
      </section>
      <details id="campos-adicionales" className="profile360-detail scroll-mt-6">
        <summary>
          <span>
            <strong>Información adicional</strong>
            <small>Campos configurables del expediente</small>
          </span>
          <span aria-hidden="true">›</span>
        </summary>
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
              <PendingActionButton className="primary-button" pendingLabel="Guardando…">
                Guardar campos adicionales
              </PendingActionButton>
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
      </details>
      {canReadDocuments ? (
        <div id="documentos" className="scroll-mt-6">
          <StudentDocumentsPanel
            studentId={student.id}
            timeZone={timeZone}
            locale={locale}
            result={query.document_result}
            error={query.document_error}
          />
        </div>
      ) : null}
      <div id="acceso" className="scroll-mt-6">
        <StudentPortalAccessSection studentId={student.id} />
      </div>
      {canArchive ? (
        <details id="estado-alumna" className="profile360-detail scroll-mt-6">
          <summary>
            <span>
              <strong>Estado e historial</strong>
              <small>Administración del ciclo de la alumna</small>
            </span>
            <span aria-hidden="true">›</span>
          </summary>
          <section className="panel">
            <p className="eyebrow">ADMINISTRACIÓN</p>
            <h2>Estado de la alumna</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              {student.lifecycle_status === "active"
                ? "Inactivar conserva el expediente y las reservas futuras existentes, pero deshabilita el acceso y bloquea nuevas reservas."
                : "Reactivar recupera el mismo expediente y vuelve a habilitar el acceso y las nuevas reservas."}
            </p>

            <StudentLifecycleActions
              studentId={student.id}
              status={student.lifecycle_status === "inactive" ? "inactive" : "active"}
            />

            <div id="historial" className="mt-6 scroll-mt-6 border-t border-white/10 pt-5">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">HISTORIAL</p>
                  <h3>Cambios de estado</h3>
                </div>
                <span className="count-badge">{lifecycleEvents.length}</span>
              </div>

              {lifecycleEvents.length === 0 ? (
                <div className="empty-state">Todavía no hay cambios de estado registrados.</div>
              ) : (
                <div className="grid gap-2">
                  {lifecycleEvents.map((event) => (
                    <div
                      key={event.id}
                      className={[
                        "flex flex-wrap items-center justify-between gap-3 rounded-xl",
                        "border border-white/10 bg-white/[0.03] px-4 py-3",
                      ].join(" ")}
                    >
                      <strong className="text-sm text-white">
                        {lifecycleCopy[event.from_status] ?? event.from_status} →{" "}
                        {lifecycleCopy[event.to_status] ?? event.to_status}
                      </strong>
                      <span className="text-xs text-zinc-500">
                        {formatDateTime(event.created_at, timeZone, locale)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </details>
      ) : null}
    </div>
  );
}
