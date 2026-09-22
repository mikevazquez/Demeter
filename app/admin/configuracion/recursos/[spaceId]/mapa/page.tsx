import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { ResourceMapEditor, type EditableMapElement } from "./ResourceMapEditor";
import styles from "../../recursos.module.css";

export default async function ResourceMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ spaceId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { spaceId } = await params;
  const query = await searchParams;
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  const [
    { data: space },
    { data: map },
    { data: elements },
    { data: resources },
    { data: resourceTypes },
  ] = await Promise.all([
    ctx.supabase
      .from("spaces")
      .select("id,name,capacity,active")
      .eq("id", spaceId)
      .eq("studio_id", ctx.studio.id)
      .maybeSingle(),
    ctx.supabase
      .from("space_maps")
      .select("canvas_width,canvas_height,revision")
      .eq("space_id", spaceId)
      .eq("studio_id", ctx.studio.id)
      .maybeSingle(),
    ctx.supabase
      .from("space_map_elements")
      .select(
        "id,resource_id,element_kind,label,x,y,width,height,rotation_degrees,z_index,metadata",
      )
      .eq("space_id", spaceId)
      .eq("studio_id", ctx.studio.id)
      .order("z_index"),
    ctx.supabase
      .from("resources")
      .select("id,name,short_label,active,resource_type_id")
      .eq("space_id", spaceId)
      .eq("studio_id", ctx.studio.id)
      .order("name"),
    ctx.supabase
      .from("resource_types")
      .select("id,name")
      .eq("studio_id", ctx.studio.id),
  ]);

  if (!space) {
    notFound();
  }

  const typeName = new Map((resourceTypes ?? []).map((item) => [item.id, item.name]));

  const initialElements: EditableMapElement[] = (elements ?? []).map((element) => ({
    id: element.id,
    resource_id: element.resource_id,
    element_kind: element.element_kind as EditableMapElement["element_kind"],
    label: element.label,
    x: Number(element.x),
    y: Number(element.y),
    width: Number(element.width),
    height: Number(element.height),
    rotation_degrees: Number(element.rotation_degrees),
    z_index: element.z_index,
    metadata:
      element.metadata && typeof element.metadata === "object"
        ? (element.metadata as Record<string, unknown>)
        : {},
  }));

  return (
    <main className={`dashboard-shell ${styles.editorPage}`}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <Link className={styles.backLink} href="/admin/configuracion/recursos">
            ← Recursos
          </Link>
          <p className={styles.eyebrow}>EDITOR DE MAPA · {ctx.studio.name}</p>
          <h1>{space.name}</h1>
          <p>
            Esta geometría es la fuente única para administración, sesiones y reserva de
            alumnas.
          </p>
        </div>
      </header>

      {query.saved === "1" ? (
        <div className={`${styles.notice} ${styles.success}`}>
          Mapa guardado correctamente.
        </div>
      ) : null}

      {query.error ? (
        <div className={`${styles.notice} ${styles.error}`}>
          No pudimos guardar el mapa. Revisa que cada recurso aparezca una sola vez.
        </div>
      ) : null}

      <ResourceMapEditor
        spaceId={space.id}
        resources={(resources ?? []).map((resource) => ({
          id: resource.id,
          name: resource.name,
          shortLabel: resource.short_label,
          active: resource.active,
          typeName: typeName.get(resource.resource_type_id) ?? "Recurso",
        }))}
        initialElements={initialElements}
        initialCanvasWidth={map?.canvas_width ?? 1000}
        initialCanvasHeight={map?.canvas_height ?? 700}
      />
    </main>
  );
}
