"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { POLE_STUDENT_LEVELS, type PoleStudentLevel } from "@/lib/pole/level-settings";

const PATH = "/admin/catalogo/obligatorias";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function done(params: Record<string, string>): never {
  revalidatePath(PATH);
  redirect(`${PATH}?${new URLSearchParams(params).toString()}`);
}

function levelKey(value: string): PoleStudentLevel | null {
  return (POLE_STUDENT_LEVELS as readonly string[]).includes(value)
    ? (value as PoleStudentLevel)
    : null;
}

function errorCode(message: string | undefined) {
  const known = [
    "pole_mandatory_limit",
    "pole_mandatory_level_mismatch",
    "pole_minimum_invalid",
    "forbidden",
  ];
  return known.find((code) => message?.includes(code)) ?? "save_failed";
}

export async function proposePoleMandatoryAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);
  const disciplineId = text(formData, "discipline_id");
  const { error } = await ctx.supabase.rpc("staff_propose_pole_mandatory_figures", {
    p_studio: ctx.studio.id,
    p_discipline: disciplineId,
  });
  if (error) done({ error: errorCode(error.message) });
  done({ saved: "proposed" });
}

export async function setPoleMandatoryAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);
  const level = levelKey(text(formData, "level_key"));
  const state = text(formData, "state");
  if (!level || !["approved", "proposed", "removed"].includes(state)) done({ error: "invalid" });

  const { error } = await ctx.supabase.rpc("staff_set_pole_mandatory_figure", {
    p_studio: ctx.studio.id,
    p_discipline: text(formData, "discipline_id"),
    p_level_key: level,
    p_figure: text(formData, "figure_id"),
    p_state: state,
  });
  if (error) done({ error: errorCode(error.message), level: level ?? "" });
  done({ saved: state, level: level ?? "" });
}

export async function approvePoleLevelAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);
  const level = levelKey(text(formData, "level_key"));
  const disciplineId = text(formData, "discipline_id");
  if (!level) done({ error: "invalid" });

  const { data: pending } = await ctx.supabase
    .from("pole_level_mandatory_figures")
    .select("figure_element_id")
    .eq("studio_id", ctx.studio.id)
    .eq("discipline_id", disciplineId)
    .eq("level_key", level!)
    .eq("status", "proposed");

  for (const row of pending ?? []) {
    const { error } = await ctx.supabase.rpc("staff_set_pole_mandatory_figure", {
      p_studio: ctx.studio.id,
      p_discipline: disciplineId,
      p_level_key: level,
      p_figure: row.figure_element_id,
      p_state: "approved",
    });
    if (error) done({ error: errorCode(error.message), level: level ?? "" });
  }
  done({ saved: "approved_level", level: level ?? "" });
}

export async function setPoleMinimumAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);
  const level = levelKey(text(formData, "level_key"));
  const minimum = Number(text(formData, "minimum").replace(",", "."));
  if (!level || level === "elite" || !Number.isFinite(minimum) || minimum <= 0 || minimum > 100) {
    done({ error: "pole_minimum_invalid", level: level ?? "" });
  }

  const { error } = await ctx.supabase.rpc("staff_set_pole_level_minimum", {
    p_studio: ctx.studio.id,
    p_discipline: text(formData, "discipline_id"),
    p_level_key: level,
    p_minimum: minimum,
  });
  if (error) done({ error: errorCode(error.message), level: level ?? "" });
  done({ saved: "minimum", level: level ?? "" });
}

export async function generatePoleTemplatesAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);
  const { data, error } = await ctx.supabase.rpc("staff_generate_pole_evaluation_templates", {
    p_studio: ctx.studio.id,
    p_discipline: text(formData, "discipline_id"),
  });
  if (error) done({ error: errorCode(error.message) });

  const results = Object.values((data ?? {}) as Record<string, { status?: string }>);
  const generated = results.filter((result) => result.status === "generated").length;
  done({ saved: "generated", count: String(generated) });
}
