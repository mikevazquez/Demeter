import PendingActionButton from "@/app/admin/components/PendingActionButton";
import { updateCommunicationPreferences } from "../actions";
import type { Profile360Model } from "../load-profile-360";
import { communicationFieldCopy, communicationOriginCopy, formatDateTime } from "../profile-format";

/** P360-V2-06 · Preferencias de comunicación de la persona y su historial de cambios. */
export default function CommunicationSection({ model }: { model: Profile360Model }) {
  const {
    student,
    canEdit,
    communicationPreferences,
    communicationPreferenceEvents,
    timeZone,
    locale,
  } = model;
  if (!student.person_id) return null;
  return (
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
              Estas preferencias pertenecen a la persona y prevalecen sobre una configuración global
              más permisiva. Un teléfono inválido se trata por separado como error de datos.
            </p>
          </div>
          <span className="status-pill">
            {communicationPreferences.whatsappBlocked ? "WhatsApp bloqueado" : "WhatsApp permitido"}
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

            <PendingActionButton className="primary-button" pendingLabel="Guardando preferencias…">
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
  );
}
