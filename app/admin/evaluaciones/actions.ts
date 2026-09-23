"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function number(formData: FormData, key: string, fallback = 0) {
  const raw = String(formData.get(key) ?? "")
    .trim()
    .replace(",", ".");
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export async function prepareEvaluationDisciplineAction(formData: FormData) {
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
    redirect("/admin/evaluaciones?error=discipline");
  }

  const { error } = await ctx.supabase.from("discipline_technical_levels").upsert(
    levels.map((level) => ({
      studio_id: ctx.studio.id,
      discipline_id: disciplineId,
      technical_level_id: level.id,
      discipline_order: level.level_order,
      active: false,
    })),
    {
      onConflict: "studio_id,discipline_id,technical_level_id",
      ignoreDuplicates: true,
    },
  );

  if (error) {
    redirect("/admin/evaluaciones?error=discipline");
  }

  revalidatePath("/admin/evaluaciones");
  revalidatePath(`/admin/evaluaciones/disciplina/${disciplineId}`);
  redirect(`/admin/evaluaciones/disciplina/${disciplineId}`);
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
    redirect(`/admin/evaluaciones/disciplina/${disciplineId}?error=discipline`);
  }

  const rows = levels.map((level) => ({
    studio_id: ctx.studio.id,
    discipline_id: disciplineId,
    technical_level_id: level.id,
    discipline_order: level.level_order,
    active: true,
  }));

  const { error } = await ctx.supabase.from("discipline_technical_levels").upsert(rows, {
    onConflict: "studio_id,discipline_id,technical_level_id",
    ignoreDuplicates: false,
  });

  if (error) redirect(`/admin/evaluaciones/disciplina/${disciplineId}?error=discipline`);

  revalidatePath("/admin/evaluaciones");
  revalidatePath(`/admin/evaluaciones/disciplina/${disciplineId}`);
  redirect(`/admin/evaluaciones/disciplina/${disciplineId}`);
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

  if (error) redirect(`/admin/evaluaciones/disciplina/${disciplineId}?error=discipline`);

  revalidatePath("/admin/evaluaciones");
  revalidatePath(`/admin/evaluaciones/disciplina/${disciplineId}`);
  redirect("/admin/evaluaciones");
}

export async function setEvaluationDisciplineLevelActive(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);
  const disciplineId = text(formData, "discipline_id");
  const disciplineLevelId = text(formData, "discipline_level_id");
  const active = text(formData, "active") === "true";

  const { error } = await ctx.supabase
    .from("discipline_technical_levels")
    .update({ active })
    .eq("id", disciplineLevelId)
    .eq("studio_id", ctx.studio.id)
    .eq("discipline_id", disciplineId);

  if (error) {
    redirect(`/admin/evaluaciones/disciplina/${disciplineId}?error=level`);
  }

  revalidatePath("/admin/evaluaciones");
  revalidatePath(`/admin/evaluaciones/disciplina/${disciplineId}`);
  redirect(`/admin/evaluaciones/disciplina/${disciplineId}`);
}

export async function createEvaluationTemplate(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);
  const disciplineLevelId = text(formData, "discipline_level_id");
  const disciplineId = text(formData, "discipline_id");
  const name = text(formData, "name");
  const errorTarget = disciplineId
    ? `/admin/evaluaciones/disciplina/${disciplineId}?error=template`
    : "/admin/evaluaciones?error=template";

  if (name.length < 2 || !disciplineLevelId) {
    redirect(errorTarget);
  }

  const { data: level } = await ctx.supabase
    .from("discipline_technical_levels")
    .select("id,discipline_id")
    .eq("id", disciplineLevelId)
    .eq("studio_id", ctx.studio.id)
    .eq("active", true)
    .maybeSingle();

  if (!level) redirect(errorTarget);

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
    redirect(errorTarget);
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
    redirect(errorTarget);
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
    redirect(errorTarget);
  }

  revalidatePath("/admin/evaluaciones");
  revalidatePath(`/admin/evaluaciones/disciplina/${level.discipline_id}`);
  redirect(`/admin/evaluaciones/plantillas/${template.id}?step=criterios`);
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

  if (error) {
    redirect(`/admin/evaluaciones/plantillas/${templateId}?step=reglas&error=settings`);
  }

  revalidatePath(`/admin/evaluaciones/plantillas/${templateId}`);
  redirect(`/admin/evaluaciones/plantillas/${templateId}?step=resumen`);
}

