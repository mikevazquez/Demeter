"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

function resourcesPath(params?: Record<string, string>) {
  const query = new URLSearchParams(params);
  return query.size
    ? `/admin/configuracion/recursos?${query.toString()}`
    : "/admin/configuracion/recursos";
}

function mapPath(spaceId: string, params?: Record<string, string>) {
  const query = new URLSearchParams(params);
  const base = `/admin/configuracion/recursos/${spaceId}/mapa`;
  return query.size ? `${base}?${query.toString()}` : base;
}

async function requireResourceAdmin() {
  const ctx = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);

  if (ctx.membership.role !== "owner") {
    redirect("/admin?error=access");
  }

  return ctx;
}

export async function createResourceAction(formData: FormData) {
  const ctx = await requireResourceAdmin();

  const spaceId = String(formData.get("space_id") ?? "").trim();
  const resourceTypeId = String(formData.get("resource_type_id") ?? "").trim();
  const baseName = String(formData.get("name") ?? "").trim();
  const shortLabel = String(formData.get("short_label") ?? "").trim();
  const quantity = Math.min(
    Math.max(Number.parseInt(String(formData.get("quantity") ?? "1"), 10) || 1, 1),
    30,
  );

  if (!spaceId || !resourceTypeId || baseName.length < 1 || baseName.length > 80) {
    redirect(resourcesPath({ error: "resource" }));
  }

  const [{ data: space }, { data: resourceType }] = await Promise.all([
    ctx.supabase
      .from("spaces")
      .select("id")
      .eq("id", spaceId)
      .eq("studio_id", ctx.studio.id)
      .eq("active", true)
      .maybeSingle(),
    ctx.supabase
      .from("resource_types")
      .select("id")
      .eq("id", resourceTypeId)
      .eq("studio_id", ctx.studio.id)
      .eq("active", true)
      .maybeSingle(),
  ]);

  if (!space || !resourceType) {
    redirect(resourcesPath({ error: "resource" }));
  }

  const rows = Array.from({ length: quantity }, (_, index) => {
    const suffix = quantity > 1 ? ` ${index + 1}` : "";
    const generatedLabel =
      quantity > 1 && shortLabel ? `${shortLabel}${index + 1}` : shortLabel || null;

    return {
      studio_id: ctx.studio.id,
      space_id: space.id,
      resource_type_id: resourceType.id,
      name: `${baseName}${suffix}`,
      short_label: generatedLabel,
      active: true,
    };
  });

  const { error } = await ctx.supabase.from("resources").insert(rows);

  if (error) {
    console.error("[recursos01] Resource creation failed", {
      code: error.code,
      message: error.message.slice(0, 160),
    });
    redirect(resourcesPath({ error: error.code === "23505" ? "duplicate" : "resource" }));
  }

  revalidatePath("/admin/configuracion/recursos");
  redirect(resourcesPath({ created: quantity.toString() }));
}

export async function renameResourceAction(formData: FormData) {
  const ctx = await requireResourceAdmin();

  const resourceId = String(formData.get("resource_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const shortLabel = String(formData.get("short_label") ?? "").trim();

  if (!resourceId || name.length < 1 || name.length > 80) {
    redirect(resourcesPath({ error: "resource" }));
  }

  const { error } = await ctx.supabase
    .from("resources")
    .update({
      name,
      short_label: shortLabel || null,
    })
    .eq("id", resourceId)
    .eq("studio_id", ctx.studio.id);

  if (error) {
    console.error("[recursos01] Resource rename failed", {
      code: error.code,
      message: error.message.slice(0, 160),
    });
    redirect(resourcesPath({ error: error.code === "23505" ? "duplicate" : "resource" }));
  }

  revalidatePath("/admin/configuracion/recursos");
  redirect(resourcesPath({ saved: "1" }));
}

export async function toggleResourceActiveAction(formData: FormData) {
  const ctx = await requireResourceAdmin();

  const resourceId = String(formData.get("resource_id") ?? "").trim();
  const nextActive = String(formData.get("next_active") ?? "") === "1";

  if (!resourceId) {
    redirect(resourcesPath({ error: "resource" }));
  }

  const { error } = await ctx.supabase
    .from("resources")
    .update({ active: nextActive })
    .eq("id", resourceId)
    .eq("studio_id", ctx.studio.id);

  if (error) {
    console.error("[recursos01] Resource status update failed", {
      code: error.code,
      message: error.message.slice(0, 160),
    });
    redirect(
      resourcesPath({
        error: error.message.includes("resource_has_future_assignments") ? "assigned" : "resource",
      }),
    );
  }

  revalidatePath("/admin/configuracion/recursos");
  redirect(resourcesPath({ saved: "1" }));
}

export async function saveSpaceMapAction(formData: FormData) {
  const ctx = await requireResourceAdmin();

  const spaceId = String(formData.get("space_id") ?? "").trim();
  const canvasWidth = Number.parseInt(String(formData.get("canvas_width") ?? "1000"), 10);
  const canvasHeight = Number.parseInt(String(formData.get("canvas_height") ?? "700"), 10);
  const rawElements = String(formData.get("elements_json") ?? "[]");

  if (!spaceId) {
    redirect(resourcesPath({ error: "map" }));
  }

  let elements: unknown;
  try {
    elements = JSON.parse(rawElements);
  } catch {
    redirect(mapPath(spaceId, { error: "map" }));
  }

  if (!Array.isArray(elements) || elements.length > 250) {
    redirect(mapPath(spaceId, { error: "map" }));
  }

  const { error } = await ctx.supabase.rpc("admin_save_space_resource_map", {
    p_space_id: spaceId,
    p_canvas_width: canvasWidth,
    p_canvas_height: canvasHeight,
    p_elements: elements,
  });

  if (error) {
    console.error("[recursos01] Map save failed", {
      code: error.code,
      message: error.message.slice(0, 180),
    });
    redirect(mapPath(spaceId, { error: "map" }));
  }

  revalidatePath("/admin/configuracion/recursos");
  revalidatePath(mapPath(spaceId));
  redirect(mapPath(spaceId, { saved: "1" }));
}
