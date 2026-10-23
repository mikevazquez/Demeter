"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function done(studentId: string, state: string): never {
  revalidatePath(`/admin/alumnas/${studentId}`);
  revalidatePath("/student/reservar");
  redirect(`/admin/alumnas/${studentId}?penalizacion=${state}#penalizaciones`);
}

// NEB-01-41 · Recepción quita una pausa de reservas (queda quién y por qué).
export async function waiveStudentPenaltyAction(formData: FormData) {
  const studentId = String(formData.get("student_id") ?? "");
  const penaltyId = String(formData.get("penalty_id") ?? "");
  if (!UUID.test(studentId) || !UUID.test(penaltyId)) redirect("/admin/alumnas");
  const { supabase } = await getAdminContext(CAPABILITIES.STUDENTS_WRITE);
  const { error } = await supabase.rpc("admin_waive_student_booking_penalty", {
    p_penalty_id: penaltyId,
    p_note: String(formData.get("note") ?? "").slice(0, 300) || null,
  });
  done(studentId, error ? "error" : "pausa_quitada");
}

// NEB-01-41 · Marca un cargo por falta o cancelación tardía como pagado o condonado.
export async function resolveStudentChargeAction(formData: FormData) {
  const studentId = String(formData.get("student_id") ?? "");
  const chargeId = String(formData.get("charge_id") ?? "");
  const resolution = String(formData.get("resolution") ?? "");
  if (!UUID.test(studentId) || !UUID.test(chargeId) || !["paid", "waived"].includes(resolution)) {
    redirect("/admin/alumnas");
  }
  const { supabase } = await getAdminContext(CAPABILITIES.SALES_WRITE);
  const { error } = await supabase.rpc("admin_resolve_student_operating_charge", {
    p_charge_id: chargeId,
    p_resolution: resolution,
    p_note: resolution === "paid" ? "Pagado en recepción" : "Condonado por el estudio",
  });
  done(studentId, error ? "error" : resolution === "paid" ? "cargo_pagado" : "cargo_condonado");
}