export async function updateEvaluationCriteria(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);
  const templateId = text(formData, "template_id");
  const versionId = text(formData, "version_id");

  const { data: criteria } = await ctx.supabase
    .from("evaluation_template_criteria")
    .select("id")
    .eq("studio_id", ctx.studio.id)
    .eq("template_version_id", versionId)
    .order("sort_order");

  if (!criteria?.length) {
    redirect(`/admin/evaluaciones/plantillas/${templateId}?step=criterios&error=criteria`);
  }

  const payload = criteria.map((criterion) => ({
    id: criterion.id,
    weight_percent: number(formData, `weight_${criterion.id}`),
    min_percent: number(formData, `min_${criterion.id}`, 70),
  }));
  const total = payload.reduce((sum, criterion) => sum + criterion.weight_percent, 0);

  if (Math.abs(total - 100) > 0.001) {
    redirect(`/admin/evaluaciones/plantillas/${templateId}?step=criterios&error=criteria_total`);
  }

  const { error } = await ctx.supabase.rpc("admin_update_evaluation_criteria", {
    p_template_version_id: versionId,
    p_criteria: payload,
  });

  if (error) {
    redirect(`/admin/evaluaciones/plantillas/${templateId}?step=criterios&error=criteria`);
  }

  revalidatePath(`/admin/evaluaciones/plantillas/${templateId}`);
  redirect(`/admin/evaluaciones/plantillas/${templateId}?step=figuras`);
}

export async function addEvaluationElement(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);
  const templateId = text(formData, "template_id");
  const versionId = text(formData, "version_id");
  const disciplineId = text(formData, "discipline_id");
  const criterionId = text(formData, "criterion_id");
  const name = text(formData, "name");
  const kind = text(formData, "kind") || "figure";
  const mandatory = formData.get("mandatory") === "on";
  const scored = formData.get("scored") !== "off";
  const maxScore = number(formData, "max_score", 10);
  const attempts = number(formData, "attempts", 3);

  if (!name || !criterionId) {
    redirect(`/admin/evaluaciones/plantillas/${templateId}?step=figuras&error=element`);
  }

  const { data: existing } = await ctx.supabase
    .from("technical_elements")
    .select("id")
    .eq("studio_id", ctx.studio.id)
    .eq("discipline_id", disciplineId)
    .ilike("name", name)
    .maybeSingle();

  let elementId = existing?.id ?? null;
  if (!elementId) {
    const { data: created, error } = await ctx.supabase
      .from("technical_elements")
      .insert({
        studio_id: ctx.studio.id,
        discipline_id: disciplineId,
        name,
        element_kind: kind,
      })
      .select("id")
      .single();

    if (error || !created) {
      redirect(`/admin/evaluaciones/plantillas/${templateId}?step=figuras&error=element`);
    }
    elementId = created.id;
  }

  const { count } = await ctx.supabase
    .from("evaluation_template_elements")
    .select("id", { count: "exact", head: true })
    .eq("template_version_id", versionId);

  const { error } = await ctx.supabase.from("evaluation_template_elements").insert({
    studio_id: ctx.studio.id,
    template_version_id: versionId,
    element_id: elementId,
    criterion_id: criterionId,
    mandatory,
    scored,
    max_score: maxScore,
    attempts_allowed: attempts,
    sort_order: (count ?? 0) + 1,
  });

  if (error) redirect(`/admin/evaluaciones/plantillas/${templateId}?step=figuras&error=element`);

  revalidatePath(`/admin/evaluaciones/plantillas/${templateId}`);
  redirect(`/admin/evaluaciones/plantillas/${templateId}?step=figuras`);
}

