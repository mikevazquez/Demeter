import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { saveSessionResourcesAction } from "./actions";
import styles from "./session-resources.module.css";

type MapElement = {
  id: string;
  resource_id: string | null;
  element_kind: string;
  label: string | null;
  x: number | string;
  y: number | string;
  width: number | string;
  height: number | string;
  rotation_degrees: number | string;
};

function percent(value: number | string) {
  return `${Number(value) * 100}%`;
}

export default async function SessionResourcesPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { sessionId } = await params;
  const query = await searchParams;
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.SCHEDULE_READ);

  const { data: session } = await supabase
    .from("class_sessions")
    .select(
      "id,template_id,space_id,starts_at,status,requires_resource,resource_uses_per_item",
    )
    .eq("id", sessionId)
    .eq("studio_id", studio.id)
    .maybeSingle();

  if (!session) {
    redirect("/admin/agenda");
  }

  if (!session.requires_resource) {
    redirect(`/admin/agenda/${sessionId}`);
  }

  const canEdit = can(CAPABILITIES.SCHEDULE_WRITE);

  const [
    { data: template },
    { data: space },
    { data: resources },
    { data: types },
    { data: settings },
    { data: mapElements },
    { data: assignments },
  ] = await Promise.all([
    supabase.from("class_templates").select("name").eq("id", session.template_id).maybeSingle(),
    session.space_id
      ? supabase
          .from("spaces")
          .select("id,name")
          .eq("id", session.space_id)
          .eq("studio_id", studio.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    session.space_id
      ? supabase
          .from("resources")
          .select("id,name,short_label,resource_type_id,active")
          .eq("studio_id", studio.id)
          .eq("space_id", session.space_id)
          .order("name")
      : Promise.resolve({ data: [] }),
    supabase
      .from("resource_types")
      .select("id,name")
      .eq("studio_id", studio.id)
      .order("sort_order"),
    supabase
      .from("session_resources")
      .select("resource_id,enabled,capacity_override")
      .eq("studio_id", studio.id)
      .eq("session_id", session.id),
    session.space_id
      ? supabase
          .from("space_map_elements")
          .select(
            "id,resource_id,element_kind,label,x,y,width,height,rotation_degrees",
          )
          .eq("studio_id", studio.id)
          .eq("space_id", session.space_id)
          .order("z_index")
      : Promise.resolve({ data: [] }),
    supabase
      .from("reservation_resource_assignments")
      .select("resource_id")
      .eq("studio_id", studio.id)
      .eq("session_id", session.id)
      .is("released_at", null),
  ]);

  const settingMap = new Map((settings ?? []).map((item) => [item.resource_id, item]));
  const typeMap = new Map((types ?? []).map((item) => [item.id, item.name]));
  const resourceMap = new Map(
    (resources ?? []).map((item) => [item.id, item.short_label || item.name]),
  );
  const assignmentCount = new Map<string, number>();

  for (const assignment of assignments ?? []) {
    assignmentCount.set(
      assignment.resource_id,
      (assignmentCount.get(assignment.resource_id) ?? 0) + 1,
    );
  }

  const enabledCount = (resources ?? []).filter(
    (resource) => settingMap.get(resource.id)?.enabled === true,
  ).length;
  const occupiedCount = (assignments ?? []).length;
  const elements = (mapElements ?? []) as MapElement[];
  const errorCopy: Record<string, string> = {
    invalid: "Usa un número válido de usos por recurso.",
    assigned:
      "No puedes reducir o desactivar ese recurso porque ya tiene alumnas asignadas.",
    cancelled: "La sesión está cancelada y ya no puede modificarse.",
    save: "No pudimos guardar la configuración de recursos.",
  };

  const dateLabel = new Intl.DateTimeFormat("es-MX", {
    timeZone: studio.timezone ?? "America/Mexico_City",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(session.starts_at));

  return (
    <main className={`dashboard-shell ${styles.page}`}>
      <header className={styles.header}>
        <div>
          <Link className={styles.back} href={`/admin/agenda/${sessionId}`}>
            ← Volver a la sesión
          </Link>
          <p className={styles.eyebrow}>RECURSOS DE LA SESIÓN · {studio.name}</p>
          <h1>{template?.name ?? "Clase"}</h1>
          <p>
            {dateLabel} · {space?.name ?? "Sin espacio"}
          </p>
        </div>
      </header>

      {query.saved === "1" ? (
        <div className={`${styles.notice} ${styles.success}`}>
          Configuración de recursos guardada.
        </div>
      ) : null}

      {query.error ? (
        <div className={`${styles.notice} ${styles.error}`}>
          {errorCopy[query.error] ?? "No pudimos completar el cambio."}
        </div>
      ) : null}

      <section className={styles.summary}>
        <article>
          <span>Recursos disponibles</span>
          <strong>{enabledCount}</strong>
          <small>Habilitados para esta sesión</small>
        </article>
        <article>
          <span>Usos por recurso</span>
          <strong>{session.resource_uses_per_item}</strong>
          <small>Valor predeterminado de esta sesión</small>
        </article>
        <article>
          <span>Asignaciones actuales</span>
          <strong>{occupiedCount}</strong>
          <small>Usos ya ocupados</small>
        </article>
      </section>

      {!space ? (
        <div className={`${styles.notice} ${styles.error}`}>
          Esta sesión necesita un espacio antes de configurar recursos.
        </div>
      ) : (
        <form action={saveSessionResourcesAction}>
          <input type="hidden" name="session_id" value={session.id} />

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2>Recursos disponibles</h2>
                <p>
                  Activa solo los recursos que podrán elegirse en esta clase. El mapa global
                  no se modifica.
                </p>
              </div>
            </div>

            <label className={styles.defaultUses}>
              <span>
                <strong>Usos predeterminados por recurso</strong>
                <small>
                  1 = una alumna por recurso. 2 = dos alumnas pueden compartir el mismo
                  recurso.
                </small>
              </span>
              <input
                name="default_uses"
                type="number"
                min="1"
                max="20"
                defaultValue={session.resource_uses_per_item}
                disabled={!canEdit}
                required
              />
            </label>

            <div className={styles.resourceList}>
              {(resources ?? []).map((resource) => {
                const setting = settingMap.get(resource.id);
                const enabled = setting?.enabled === true;
                const effectiveCapacity =
                  setting?.capacity_override ?? session.resource_uses_per_item;
                const used = assignmentCount.get(resource.id) ?? 0;

                return (
                  <article className={styles.resourceRow} key={resource.id}>
                    <input
                      className={styles.toggle}
                      type="checkbox"
                      name={`enabled_${resource.id}`}
                      value="1"
                      defaultChecked={enabled}
                      disabled={!canEdit || !resource.active}
                      aria-label={`Habilitar ${resource.name}`}
                    />
                    <div className={styles.resourceCopy}>
                      <strong>{resource.name}</strong>
                      <small>
                        {typeMap.get(resource.resource_type_id) ?? "Recurso"}
                        {!resource.active ? " · Inactivo globalmente" : ""}
                      </small>
                    </div>
                    <label className={styles.capacity}>
                      <input
                        name={`capacity_${resource.id}`}
                        type="number"
                        min="1"
                        max="20"
                        placeholder={String(session.resource_uses_per_item)}
                        defaultValue={setting?.capacity_override ?? ""}
                        disabled={!canEdit || !resource.active}
                        aria-label={`Usos personalizados para ${resource.name}`}
                      />
                    </label>
                    <span className={styles.usage}>
                      {used}/{effectiveCapacity}
                    </span>
                  </article>
                );
              })}
            </div>

            {!resources?.length ? (
              <div className={styles.notice}>
                Este espacio todavía no tiene recursos físicos configurados.
              </div>
            ) : null}

            {canEdit ? (
              <div className={styles.footer}>
                <button className={styles.save} type="submit">
                  Guardar recursos
                </button>
              </div>
            ) : null}
          </section>
        </form>
      )}

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>Vista del mapa</h2>
            <p>Usa exactamente la geometría configurada para {space?.name ?? "el espacio"}.</p>
          </div>
        </div>

        <div className={styles.map}>
          {elements.length ? (
            elements.map((element) => {
              const setting = element.resource_id
                ? settingMap.get(element.resource_id)
                : null;
              const enabled = element.resource_id ? setting?.enabled === true : true;
              const capacity = element.resource_id
                ? (setting?.capacity_override ?? session.resource_uses_per_item)
                : 1;
              const used = element.resource_id
                ? (assignmentCount.get(element.resource_id) ?? 0)
                : 0;
              const label = element.resource_id
                ? (resourceMap.get(element.resource_id) ?? "R")
                : (element.label ?? element.element_kind);

              return (
                <span
                  className={styles.mapElement}
                  data-kind={element.element_kind}
                  data-enabled={enabled}
                  data-full={element.resource_id ? used >= capacity : false}
                  key={element.id}
                  style={{
                    left: percent(element.x),
                    top: percent(element.y),
                    width: percent(element.width),
                    height: percent(element.height),
                    transform: `rotate(${Number(element.rotation_degrees)}deg)`,
                  }}
                >
                  {label}
                </span>
              );
            })
          ) : (
            <span className={styles.mapEmpty}>El mapa de este espacio todavía está vacío.</span>
          )}
        </div>
      </section>
    </main>
  );
}
