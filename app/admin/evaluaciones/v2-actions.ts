"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function numeric(formData: FormData, key: string, fallback = 0) {
  const value = Number(text(formData, key).replace(",", "."));
  return Number.isFinite(value) ? value : fallback;
}

function editorUrl(
  templateId: string,
  step = "apartados",
  blockId?: string,
  error?: string,
  view?: string,
) {
  const params = new URLSearchParams({ step });
  if (blockId) params.set("block", blockId);
  if (view) params.set("view", view);
  if (error) params.set("error", error);
  return `/admin/evaluaciones/v2/${templateId}?${params.toString()}`;
}

async function assertDraftVersion(
  templateId: string,
  versionId: string,
  capability = CAPABILITIES.EVALUATIONS_CONFIGURE,
) {
  const ctx = await getAdminContext(capability);
  const { data: version } = await ctx.supabase
    .from("evaluation_template_versions")
    .select("id,template_id,status,schema_version")
    .eq("id", versionId)
    .eq("template_id", templateId)
    .eq("studio_id", ctx.studio.id)
    .eq("status", "draft")
    .eq("schema_version", 2)
    .maybeSingle();

  if (!version) redirect(editorUrl(templateId, "apartados", undefined, "locked"));
  return ctx;
}

export async function createEvaluationV2TemplateAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);
  const disciplineId = text(formData, "discipline_id");
  const disciplineLevelId = text(formData, "discipline_level_id");
  const name = text(formData, "name") || "Evaluación técnica";

  const { data: level } = await ctx.supabase
    .from("discipline_technical_levels")
    .select("id,discipline_id")
    .eq("id", disciplineLevelId)
    .eq("discipline_id", disciplineId)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  if (!level) redirect(`/admin/evaluaciones/disciplina/${disciplineId}?error=template`);

  const { data: template, error: templateError } = await ctx.supabase
    .from("evaluation_templates")
    .insert({
      studio_id: ctx.studio.id,
      discipline_id: disciplineId,
      discipline_technical_level_id: disciplineLevelId,
      name,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (templateError || !template) {
    redirect(`/admin/evaluaciones/disciplina/${disciplineId}?error=template`);
  }

  const { error: versionError } = await ctx.supabase.from("evaluation_template_versions").insert({
    studio_id: ctx.studio.id,
    template_id: template.id,
    version_number: 1,
    status: "draft",
    schema_version: 2,
    pass_threshold: 75,
    default_category_min: 0,
    default_attempts_per_element: 3,
    default_attempts_per_combo: 3,
    created_by: ctx.user.id,
  });

  if (versionError) {
    redirect(`/admin/evaluaciones/disciplina/${disciplineId}?error=template`);
  }

  revalidatePath("/admin/evaluaciones");
  revalidatePath(`/admin/evaluaciones/disciplina/${disciplineId}`);
  redirect(editorUrl(template.id, "apartados"));
}

export async function openEvaluationV2EditorAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);
  const templateId = text(formData, "template_id");
  const sourceVersionId = text(formData, "version_id");

  const { data: source } = await ctx.supabase
    .from("evaluation_template_versions")
    .select(
      "id,template_id,version_number,status,schema_version,pass_threshold,default_category_min,default_attempts_per_element,default_attempts_per_combo,evaluator_instructions",
    )
    .eq("id", sourceVersionId)
    .eq("template_id", templateId)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  if (!source) redirect(editorUrl(templateId, "apartados", undefined, "version"));

  const { count: usedCount } = await ctx.supabase
    .from("technical_evaluations")
    .select("id", { count: "exact", head: true })
    .eq("template_version_id", source.id);

  if (source.schema_version === 2 && source.status === "draft" && !usedCount) {
    redirect(editorUrl(templateId, "apartados"));
  }

  const { data: latest } = await ctx.supabase
    .from("evaluation_template_versions")
    .select("version_number")
    .eq("template_id", templateId)
    .eq("studio_id", ctx.studio.id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: created, error: createError } = await ctx.supabase
    .from("evaluation_template_versions")
    .insert({
      studio_id: ctx.studio.id,
      template_id: templateId,
      version_number: (latest?.version_number ?? source.version_number) + 1,
      status: "draft",
      schema_version: 2,
      pass_threshold: source.pass_threshold,
      default_category_min: source.default_category_min,
      default_attempts_per_element: source.default_attempts_per_element,
      default_attempts_per_combo: source.default_attempts_per_combo,
      evaluator_instructions: source.evaluator_instructions,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (createError || !created)
    redirect(editorUrl(templateId, "apartados", undefined, "version"));

  if (source.schema_version === 2) {
    const { data: sourceBlocks } = await ctx.supabase
      .from("evaluation_template_criteria")
      .select(
        "id,criterion_key,label,description,weight_percent,min_percent,sort_order,block_type,progression_required,evaluator_instructions",
      )
      .eq("template_version_id", source.id)
      .order("sort_order");

    const blockMap = new Map<string, string>();
    for (const block of sourceBlocks ?? []) {
      const { data: copied } = await ctx.supabase
        .from("evaluation_template_criteria")
        .insert({
          studio_id: ctx.studio.id,
          template_version_id: created.id,
          criterion_key: block.criterion_key,
          label: block.label,
          description: block.description,
          weight_percent: block.weight_percent,
          min_percent: block.min_percent,
          sort_order: block.sort_order,
          block_type: block.block_type ?? "direct_score",
          progression_required: block.progression_required ?? false,
          evaluator_instructions: block.evaluator_instructions,
        })
        .select("id")
        .single();
      if (copied) blockMap.set(block.id, copied.id);
    }

    const { data: sourceItems } = await ctx.supabase
      .from("evaluation_template_elements")
      .select(
        "element_id,criterion_id,mandatory,scored,max_score,min_score,attempts_allowed,sort_order,evaluator_instructions,element_snapshot,item_label,item_description,item_kind,item_weight_percent,progression_required",
      )
      .eq("template_version_id", source.id)
      .order("sort_order");

    if (sourceItems?.length) {
      await ctx.supabase.from("evaluation_template_elements").insert(
        sourceItems
          .filter((item) => item.criterion_id && blockMap.has(item.criterion_id))
          .map((item) => ({
            studio_id: ctx.studio.id,
            template_version_id: created.id,
            element_id: item.element_id,
            criterion_id: blockMap.get(item.criterion_id!),
            mandatory: item.mandatory,
            scored: item.scored,
            max_score: item.max_score,
            min_score: item.min_score,
            attempts_allowed: item.attempts_allowed,
            sort_order: item.sort_order,
            evaluator_instructions: item.evaluator_instructions,
            element_snapshot: item.element_snapshot,
            item_label: item.item_label,
            item_description: item.item_description,
            item_kind: item.item_kind ?? "element",
            item_weight_percent: item.item_weight_percent,
            progression_required: Boolean(item.progression_required || item.mandatory),
          })),
      );
    }
  }

  revalidatePath(editorUrl(templateId));
  redirect(editorUrl(templateId));
}

export async function saveEvaluationV2GeneralAction(formData: FormData) {
  const templateId = text(formData, "template_id");
  const versionId = text(formData, "version_id");
  const ctx = await assertDraftVersion(templateId, versionId);
  const name = text(formData, "name");
  const passThreshold = numeric(formData, "pass_threshold", 75);
  const instructions = text(formData, "instructions");
  const returnStep = text(formData, "return_step") || "reglas";

  if (!name || passThreshold < 0 || passThreshold > 100) {
    redirect(editorUrl(templateId, returnStep, undefined, "general"));
  }

  const [{ error: templateError }, { error: versionError }] = await Promise.all([
    ctx.supabase
      .from("evaluation_templates")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", templateId)
      .eq("studio_id", ctx.studio.id),
    ctx.supabase
      .from("evaluation_template_versions")
      .update({
        pass_threshold: passThreshold,
        evaluator_instructions: instructions || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", versionId)
      .eq("studio_id", ctx.studio.id),
  ]);

  if (templateError || versionError)
    redirect(editorUrl(templateId, returnStep, undefined, "general"));
  revalidatePath(editorUrl(templateId));
  redirect(editorUrl(templateId, returnStep));
}

export async function addEvaluationV2BlockAction(formData: FormData) {
  const templateId = text(formData, "template_id");
  const versionId = text(formData, "version_id");
  const ctx = await assertDraftVersion(templateId, versionId);

  const { data: lastBlock } = await ctx.supabase
    .from("evaluation_template_criteria")
    .select("sort_order")
    .eq("template_version_id", versionId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const key = `block_${crypto.randomUUID().replaceAll("-", "")}`;
  const { data, error } = await ctx.supabase
    .from("evaluation_template_criteria")
    .insert({
      studio_id: ctx.studio.id,
      template_version_id: versionId,
      criterion_key: key,
      label: "Nuevo apartado",
      description: null,
      weight_percent: 0,
      min_percent: null,
      sort_order: (lastBlock?.sort_order ?? 0) + 1,
      block_type: "direct_score",
      progression_required: false,
    })
    .select("id")
    .single();

  if (error || !data) redirect(editorUrl(templateId, "apartados", undefined, "block"));
  revalidatePath(editorUrl(templateId));
  redirect(editorUrl(templateId, "apartados", data.id, undefined, "config"));
}

export async function updateEvaluationV2BlockAction(formData: FormData) {
  const templateId = text(formData, "template_id");
  const versionId = text(formData, "version_id");
  const blockId = text(formData, "block_id");
  const ctx = await assertDraftVersion(templateId, versionId);
  const label = text(formData, "label");
  const description = text(formData, "description");
  const blockType = text(formData, "block_type");
  const weight = numeric(formData, "weight_percent");
  const rawMin = text(formData, "min_percent");
  const minPercent = rawMin === "" ? null : numeric(formData, "min_percent");
  const progressionRequired = formData.get("progression_required") === "on";
  const instructions = text(formData, "evaluator_instructions");
  const returnView = text(formData, "return_view") || "content";

  const allowed = new Set([
    "direct_score",
    "weighted_criteria",
    "element_list",
    "correct_incorrect",
    "meets",
  ]);

  if (!label || !allowed.has(blockType) || weight < 0 || weight > 100) {
    redirect(editorUrl(templateId, "apartados", blockId, "block", returnView));
  }

  const { error } = await ctx.supabase
    .from("evaluation_template_criteria")
    .update({
      label,
      description: description || null,
      block_type: blockType,
      weight_percent: weight,
      min_percent: minPercent,
      progression_required: progressionRequired,
      evaluator_instructions: instructions || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", blockId)
    .eq("template_version_id", versionId)
    .eq("studio_id", ctx.studio.id);

  if (error) redirect(editorUrl(templateId, "apartados", blockId, "block", returnView));
  revalidatePath(editorUrl(templateId));
  redirect(editorUrl(templateId, "apartados", blockId, undefined, returnView));
}

export async function deleteEvaluationV2BlockAction(formData: FormData) {
  const templateId = text(formData, "template_id");
  const versionId = text(formData, "version_id");
  const blockId = text(formData, "block_id");
  const ctx = await assertDraftVersion(templateId, versionId);

  await ctx.supabase
    .from("evaluation_template_elements")
    .delete()
    .eq("template_version_id", versionId)
    .eq("criterion_id", blockId)
    .eq("studio_id", ctx.studio.id);

  const { error } = await ctx.supabase
    .from("evaluation_template_criteria")
    .delete()
    .eq("id", blockId)
    .eq("template_version_id", versionId)
    .eq("studio_id", ctx.studio.id);

  if (error) redirect(editorUrl(templateId, "apartados", undefined, "block"));
  revalidatePath(editorUrl(templateId));
  redirect(editorUrl(templateId, "apartados"));
}

export async function addEvaluationV2ItemAction(formData: FormData) {
  const templateId = text(formData, "template_id");
  const versionId = text(formData, "version_id");
  const blockId = text(formData, "block_id");
  const disciplineId = text(formData, "discipline_id");
  const ctx = await assertDraftVersion(templateId, versionId);
  const label = text(formData, "label");
  const description = text(formData, "description");
  const rawWeight = text(formData, "item_weight_percent");
  const itemWeight = rawWeight === "" ? null : numeric(formData, "item_weight_percent");
  const progressionRequired = formData.get("progression_required") === "on";
  const scored = formData.get("scored") === "on";
  const maxScore = scored ? numeric(formData, "max_score", 100) : 100;
  const rawMin = text(formData, "min_score");
  const minScore = rawMin === "" ? null : numeric(formData, "min_score");
  const attempts = Math.max(1, numeric(formData, "attempts_allowed", 3));

  if (!label) redirect(editorUrl(templateId, "apartados", blockId, "item", "content"));

  const { data: block } = await ctx.supabase
    .from("evaluation_template_criteria")
    .select("block_type")
    .eq("id", blockId)
    .eq("template_version_id", versionId)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  if (!block || block.block_type === "direct_score") {
    redirect(editorUrl(templateId, "apartados", blockId, "item", "content"));
  }

  const elementKind =
    block.block_type === "correct_incorrect"
      ? "theory"
      : block.block_type === "weighted_criteria"
        ? "skill"
        : "figure";

  const { data: existing } = await ctx.supabase
    .from("technical_elements")
    .select("id")
    .eq("studio_id", ctx.studio.id)
    .eq("discipline_id", disciplineId)
    .eq("element_kind", elementKind)
    .ilike("name", label)
    .limit(1)
    .maybeSingle();

  let elementId = existing?.id ?? null;
  if (!elementId) {
    const { data: created, error: createError } = await ctx.supabase
      .from("technical_elements")
      .insert({
        studio_id: ctx.studio.id,
        discipline_id: disciplineId,
        name: label,
        element_kind: elementKind,
      })
      .select("id")
      .single();
    if (createError || !created) redirect(editorUrl(templateId, "apartados", blockId, "item", "content"));
    elementId = created.id;
  }

  const { data: lastItem } = await ctx.supabase
    .from("evaluation_template_elements")
    .select("sort_order")
    .eq("template_version_id", versionId)
    .eq("criterion_id", blockId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const shouldScore = block.block_type === "weighted_criteria" ? true : scored;
  const { error } = await ctx.supabase.from("evaluation_template_elements").insert({
    studio_id: ctx.studio.id,
    template_version_id: versionId,
    element_id: elementId,
    criterion_id: blockId,
    mandatory: progressionRequired,
    progression_required: progressionRequired,
    scored: shouldScore,
    max_score: shouldScore ? maxScore : 100,
    min_score: shouldScore ? minScore : null,
    attempts_allowed: attempts,
    sort_order: (lastItem?.sort_order ?? 0) + 1,
    item_label: label,
    item_description: description || null,
    item_kind:
      block.block_type === "weighted_criteria"
        ? "criterion"
        : block.block_type === "correct_incorrect"
          ? "question"
          : "element",
    item_weight_percent: itemWeight,
    element_snapshot: { name: label, description: description || null },
  });

  if (error) redirect(editorUrl(templateId, "apartados", blockId, "item", "content"));
  revalidatePath(editorUrl(templateId));
  redirect(editorUrl(templateId, "apartados", blockId, undefined, "content"));
}

export async function updateEvaluationV2ItemAction(formData: FormData) {
  const templateId = text(formData, "template_id");
  const versionId = text(formData, "version_id");
  const blockId = text(formData, "block_id");
  const itemId = text(formData, "item_id");
  const ctx = await assertDraftVersion(templateId, versionId);
  const label = text(formData, "label");
  const rawWeight = text(formData, "item_weight_percent");
  const itemWeight = rawWeight === "" ? null : numeric(formData, "item_weight_percent");
  const progressionRequired = formData.get("progression_required") === "on";
  const rawMin = text(formData, "min_score");
  const minScore = rawMin === "" ? null : numeric(formData, "min_score");

  const { error } = await ctx.supabase
    .from("evaluation_template_elements")
    .update({
      item_label: label,
      item_weight_percent: itemWeight,
      progression_required: progressionRequired,
      mandatory: progressionRequired,
      min_score: minScore,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("criterion_id", blockId)
    .eq("template_version_id", versionId)
    .eq("studio_id", ctx.studio.id);

  if (error) redirect(editorUrl(templateId, "apartados", blockId, "item", "content"));
  revalidatePath(editorUrl(templateId));
  redirect(editorUrl(templateId, "apartados", blockId, undefined, "content"));
}

export async function deleteEvaluationV2ItemAction(formData: FormData) {
  const templateId = text(formData, "template_id");
  const versionId = text(formData, "version_id");
  const blockId = text(formData, "block_id");
  const itemId = text(formData, "item_id");
  const ctx = await assertDraftVersion(templateId, versionId);

  const { error } = await ctx.supabase
    .from("evaluation_template_elements")
    .delete()
    .eq("id", itemId)
    .eq("template_version_id", versionId)
    .eq("studio_id", ctx.studio.id);

  if (error) redirect(editorUrl(templateId, "apartados", blockId, "item", "content"));
  revalidatePath(editorUrl(templateId));
  redirect(editorUrl(templateId, "apartados", blockId, undefined, "content"));
}

export async function distributeEvaluationV2ItemWeightsAction(formData: FormData) {
  const templateId = text(formData, "template_id");
  const versionId = text(formData, "version_id");
  const blockId = text(formData, "block_id");
  const ctx = await assertDraftVersion(templateId, versionId);

  const { data: items } = await ctx.supabase
    .from("evaluation_template_elements")
    .select("id,sort_order")
    .eq("template_version_id", versionId)
    .eq("criterion_id", blockId)
    .order("sort_order");

  if (!items?.length) redirect(editorUrl(templateId, "apartados", blockId, "item", "content"));

  const base = Math.floor(10000 / items.length) / 100;
  let assigned = 0;
  for (let index = 0; index < items.length; index += 1) {
    const weight = index === items.length - 1 ? Number((100 - assigned).toFixed(2)) : base;
    assigned = Number((assigned + weight).toFixed(2));
    await ctx.supabase
      .from("evaluation_template_elements")
      .update({ item_weight_percent: weight })
      .eq("id", items[index].id)
      .eq("studio_id", ctx.studio.id);
  }

  revalidatePath(editorUrl(templateId));
  redirect(editorUrl(templateId, "apartados", blockId, undefined, "content"));
}

export async function activateEvaluationV2Action(formData: FormData) {
  const templateId = text(formData, "template_id");
  const versionId = text(formData, "version_id");
  const disciplineId = text(formData, "discipline_id");
  const ctx = await assertDraftVersion(templateId, versionId);

  const { error } = await ctx.supabase.rpc("admin_activate_evaluation_template_version_v2", {
    p_template_version_id: versionId,
  });

  if (error) {
    redirect(
      editorUrl(
        templateId,
        "preview",
        undefined,
        error.message.includes("weight")
          ? "weights"
          : error.message.includes("progression_min")
            ? "progression"
            : "activate",
      ),
    );
  }

  revalidatePath("/admin/evaluaciones");
  revalidatePath(`/admin/evaluaciones/disciplina/${disciplineId}`);
  redirect(`/admin/evaluaciones/disciplina/${disciplineId}`);
}