export async function addEvaluationCombo(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);
  const templateId = text(formData, "template_id");
  const versionId = text(formData, "version_id");
  const disciplineId = text(formData, "discipline_id");
  const criterionId = text(formData, "criterion_id") || null;
  const name = text(formData, "name");
  const mandatory = formData.get("mandatory") === "on";
  const scored = formData.get("scored") === "on";
  const maxScore = number(formData, "max_score", 10);
  const attempts = number(formData, "attempts", 3);

  if (!name) redirect(`/admin/evaluaciones/plantillas/${templateId}?step=combos&error=combo`);

  const { data: existing } = await ctx.supabase
    .from("technical_combos")
    .select("id")
    .eq("studio_id", ctx.studio.id)
    .eq("discipline_id", disciplineId)
    .ilike("name", name)
    .maybeSingle();

  let comboId = existing?.id ?? null;
  if (!comboId) {
    const { data: created, error } = await ctx.supabase
      .from("technical_combos")
      .insert({
        studio_id: ctx.studio.id,
        discipline_id: disciplineId,
        name,
      })
      .select("id")
      .single();

    if (error || !created) {
      redirect(`/admin/evaluaciones/plantillas/${templateId}?step=combos&error=combo`);
    }
    comboId = created.id;
  }

  const { count } = await ctx.supabase
    .from("evaluation_template_combos")
    .select("id", { count: "exact", head: true })
    .eq("template_version_id", versionId);

  const { error } = await ctx.supabase.from("evaluation_template_combos").insert({
    studio_id: ctx.studio.id,
    template_version_id: versionId,
    combo_id: comboId,
    criterion_id: criterionId,
    mandatory,
    scored,
    max_score: maxScore,
    attempts_allowed: attempts,
    sort_order: (count ?? 0) + 1,
  });

  if (error) redirect(`/admin/evaluaciones/plantillas/${templateId}?step=combos&error=combo`);

  revalidatePath(`/admin/evaluaciones/plantillas/${templateId}`);
  redirect(`/admin/evaluaciones/plantillas/${templateId}?step=combos`);
}

export async function activateEvaluationTemplateVersion(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);
  const templateId = text(formData, "template_id");
  const versionId = text(formData, "version_id");
  const disciplineId = text(formData, "discipline_id");

  const [{ data: criteria }, { count: elementCount }] = await Promise.all([
    ctx.supabase
      .from("evaluation_template_criteria")
      .select("weight_percent")
      .eq("studio_id", ctx.studio.id)
      .eq("template_version_id", versionId),
    ctx.supabase
      .from("evaluation_template_elements")
      .select("id", { count: "exact", head: true })
      .eq("studio_id", ctx.studio.id)
      .eq("template_version_id", versionId),
  ]);

  const total = (criteria ?? []).reduce((sum, item) => sum + Number(item.weight_percent ?? 0), 0);
  if (Math.abs(total - 100) > 0.001 || !elementCount) {
    redirect(`/admin/evaluaciones/plantillas/${templateId}?step=resumen&error=activate`);
  }

  const { data: version } = await ctx.supabase
    .from("evaluation_template_versions")
    .select("status")
    .eq("id", versionId)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  if (!version) {
    redirect(`/admin/evaluaciones/plantillas/${templateId}?step=resumen&error=activate`);
  }

  if (version.status === "draft") {
    const { error } = await ctx.supabase
      .from("evaluation_template_versions")
      .update({ status: "active", activated_at: new Date().toISOString() })
      .eq("id", versionId)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "draft");

    if (error) {
      redirect(`/admin/evaluaciones/plantillas/${templateId}?step=resumen&error=activate`);
    }
  }

  revalidatePath("/admin/evaluaciones");
  revalidatePath(`/admin/evaluaciones/plantillas/${templateId}`);
  if (disciplineId) {
    revalidatePath(`/admin/evaluaciones/disciplina/${disciplineId}`);
    redirect(`/admin/evaluaciones/disciplina/${disciplineId}`);
  }

  redirect("/admin/evaluaciones");
}

