import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { createResourceAction, renameResourceAction, toggleResourceActiveAction } from "./actions";
import styles from "./recursos.module.css";

type MapElementRow = {
  id: string;
  space_id: string;
  resource_id: string | null;
  element_kind: string;
  label: string | null;
  x: number | string;
  y: number | string;
  width: number | string;
  height: number | string;
  rotation_degrees: number | string;
};

function asPercent(value: number | string) {
  return `${Number(value) * 100}%`;
}

export default async function ResourcesConfigurationPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  if (!ctx.can(CAPABILITIES.RESOURCES_MANAGE)) {
    redirect("/admin/configuracion?error=access");
  }

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  const [
    { data: spaces },
    { data: resourceTypes },
    { data: resources },
    { data: maps },
    { data: mapElements },
  ] = await Promise.all([
    ctx.supabase
      .from("spaces")
      .select("id,name,capacity,active")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true)
      .order("name"),
    ctx.supabase
      .from("resource_types")
      .select("id,key,name,active,sort_order")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true)
      .order("sort_order"),
    ctx.supabase
      .from("resources")
      .select("id,space_id,resource_type_id,name,short_label,active")
      .eq("studio_id", ctx.studio.id)
      .order("name"),
    ctx.supabase
      .from("space_maps")
      .select("space_id,canvas_width,canvas_height,revision")
      .eq("studio_id", ctx.studio.id),
    ctx.supabase
      .from("space_map_elements")
      .select("id,space_id,resource_id,element_kind,label,x,y,width,height,rotation_degrees")
      .eq("studio_id", ctx.studio.id),
  ]);

  const typeName = new Map((resourceTypes ?? []).map((item) => [item.id, item.name]));
  const resourceName = new Map(
    (resources ?? []).map((item) => [item.id, item.short_label || item.name]),
  );
  const mapBySpace = new Map((maps ?? []).map((item) => [item.space_id, item]));
  const elements = (mapElements ?? []) as MapElementRow[];
  const activeResourceCount = (resources ?? []).filter((item) => item.active).length;
  const configuredSpaceCount = new Set(elements.map((item) => item.space_id)).size;

  const errorCopy: Record<string, string> = {
    resource: "No pudimos guardar el recurso. Revisa los datos e inténtalo nuevamente.",
    duplicate: "Ya existe un recurso con ese nombre dentro del mismo espacio.",
    assigned: "Ese recurso tiene asignaciones futuras y no puede desactivarse todavía.",
    map: "No pudimos guardar el mapa.",
  };

  return (
    <main className={`dashboard-shell ${styles.page}`}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <Link className={styles.backLink} href="/admin/configuracion">
            ← Configuración
          </Link>
          <p className={styles.eyebrow}>CONFIGURACIÓN · {ctx.studio.name}</p>
          <h1>Recursos</h1>
          <p>
            Define los recursos físicos de cada espacio y construye una sola geometría que Studio
            Flow reutiliza en administración, sesiones y reservas.
          </p>
        </div>

        <details className={styles.createDrawer}>
          <summary className={styles.primaryButton}>+ Nuevo recurso</summary>
          <div className={styles.createPopover}>
            <div className={styles.popoverHeading}>
              <strong>Agregar recursos</strong>
              <span>Si agregas varios, se numeran automáticamente.</span>
            </div>

            <form action={createResourceAction} className={styles.createForm}>
              <label className={styles.field}>
                <span>Espacio</span>
                <select name="space_id" required defaultValue="">
                  <option value="" disabled>
                    Selecciona
                  </option>
                  {spaces?.map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span>Tipo</span>
                <select name="resource_type_id" required defaultValue="">
                  <option value="" disabled>
                    Selecciona
                  </option>
                  {resourceTypes?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span>Nombre base</span>
                <input name="name" required maxLength={80} placeholder="Ej. Pole" />
              </label>

              <label className={styles.field}>
                <span>Etiqueta</span>
                <input name="short_label" maxLength={20} placeholder="Ej. P" />
              </label>

              <label className={styles.field}>
                <span>Cantidad</span>
                <input name="quantity" type="number" min="1" max="30" defaultValue="1" required />
              </label>

              <button className={styles.primaryButton} type="submit">
                Agregar recursos
              </button>
            </form>
          </div>
        </details>
      </header>

      {params.created ? (
        <div className={`${styles.notice} ${styles.success}`}>
          {params.created === "1"
            ? "Recurso creado correctamente."
            : `${params.created} recursos creados correctamente.`}
        </div>
      ) : null}

      {params.saved === "1" ? (
        <div className={`${styles.notice} ${styles.success}`}>Cambios guardados.</div>
      ) : null}

      {params.error ? (
        <div className={`${styles.notice} ${styles.error}`}>
          {errorCopy[params.error] ?? "No pudimos guardar los cambios."}
        </div>
      ) : null}

      <section className={styles.summary}>
        <article className={styles.summaryCard}>
          <span className={styles.summaryIcon}>◇</span>
          <div>
            <small>Espacios</small>
            <strong>{spaces?.length ?? 0}</strong>
            <p>con distribución configurable</p>
          </div>
        </article>
        <article className={styles.summaryCard}>
          <span className={styles.summaryIcon}>●</span>
          <div>
            <small>Recursos activos</small>
            <strong>{activeResourceCount}</strong>
            <p>físicos y reservables</p>
          </div>
        </article>
        <article className={styles.summaryCard}>
          <span className={styles.summaryIcon}>▦</span>
          <div>
            <small>Mapas configurados</small>
            <strong>
              {configuredSpaceCount}/{spaces?.length ?? 0}
            </strong>
            <p>misma geometría para todos</p>
          </div>
        </article>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionEyebrow}>ESPACIOS</p>
            <h2>Distribución física</h2>
            <p>Previsualiza cada mapa y entra a editar su distribución.</p>
          </div>
        </div>

        {spaces?.length ? (
          <div className={styles.spaceGrid}>
            {spaces.map((space) => {
              const spaceElements = elements.filter((item) => item.space_id === space.id);
              const spaceResources = (resources ?? []).filter(
                (item) => item.space_id === space.id && item.active,
              );
              const referenceCount = spaceElements.filter((item) => !item.resource_id).length;
              const map = mapBySpace.get(space.id);

              return (
                <article className={styles.spaceCard} key={space.id}>
                  <div className={styles.spaceTop}>
                    <div>
                      <div className={styles.spaceTitleLine}>
                        <strong>{space.name}</strong>
                        <span className={styles.activePill}>Activo</span>
                      </div>
                      <small>Mapa v{map?.revision ?? 0}</small>
                    </div>
                    <Link
                      className={styles.secondaryButton}
                      href={`/admin/configuracion/recursos/${space.id}/mapa`}
                    >
                      Editar mapa
                    </Link>
                  </div>

                  <div className={styles.mapPreview} aria-label={`Mapa de ${space.name}`}>
                    {spaceElements.length ? (
                      spaceElements.map((element) => (
                        <span
                          key={element.id}
                          className={styles.previewElement}
                          data-kind={element.element_kind}
                          style={{
                            left: asPercent(element.x),
                            top: asPercent(element.y),
                            width: asPercent(element.width),
                            height: asPercent(element.height),
                            transform: `rotate(${Number(element.rotation_degrees)}deg)`,
                          }}
                        >
                          {element.resource_id
                            ? (resourceName.get(element.resource_id) ?? "R")
                            : (element.label ?? element.element_kind)}
                        </span>
                      ))
                    ) : (
                      <span className={styles.previewEmpty}>
                        <b>Mapa pendiente</b>
                        <small>Abre el editor para colocar referencias y recursos.</small>
                      </span>
                    )}
                  </div>

                  <div className={styles.spaceFooter}>
                    <span>
                      <b>{spaceResources.length}</b> recursos configurados
                    </span>
                    <span>
                      <b>{referenceCount}</b> referencias
                    </span>
                    <span>
                      {space.capacity ? `Cupo físico ${space.capacity}` : "Sin cupo físico"}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className={styles.empty}>
            Primero crea un espacio activo para poder configurar recursos.
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionEyebrow}>INVENTARIO FÍSICO</p>
            <h2>Recursos existentes</h2>
            <p>La identidad de cada recurso se conserva aunque cambie de posición.</p>
          </div>
        </div>

        {resources?.length ? (
          <div className={styles.resourceList}>
            {resources.map((resource) => (
              <article className={styles.resourceRow} key={resource.id}>
                <span className={styles.resourceIcon} aria-hidden="true">
                  ◉
                </span>
                <div className={styles.resourceCopy}>
                  <strong>{resource.name}</strong>
                  <small>
                    {typeName.get(resource.resource_type_id) ?? "Recurso"} ·{" "}
                    {spaces?.find((space) => space.id === resource.space_id)?.name ?? "Espacio"}
                    {resource.short_label ? ` · ${resource.short_label}` : ""}
                  </small>
                </div>
                <span
                  className={
                    resource.active ? styles.status : `${styles.status} ${styles.statusInactive}`
                  }
                >
                  {resource.active ? "Activo" : "Inactivo"}
                </span>
                <div className={styles.inlineActions}>
                  <details className={styles.editDetails}>
                    <summary className={styles.ghostButton}>Editar</summary>
                    <form action={renameResourceAction} className={styles.editPanel}>
                      <input type="hidden" name="resource_id" value={resource.id} />
                      <label className={styles.field}>
                        <span>Nombre</span>
                        <input name="name" defaultValue={resource.name} required maxLength={80} />
                      </label>
                      <label className={styles.field}>
                        <span>Etiqueta corta</span>
                        <input
                          name="short_label"
                          defaultValue={resource.short_label ?? ""}
                          maxLength={20}
                        />
                      </label>
                      <button className={styles.primaryButton} type="submit">
                        Guardar
                      </button>
                    </form>
                  </details>

                  <form action={toggleResourceActiveAction}>
                    <input type="hidden" name="resource_id" value={resource.id} />
                    <input type="hidden" name="next_active" value={resource.active ? "0" : "1"} />
                    <button
                      className={resource.active ? styles.dangerButton : styles.ghostButton}
                      type="submit"
                    >
                      {resource.active ? "Desactivar" : "Activar"}
                    </button>
                  </form>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>Aún no hay recursos configurados.</div>
        )}
      </section>
    </main>
  );
}
