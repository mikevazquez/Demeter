"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function number(formData: FormData, key: string, fallback = 0) {
  const value = Number(formData.get(key));
  return Number.isFinite(value) ? value : fallback;
}

export async function enableEvaluationDiscipline(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);
  const disciplineId = text(formData, "discipline_id");

  const [{ data: discipline }, { data: levels }] = await Promise.all([
    ctx.supabase
      .from("disciplines")
      .select("id")
      .eq("id", disciplineId)
      .eq("studio_id", ctx.studio.id)
      .eq("active", true)
      .maybeSingle(),
    ctx.supabase
      .from("technical_level_definitions")
      .select("id,level_order")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true)
      .order("level_order"),
  ]);

  if (!discipline || !levels?.length) {
    redirect("/admin/evaluaciones/configuracion?error=discipline");
  }

  const rows = levels.map((level) => ({
    studio_id: ctx.studio.id,
    discipline_id: disciplineId,
    technical_level_id: level.id,
    discipline_order: level.level_order,
    active: true,
  }));

  const { error } = await ctx.supabase
    .from("discipline_technical_levels")
    .upsert(rows, {
      onConflict: "studio_id,discipline_id,technical_level_id",
      ignoreDuplicates: false,
    });

  if (error) redirect("/admin/evaluaciones/configuracion?error=discipline");

  revalidatePath("/admin/evaluaciones");
  revalidatePath("/admin/evaluaciones/configuracion");
  redirect("/admin/evaluaciones/configuracion?saved=discipline");
}

export async function setEvaluationDisciplineActive(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);
  const disciplineId = text(formData, "discipline_id");
  const active = text(formData, "active") === "true";

  const { error } = await ctx.supabase
    .from("discipline_technical_levels")
    .update({ active })
    .eq("studio_id", ctx.studio.id)
    .eq("discipline_id", disciplineId);

  if (error) redirect("/admin/evaluaciones/configuracion?error=discipline");

  revalidatePath("/admin/evaluaciones");
  revalidatePath("/admin/evaluaciones/configuracion");
  redirect("/admin/evaluaciones/configuracion?saved=discipline");
}

export async function createEvaluationTemplate(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);
  const disciplineLevelId = text(formData, "discipline_level_id");
  const name = text(formData, "name");

  if (name.length < 2 || !disciplineLevelId) {
    redirect("/admin/evaluaciones/configuracion?error=template");
  }

  const { data: level } = await ctx.supabase
    .from("discipline_technical_levels")
    .select("id,discipline_id")
    .eq("id", disciplineLevelId)
    .eq("studio_id", ctx.studio.id)
    .eq("active", true)
    .maybeSingle();

  if (!level) redirect("/admin/evaluaciones/configuracion?error=template");

  const { data: template, error: templateError } = await ctx.supabase
    .from("evaluation_templates")
    .insert({
      studio_id: ctx.studio.id,
      discipline_id: level.discipline_id,
      discipline_technical_level_id: level.id,
      name,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (templateError || !template) {
    redirect("/admin/evaluaciones/configuracion?error=template");
  }

  const { data: version, error: versionError } = await ctx.supabase
    .from("evaluation_template_versions")
    .insert({
      studio_id: ctx.studio.id,
      template_id: template.id,
      version_number: 1,
      status: "draft",
      pass_threshold: 80,
      default_category_min: 70,
      default_attempts_per_element: 3,
      default_attempts_per_combo: 3,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (versionError || !version) {
    redirect("/admin/evaluaciones/configuracion?error=template");
  }

  const { error: criteriaError } = await ctx.supabase.from("evaluation_template_criteria").insert([
    {
      studio_id: ctx.studio.id,
      template_version_id: version.id,
      criterion_key: "execution",
      label: "Ejecución",
      description: "Limpieza, control y reagarres.",
      weight_percent: 45,
      min_percent: 70,
      sort_order: 1,
    },
    {
      studio_id: ctx.studio.id,
      template_version_id: version.id,
      criterion_key: "strength",
      label: "Fuerza",
      description: "Control corporal y resistencia.",
      weight_percent: 25,
      min_percent: 70,
      sort_order: 2,
    },
    {
      studio_id: ctx.studio.id,
      template_version_id: version.id,
      criterion_key: "lines",
      label: "Líneas",
      description: "Estética, postura y fluidez.",
      weight_percent: 25,
      min_percent: 70,
      sort_order: 3,
    },
    {
      studio_id: ctx.studio.id,
      template_version_id: version.id,
      criterion_key: "flexibility",
      label: "Flexibilidad",
      description: "Rango, movilidad y control.",
      weight_percent: 5,
      min_percent: 70,
      sort_order: 4,
    },
  ]);

  if (criteriaError) {
    redirect("/admin/evaluaciones/configuracion?error=template");
  }

  revalidatePath("/admin/evaluaciones/configuracion");
  redirect(`/admin/evaluaciones/plantillas/${template.id}?created=1`);
}

export async function updateEvaluationTemplateSettings(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);
  const versionId = text(formData, "version_id");
  const templateId = text(formData, "template_id");
  const passThreshold = number(formData, "pass_threshold", 80);
  const categoryMin = number(formData, "category_min", 70);
  const attemptsElement = number(formData, "attempts_element", 3);
  const attemptsCombo = number(formData, "attempts_combo", 3);
  const instructions = text(formData, "instructions");

  const { error } = await ctx.supabase
    .from("evaluation_template_versions")
    .update({
      pass_threshold: passThreshold,
      default_category_min: categoryMin,
      default_attempts_per_element: attemptsElement,
      default_attempts_per_combo: attemptsCombo,
      evaluator_instructions: instructions || null,
    })
    .eq("id", versionId)
    .eq("studio_id", ctx.studio.id);

  if (error) redirect(`/admin/evaluaciones/plantillas/${templateId}?error=settings`);

  revalidatePath(`/admin/evaluaciones/plantillas/${templateId}`);
  redirect(`/admin/evaluaciones/plantillas/${templateId}?saved=settings`);
}

export async function updateEvaluationCriteria(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);
  const templateId = text(formData, "template_id");
  const versionId = text(formData, "version_id");

  const { data: criteria } = await ctx.supabase
    .from("evaluation_template_criteria")
    .select("id")
    .eq("studio_id", ctx.studio.id)
    .eq("template_version_id", versionId);

  if (!criteria?.length) redirect(`/admin/evaluaciones/plantillas/${templateId}?error=criteria`);

  const updates = criteria.map(async (criterion) =>
    ctx.supabase
      .from("evaluation_template_criteria")
      .update({
        weight_percent: number(formData, `weight_${criterion.id}`),
        min_percent: number(formData, `min_${criterion.id}`, 70),
      })
      .eq("id", criterion.id)
      .eq("studio_id", ctx.studio.id),
  );

  const results = await Promise.all(updates);
  if (results.some((result) => result.error)) {
    redirect(`/admin/evaluaciones/plantillas/${templateId}?error=criteria`);
  }

  revalidatePath(`/admin/evaluaciones/plantillas/${templateId}`);
  redirect(`/admin/evaluaciones/plantillas/${templateId}?saved=criteria`);
}