export async function createNextEvaluationTemplateVersion(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);
  const templateId = text(formData, "template_id");
  const sourceVersionId = text(formData, "version_id");

  const { data: source } = await ctx.supabase
    .from("evaluation_template_versions")
    .select(
      "version_number,pass_threshold,default_category_min,default_attempts_per_element,default_attempts_per_combo,evaluator_instructions",
    )
    .eq("id", sourceVersionId)
    .eq("studio_id", ctx.studio.id)
    .single();

  if (!source) redirect(`/admin/evaluaciones/plantillas/${templateId}?error=version`);

  const { data: created, error } = await ctx.supabase
    .from("evaluation_template_versions")
    .insert({
      studio_id: ctx.studio.id,
      template_id: templateId,
      version_number: source.version_number + 1,
      status: "draft",
      pass_threshold: source.pass_threshold,
      default_category_min: source.default_category_min,
      default_attempts_per_element: source.default_attempts_per_element,
      default_attempts_per_combo: source.default_attempts_per_combo,
      evaluator_instructions: source.evaluator_instructions,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (error || !created) {
    redirect(`/admin/evaluaciones/plantillas/${templateId}?error=version`);
  }

  const { data: sourceCriteria } = await ctx.supabase
    .from("evaluation_template_criteria")
    .select("id,criterion_key,label,description,weight_percent,min_percent,sort_order")
    .eq("template_version_id", sourceVersionId)
    .order("sort_order");

  const criterionIdMap = new Map<string, string>();
  for (const criterion of sourceCriteria ?? []) {
    const { data: copied } = await ctx.supabase
      .from("evaluation_template_criteria")
      .insert({
        studio_id: ctx.studio.id,
        template_version_id: created.id,
        criterion_key: criterion.criterion_key,
        label: criterion.label,
        description: criterion.description,
        weight_percent: criterion.weight_percent,
        min_percent: criterion.min_percent,
        sort_order: criterion.sort_order,
      })
      .select("id")
      .single();
    if (copied) criterionIdMap.set(criterion.id, copied.id);
  }

  const [{ data: sourceElements }, { data: sourceCombos }] = await Promise.all([
    ctx.supabase
      .from("evaluation_template_elements")
      .select(
        "element_id,criterion_id,mandatory,scored,max_score,min_score,attempts_allowed,sort_order,evaluator_instructions",
      )
      .eq("template_version_id", sourceVersionId)
      .order("sort_order"),
    ctx.supabase
      .from("evaluation_template_combos")
      .select(
        "combo_id,criterion_id,mandatory,scored,max_score,min_score,attempts_allowed,sort_order,evaluator_instructions",
      )
      .eq("template_version_id", sourceVersionId)
      .order("sort_order"),
  ]);

  if (sourceElements?.length) {
    await ctx.supabase.from("evaluation_template_elements").insert(
      sourceElements.map((item) => ({
        studio_id: ctx.studio.id,
        template_version_id: created.id,
        element_id: item.element_id,
        criterion_id: item.criterion_id ? criterionIdMap.get(item.criterion_id) : null,
        mandatory: item.mandatory,
        scored: item.scored,
        max_score: item.max_score,
        min_score: item.min_score,
        attempts_allowed: item.attempts_allowed,
        sort_order: item.sort_order,
        evaluator_instructions: item.evaluator_instructions,
      })),
    );
  }

  if (sourceCombos?.length) {
    await ctx.supabase.from("evaluation_template_combos").insert(
      sourceCombos.map((item) => ({
        studio_id: ctx.studio.id,
        template_version_id: created.id,
        combo_id: item.combo_id,
        criterion_id: item.criterion_id ? criterionIdMap.get(item.criterion_id) : null,
        mandatory: item.mandatory,
        scored: item.scored,
        max_score: item.max_score,
        min_score: item.min_score,
        attempts_allowed: item.attempts_allowed,
        sort_order: item.sort_order,
        evaluator_instructions: item.evaluator_instructions,
      })),
    );
  }

  revalidatePath(`/admin/evaluaciones/plantillas/${templateId}`);
  redirect(`/admin/evaluaciones/plantillas/${templateId}?step=criterios`);
}

export async function createTechnicalEvaluationAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_WRITE);
  const studentId = text(formData, "student_id");
  const templateVersionId = text(formData, "template_version_id");
  const evaluationDate = text(formData, "evaluation_date");

  const { data: version } = await ctx.supabase
    .from("evaluation_template_versions")
    .select("id,template_id,status")
    .eq("id", templateVersionId)
    .eq("studio_id", ctx.studio.id)
    .eq("status", "active")
    .maybeSingle();

  if (!version) redirect("/admin/evaluaciones/nueva?error=template");

  const { data: template } = await ctx.supabase
    .from("evaluation_templates")
    .select("discipline_id,discipline_technical_level_id")
    .eq("id", version.template_id)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  if (!template) redirect("/admin/evaluaciones/nueva?error=template");

  const [{ data: confirmedDiagnostic }, { data: currentLevel }] = await Promise.all([
    ctx.supabase
      .from("technical_evaluations")
      .select("id")
      .eq("studio_id", ctx.studio.id)
      .eq("student_id", studentId)
      .eq("discipline_id", template.discipline_id)
      .eq("status", "published")
      .in("evaluation_purpose", ["diagnostic", "placement"])
      .not("resulting_discipline_level_id", "is", null)
      .limit(1)
      .maybeSingle(),
    ctx.supabase
      .from("student_discipline_levels")
      .select("discipline_technical_level_id")
      .eq("studio_id", ctx.studio.id)
      .eq("student_id", studentId)
      .eq("discipline_id", template.discipline_id)
      .maybeSingle(),
  ]);

  if (!confirmedDiagnostic) {
    redirect(
      `/admin/alumnas/${studentId}?view=evaluations&evaluation_error=evaluation_initial_diagnostic_invitation_required`,
    );
  }

  if (
    !currentLevel ||
    currentLevel.discipline_technical_level_id !== template.discipline_technical_level_id
  ) {
    redirect(
      `/admin/alumnas/${studentId}?view=evaluations&evaluation_error=evaluation_level_mismatch`,
    );
  }

  const { data: evaluationId, error } = await ctx.supabase.rpc(
    "admin_create_technical_evaluation",
    {
      p_student_id: studentId,
      p_discipline_id: template.discipline_id,
      p_target_discipline_level_id: template.discipline_technical_level_id,
      p_template_version_id: version.id,
      p_evaluation_date: evaluationDate || null,
      p_evaluator_user_id: ctx.user.id,
    },
  );

  if (error || !evaluationId) redirect("/admin/evaluaciones/nueva?error=create");

  revalidatePath("/admin/evaluaciones");
  redirect(`/admin/evaluaciones/${evaluationId}`);
}

export async function saveTechnicalCriterionResultAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_WRITE);
  const evaluationId = text(formData, "evaluation_id");
  const templateCriterionId = text(formData, "template_criterion_id");
  const rawScore = text(formData, "score_percent");
  const notes = text(formData, "notes");

  if (!rawScore) return { ok: false, message: "Captura una puntuación." };

  const { error } = await ctx.supabase.rpc("admin_save_technical_criterion_result", {
    p_evaluation_id: evaluationId,
    p_template_criterion_id: templateCriterionId,
    p_score_percent: Number(rawScore),
    p_notes: notes || null,
  });

  if (error) return { ok: false, message: error.message };
  revalidatePath(`/admin/evaluaciones/${evaluationId}`);
  return { ok: true };
}

export async function saveTechnicalElementResultAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_WRITE);
  const evaluationId = text(formData, "evaluation_id");
  const templateElementId = text(formData, "template_element_id");
  const status = text(formData, "result_status") || "not_evaluated";
  const rawScore = text(formData, "score");
  const rawAttempts = text(formData, "attempt_count");
  const notes = text(formData, "notes");

  const { error } = await ctx.supabase.rpc("admin_save_technical_element_result", {
    p_evaluation_id: evaluationId,
    p_template_element_id: templateElementId,
    p_result_status: status,
    p_score: rawScore ? Number(rawScore) : null,
    p_attempt_count: rawAttempts ? Number(rawAttempts) : 0,
    p_notes: notes || null,
    p_quick_comments: [],
  });

  if (error) return { ok: false, message: error.message };
  revalidatePath(`/admin/evaluaciones/${evaluationId}`);
  return { ok: true };
}

export async function saveTechnicalComboResultAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_WRITE);
  const evaluationId = text(formData, "evaluation_id");
  const templateComboId = text(formData, "template_combo_id");
  const status = text(formData, "result_status") || "not_evaluated";
  const rawScore = text(formData, "score");
  const rawAttempts = text(formData, "attempt_count");
  const notes = text(formData, "notes");

  const { error } = await ctx.supabase.rpc("admin_save_technical_combo_result", {
    p_evaluation_id: evaluationId,
    p_template_combo_id: templateComboId,
    p_result_status: status,
    p_score: rawScore ? Number(rawScore) : null,
    p_attempt_count: rawAttempts ? Number(rawAttempts) : 0,
    p_notes: notes || null,
    p_quick_comments: [],
  });

  if (error) return { ok: false, message: error.message };
  revalidatePath(`/admin/evaluaciones/${evaluationId}`);
  return { ok: true };
}

export async function recalculateTechnicalEvaluationAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_WRITE);
  const evaluationId = text(formData, "evaluation_id");

  const { error } = await ctx.supabase.rpc("admin_recalculate_technical_evaluation", {
    p_evaluation_id: evaluationId,
  });

  if (error) redirect(`/admin/evaluaciones/${evaluationId}?error=calculate`);
  revalidatePath(`/admin/evaluaciones/${evaluationId}`);
  redirect(`/admin/evaluaciones/${evaluationId}?step=resumen`);
}

