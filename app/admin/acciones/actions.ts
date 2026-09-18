"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

function requiredText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function returnPath(formData: FormData, actionId: string) {
  const fallback = `/admin/acciones/${actionId}`;
  const raw = requiredText(formData, "return_path");
  return raw === fallback ? raw : fallback;
}

function knownError(message: string | undefined) {
  const codes = [
    "required_action_not_found",
    "required_action_not_open",
    "required_action_assignee_required",
    "required_action_assignee_not_eligible",
    "required_action_discard_reason_required",
    "required_actions_manage_denied",
  ];

  return codes.find((code) => message?.includes(code)) ?? "required_action_update_failed";
}

function finish(path: string, key: "updated" | "error", value: string): never {
  revalidatePath("/admin");
  revalidatePath("/admin/acciones");
  revalidatePath(path);
  redirect(`${path}?${key}=${encodeURIComponent(value)}`);
}

export async function assignRequiredAction(formData: FormData) {
  const actionId = requiredText(formData, "action_id");
  const assigneeUserId = requiredText(formData, "assignee_user_id");
  const path = returnPath(formData, actionId);

  if (!actionId || !assigneeUserId) finish(path, "error", "required_action_assignee_required");

  const { supabase } = await getAdminContext(CAPABILITIES.REQUIRED_ACTIONS_MANAGE);
  const { error } = await supabase.rpc("admin_assign_required_action", {
    p_action_id: actionId,
    p_assignee_user_id: assigneeUserId,
  });

  if (error) finish(path, "error", knownError(error.message));
  finish(path, "updated", "assigned");
}

export async function takeRequiredAction(formData: FormData) {
  const actionId = requiredText(formData, "action_id");
  const path = returnPath(formData, actionId);

  if (!actionId) finish(path, "error", "required_action_not_found");

  const { supabase } = await getAdminContext(CAPABILITIES.REQUIRED_ACTIONS_MANAGE);
  const { error } = await supabase.rpc("admin_take_required_action", {
    p_action_id: actionId,
  });

  if (error) finish(path, "error", knownError(error.message));
  finish(path, "updated", "taken");
}

export async function resolveRequiredAction(formData: FormData) {
  const actionId = requiredText(formData, "action_id");
  const result = requiredText(formData, "result");
  const path = returnPath(formData, actionId);

  if (!actionId) finish(path, "error", "required_action_not_found");

  const { supabase } = await getAdminContext(CAPABILITIES.REQUIRED_ACTIONS_MANAGE);
  const { error } = await supabase.rpc("admin_resolve_required_action", {
    p_action_id: actionId,
    p_result: result || null,
  });

  if (error) finish(path, "error", knownError(error.message));
  finish(path, "updated", "resolved");
}

export async function discardRequiredAction(formData: FormData) {
  const actionId = requiredText(formData, "action_id");
  const reason = requiredText(formData, "reason");
  const path = returnPath(formData, actionId);

  if (!actionId) finish(path, "error", "required_action_not_found");
  if (!reason) finish(path, "error", "required_action_discard_reason_required");

  const { supabase } = await getAdminContext(CAPABILITIES.REQUIRED_ACTIONS_MANAGE);
  const { error } = await supabase.rpc("admin_discard_required_action", {
    p_action_id: actionId,
    p_reason: reason,
  });

  if (error) finish(path, "error", knownError(error.message));
  finish(path, "updated", "discarded");
}
