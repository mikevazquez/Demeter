import Link from "next/link";
import PendingActionButton from "@/app/admin/components/PendingActionButton";
import StudentLifecycleActions from "./StudentLifecycleActions";
import StudentLifecycleNoticeDialog from "./StudentLifecycleNoticeDialog";
import { notFound } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import {
  setAcquisitionAvailableCredits,
  setAcquisitionStartDate,
  updateCommunicationPreferences,
  updateDynamicProfileFields,
  updateStudent,
} from "./actions";

const structuralFieldKeys = new Set(["first_name", "last_name", "phone", "email"]);

const termCopy: Record<string, string> = {
  monthly: "Mensual",
  quarterly: "Trimestral",
  semiannual: "Semestral",
  annual: "Anual",
  custom: "Otra vigencia",
};

const lifecycleCopy: Record<string, string> = {
  active: "Activa",
  inactive: "Inactiva",
};

const acquisitionStatusCopy: Record<string, string> = {
  active: "Activa",
  expired: "Vencida",
  cancelled: "Cancelada",
};

const communicationOriginCopy: Record<string, string> = {
  admin: "Administración",
  student: "Alumna",
  system: "Sistema",
  integration: "Integración",
};

const communicationFieldCopy: Record<string, string> = {
  operational: "Operativas",
  reminders: "Recordatorios",
  retention: "Retención / seguimiento",
  promotions: "Promociones",
  whatsapp_blocked: "Bloqueo total de WhatsApp",
};

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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Mexico_City",
  }).format(new Date(value));
}