export async function openEvaluationFeedbackAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_WRITE);
  const evaluationId = text(formData, "evaluation_id");

  const { data, error } = await ctx.supabase.rpc("admin_recalculate_technical_evaluation", {
    p_evaluation_id: evaluationId,
  });

  if (error) redirect(`/admin/evaluaciones/${evaluationId}?step=resumen&error=calculate`);

  const recalculated = Array.isArray(data) ? data[0] : data;
  revalidatePath(`/admin/evaluaciones/${evaluationId}`);

  if (recalculated?.automatic_outcome === "incomplete") {
    redirect(`/admin/evaluaciones/${evaluationId}?step=resumen`);
  }

  const { data: evaluation } = await ctx.supabase
    .from("technical_evaluations")
    .select(
      "id,studio_id,discipline_id,target_discipline_level_id,evaluation_invitation_id,evaluation_purpose",
    )
    .eq("id", evaluationId)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  if (
    evaluation?.evaluation_purpose === "diagnostic" &&
    recalculated?.automatic_outcome === "approved"
  ) {
    const { data: targetLink } = await ctx.supabase
      .from("discipline_technical_levels")
      .select("discipline_order")
      .eq("id", evaluation.target_discipline_level_id)
      .eq("studio_id", ctx.studio.id)
      .maybeSingle();

    const { data: nextLevel } = targetLink
      ? await ctx.supabase
          .from("discipline_technical_levels")
          .select("id")
          .eq("studio_id", ctx.studio.id)
          .eq("discipline_id", evaluation.discipline_id)
          .eq("active", true)
          .gt("discipline_order", targetLink.discipline_order)
          .order("discipline_order")
          .limit(1)
          .maybeSingle()
      : { data: null };

    if (nextLevel) {
      const { error: publishError } = await ctx.supabase.rpc(
        "admin_publish_technical_evaluation",
        {
          p_evaluation_id: evaluationId,
          p_final_outcome: null,
          p_override_reason: null,
          p_strengths: [],
          p_improvement_areas: [],
          p_coach_message: null,
          p_next_objective: null,
        },
      );

      if (publishError) {
        redirect(`/admin/evaluaciones/${evaluationId}?step=resumen&error=publish`);
      }

      const { data: nextDiagnostic } = evaluation.evaluation_invitation_id
        ? await ctx.supabase
            .from("technical_evaluations")
            .select("id")
            .eq("evaluation_invitation_id", evaluation.evaluation_invitation_id)
            .eq("status", "draft")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : { data: null };

      if (nextDiagnostic?.id) {
        revalidatePath("/admin/evaluaciones");
        redirect(`/admin/evaluaciones/${nextDiagnostic.id}`);
      }
    }
  }

  redirect(`/admin/evaluaciones/${evaluationId}?step=feedback`);
}

function lines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function publishTechnicalEvaluationAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_WRITE);
  const evaluationId = text(formData, "evaluation_id");
  const strengths = lines(text(formData, "strengths"));
  const improvementAreas = lines(text(formData, "improvement_areas"));
  const coachMessage = text(formData, "coach_message");
  const nextObjective = text(formData, "next_objective");

  const { data, error } = await ctx.supabase.rpc("admin_publish_technical_evaluation", {
    p_evaluation_id: evaluationId,
    p_final_outcome: null,
    p_override_reason: null,
    p_strengths: strengths,
    p_improvement_areas: improvementAreas,
    p_coach_message: coachMessage || null,
    p_next_objective: nextObjective || null,
  });

  if (error?.message.includes("evaluation_incomplete")) {
    redirect(`/admin/evaluaciones/${evaluationId}?step=resumen`);
  }
  if (error) redirect(`/admin/evaluaciones/${evaluationId}?step=feedback&error=publish`);

  const published = Array.isArray(data) ? data[0] : data;
  let nextDiagnosticEvaluationId: string | null = null;

  if (
    published?.evaluation_purpose === "diagnostic" &&
    published?.evaluation_invitation_id
  ) {
    const { data: nextDiagnostic } = await ctx.supabase
      .from("technical_evaluations")
      .select("id")
      .eq("evaluation_invitation_id", published.evaluation_invitation_id)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    nextDiagnosticEvaluationId = nextDiagnostic?.id ?? null;
  }

  revalidatePath("/admin/evaluaciones");
  revalidatePath(`/admin/evaluaciones/${evaluationId}`);
  revalidatePath("/admin/alumnas");

  if (nextDiagnosticEvaluationId) {
    redirect(`/admin/evaluaciones/${nextDiagnosticEvaluationId}`);
  }

  redirect(`/admin/evaluaciones/${evaluationId}`);
}