export default async function StudentProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{
    saved?: string;
    error?: string;
    alta?: string;
    sale?: string;
    lifecycle?: string;
    lifecycle_error?: string;
  }>;
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

  if (!student || student.lifecycle_status === "archived") notFound();

  const canReadProducts = can(CAPABILITIES.PRODUCTS_READ);
  const canEditAcquisitions = can(CAPABILITIES.PRODUCTS_WRITE) || can(CAPABILITIES.SALES_WRITE);

  const [
    { data: person },
    { data: contacts },
    { data: definitions },
    { data: fieldValues },
    acquisitionResult,
    communicationPreferencesResult,
    communicationPreferenceEventsResult,
  ] = await Promise.all([
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
    canReadProducts
      ? supabase
          .from("product_acquisitions")
          .select(
            "id,product_template_id,status,starts_on,expires_on,unlimited,credit_limit,refunded_at,created_at,activation_mode,access_blocked,validity_days_snapshot",
          )
          .eq("student_id", student.id)
          .eq("studio_id", studio.id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    student.person_id
      ? supabase
          .from("person_communication_preferences")
          .select(
            "operational_enabled,reminders_enabled,retention_enabled,promotions_enabled,whatsapp_blocked,updated_origin,updated_at",
          )
          .eq("studio_id", studio.id)
          .eq("person_id", student.person_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    student.person_id
      ? supabase
          .from("person_communication_preference_events")
          .select("id,origin,changed_fields,reason,created_at")
          .eq("studio_id", studio.id)
          .eq("person_id", student.person_id)
          .order("created_at", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] }),
  ]);

  const acquisitions = acquisitionResult.data ?? [];
  const acquisitionIds = acquisitions.map((item) => item.id);
  const productIds = [...new Set(acquisitions.map((item) => item.product_template_id))];
  const [{ data: acquisitionProducts }, { data: ledgerRows }] = canReadProducts
    ? await Promise.all([
        productIds.length
          ? supabase
              .from("product_templates")
              .select("id,name,package_term")
              .eq("studio_id", studio.id)
              .in("id", productIds)
          : Promise.resolve({ data: [] }),
        acquisitionIds.length
          ? supabase
              .from("credit_ledger")
              .select("acquisition_id,quantity")
              .eq("studio_id", studio.id)
              .in("acquisition_id", acquisitionIds)
          : Promise.resolve({ data: [] }),
      ])
    : [{ data: [] }, { data: [] }];

  const productMap = new Map((acquisitionProducts ?? []).map((item) => [item.id, item]));
  const balanceMap = new Map<string, number>();
  for (const row of ledgerRows ?? []) {
    balanceMap.set(row.acquisition_id, (balanceMap.get(row.acquisition_id) ?? 0) + row.quantity);
  }

  const phone = contacts?.find((item) => item.kind === "phone")?.value ?? student.phone;
  const email = contacts?.find((item) => item.kind === "email")?.value ?? student.email ?? "";
  const firstName = person?.first_name ?? student.full_name.split(" ")[0] ?? "";
  const lastName = person?.last_name ?? student.full_name.split(" ").slice(1).join(" ");
  const communicationPreferenceRow = communicationPreferencesResult.data;
  const communicationPreferences = {
    operational: communicationPreferenceRow?.operational_enabled ?? true,
    reminders: communicationPreferenceRow?.reminders_enabled ?? true,
    retention: communicationPreferenceRow?.retention_enabled ?? true,
    promotions: communicationPreferenceRow?.promotions_enabled ?? true,
    whatsappBlocked: communicationPreferenceRow?.whatsapp_blocked ?? false,
  };
  const communicationPreferenceEvents = communicationPreferenceEventsResult.data ?? [];
  const canEdit = can(CAPABILITIES.STUDENTS_WRITE);
  const canSell = can(CAPABILITIES.SALES_WRITE);
  const canArchive = can(CAPABILITIES.STUDENTS_ARCHIVE);
  const lifecycleEventsResult = canArchive
    ? await supabase
        .from("student_lifecycle_events")
        .select("id, from_status, to_status, created_at")
        .eq("student_id", student.id)
        .eq("studio_id", studio.id)
        .order("created_at", { ascending: false })
        .limit(12)
    : { data: [] };
  const lifecycleEvents = lifecycleEventsResult.data ?? [];
  const currentAcquisition = acquisitions.find(
    (item) => item.status === "active" && !item.refunded_at,
  );
  const dynamicDefinitions = (definitions ?? []).filter(
    (definition) => !structuralFieldKeys.has(definition.key),
  );
  const valueMap = new Map((fieldValues ?? []).map((item) => [item.definition_id, item.value]));

  const errorCopy: Record<string, string> = {
    phone_exists: "Ese teléfono ya pertenece a otra alumna.",
    profile_fields: "No se pudieron guardar los campos adicionales. Revisa sus valores.",
    acquisition_forbidden: "Tu rol no puede modificar adquisiciones.",
    acquisition_not_found: "La adquisición ya no está disponible.",
    acquisition_date_invalid: "Selecciona una fecha de inicio válida.",
    credits_invalid: "Indica créditos disponibles válidos y un motivo obligatorio.",
    adjustment_reason_required: "El motivo del ajuste de créditos es obligatorio.",
    unlimited_acquisition: "Una adquisición ilimitada no admite ajuste manual de créditos.",
    acquisition_not_editable: "Esta adquisición ya no puede modificarse.",
    communication_preferences:
      "No se pudieron guardar las preferencias de comunicación. Inténtalo de nuevo.",
  };

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
          {canSell && student.lifecycle_status === "active" ? (
            <Link className="primary-button" href={`/admin/ventas/nueva?student_id=${student.id}`}>
              Registrar venta
            </Link>
          ) : null}
          <span className="role-pill">
            {lifecycleCopy[student.lifecycle_status] ?? "Estado no disponible"}
          </span>
        </div>
      </header>

      <StudentLifecycleNoticeDialog
        result={
          query.lifecycle === "active" || query.lifecycle === "inactive"
            ? query.lifecycle
            : undefined
        }
        error={query.lifecycle_error}
      />

      {query.saved ? <div className="notice success">Cambios guardados correctamente.</div> : null}
      {query.error ? (
        <div className="notice error">
          {errorCopy[query.error] ?? "No se pudo guardar el cambio."}
        </div>
      ) : null}

      {query.alta === "finalizada" || query.alta === "sin_paquete" ? (
        <div className="notice success">
          {query.alta === "finalizada"
            ? "Alta registrada. La alumna, su compra y sus condiciones quedaron vinculadas al mismo expediente."
            : "Alta registrada sin paquete. El expediente queda disponible para operar cuando corresponda."}
          <div className="toolbar-actions mt-3">
            <Link className="primary-button" href={`/admin/alumnas/${student.id}/reservar`}>
              Reservar primera clase
            </Link>
            {can(CAPABILITIES.SETTINGS_WRITE) ? (
              <a className="ghost-button" href="#acceso-portal">
                Configurar acceso al portal
              </a>
            ) : null}
            {query.sale ? (
              <Link className="ghost-button" href={`/admin/ventas/${query.sale}`}>
                Ver venta
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      {query.alta === "reserva_realizada" ? (
        <div className="notice success">
          Primera reserva registrada. Demeter mantuvo la misma alumna y aplicó las reglas reales de
          paquete, inscripción, créditos y cupo.
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
          <strong className="stat-word">
            {lifecycleCopy[student.lifecycle_status] ?? "Estado no disponible"}
          </strong>
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
        </article>

        <article className="panel">
          <p className="eyebrow">RESUMEN OPERATIVO</p>
          <h2>Perfil 360</h2>
          <div className="student-list">
            <div className="student-row">
              <div>
                <strong>Paquete activo</strong>
                <span>
                  {!canReadProducts
                    ? "Sin acceso comercial para este rol."
                    : currentAcquisition
                      ? currentAcquisition.access_blocked
                        ? `${productMap.get(currentAcquisition.product_template_id)?.name ?? "Producto"} · bloqueado por pago pendiente`
                        : currentAcquisition.starts_on && currentAcquisition.expires_on
                          ? `${productMap.get(currentAcquisition.product_template_id)?.name ?? "Producto"} · vence ${formatDate(currentAcquisition.expires_on)}`
                          : `${
                              productMap.get(currentAcquisition.product_template_id)?.name ??
                              "Producto"
                            } · ${
                              currentAcquisition.unlimited
                                ? "inicia con la primera clase contabilizada"
                                : "inicia con el primer crédito consumido"
                            }`
                      : "Sin paquete activo"}
                </span>
              </div>
            </div>
            <div className="student-row">
              <div>
                <strong>Adquisiciones</strong>
                <span>{canReadProducts ? acquisitions.length : "—"}</span>
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

      {student.person_id ? (
        <section id="comunicacion" className="panel scroll-mt-6">
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
                          {formatDateTime(event.created_at)}
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
      ) : null}

      {canReadProducts ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">PAQUETES Y CRÉDITOS</p>
              <h2>Adquisiciones de la alumna</h2>
              <p>
                La fecha puede corregirse sin recrear el paquete. Los créditos se ajustan mediante
                movimientos auditables del ledger.
              </p>
            </div>
            <span className="count-badge">{acquisitions.length}</span>
          </div>

          {!acquisitions.length ? (
            <div className="empty-state">Esta alumna todavía no tiene adquisiciones.</div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {acquisitions.map((acquisition) => {
                const product = productMap.get(acquisition.product_template_id);
                const availableCredits = acquisition.unlimited
                  ? null
                  : (balanceMap.get(acquisition.id) ?? 0);
                const editable = canEditAcquisitions && !acquisition.refunded_at;

                return (
                  <article
                    key={acquisition.id}
                    className="rounded-2xl border border-white/10 bg-black/20 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-300">
                          {product?.package_term
                            ? (termCopy[product.package_term] ?? "Otra vigencia")
                            : "Producto"}
                        </p>
                        <h3 className="mt-1 font-semibold text-white">
                          {product?.name ?? "Producto"}
                        </h3>
                        <p className="mt-1 text-sm text-zinc-400">
                          {acquisition.starts_on && acquisition.expires_on
                            ? `${formatDate(acquisition.starts_on)} → ${formatDate(acquisition.expires_on)}`
                            : acquisition.unlimited
                              ? "Inicia con la primera clase contabilizada"
                              : "Inicia con el primer crédito consumido"}
                        </p>
                      </div>
                      <span className="status-pill">
                        {acquisition.access_blocked
                          ? "Bloqueada por pago pendiente"
                          : acquisition.activation_mode === "first_usage" && !acquisition.starts_on
                            ? acquisition.unlimited
                              ? "Pendiente de primer uso"
                              : "Pendiente de primer crédito"
                            : (acquisitionStatusCopy[acquisition.status] ?? "Estado no disponible")}
                      </span>
                    </div>

                    <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-xs text-zinc-500">Créditos disponibles</p>
                      <p className="mt-1 text-lg font-semibold text-white">
                        {acquisition.unlimited ? "Ilimitado" : availableCredits}
                      </p>
                    </div>

                    {editable ? (
                      <div className="mt-4 grid gap-4">
                        <form action={setAcquisitionStartDate} className="grid gap-2">
                          <input type="hidden" name="student_id" value={student.id} />
                          <input type="hidden" name="acquisition_id" value={acquisition.id} />
                          <label className="grid gap-1 text-sm text-zinc-300">
                            Fecha de inicio
                            <input
                              type="date"
                              name="starts_on"
                              required
                              defaultValue={acquisition.starts_on ?? ""}
                              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
                            />
                          </label>
                          <PendingActionButton
                            className="ghost-button"
                            pendingLabel="Actualizando…"
                          >
                            Actualizar fecha
                          </PendingActionButton>
                        </form>

                        {!acquisition.unlimited ? (
                          <form action={setAcquisitionAvailableCredits} className="grid gap-2">
                            <input type="hidden" name="student_id" value={student.id} />
                            <input type="hidden" name="acquisition_id" value={acquisition.id} />
                            <label className="grid gap-1 text-sm text-zinc-300">
                              Créditos disponibles
                              <input
                                type="number"
                                name="available_credits"
                                min="0"
                                max="100000"
                                step="1"
                                required
                                defaultValue={availableCredits ?? 0}
                                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
                              />
                            </label>
                            <label className="grid gap-1 text-sm text-zinc-300">
                              Motivo del ajuste
                              <input
                                type="text"
                                name="reason"
                                required
                                maxLength={500}
                                placeholder="Ej. Corrección por captura"
                                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
                              />
                            </label>
                            <PendingActionButton className="ghost-button" pendingLabel="Ajustando…">
                              Ajustar créditos
                            </PendingActionButton>
                          </form>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

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

      {canArchive ? (
        <section className="panel" id="estado-alumna">
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

          <div className="mt-6 border-t border-white/10 pt-5">
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
                      {formatDateTime(event.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}
    </main>
  );
}
