"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminContext } from "@/lib/auth/admin-context";
import { programError, type ProgramDraft } from "@/lib/programs/draft";
function friendlyProgramError(message: string) {
  const errors: [string, string][] = [
    [
      "program_session_unavailable",
      "Una de las fechas está llena, cancelada o ya pasó. No se registró la compra.",
    ],
    ["enrollment_required", "La alumna necesita una inscripción vigente antes de reservar."],
    ["already_reserved", "La alumna ya tiene una reserva en una de las fechas elegidas."],
    ["forbidden", "Tu cuenta no tiene permiso para esta operación."],
    ["conflict", "Un coach o espacio ya está ocupado en uno de estos horarios."],
    ["invalid_space", "Revisa el espacio y su capacidad en cada fecha."],
    ["invalid_discipline", "Elige una disciplina activa en cada fecha."],
    ["past_program_date", "Todas las fechas deben estar en el futuro."],
    ["duplicate_program_date", "Hay fechas con el mismo horario. Corrige el programa."],
    [
      "product_templates_studio_id_name_key",
      "Ya existe un programa con ese nombre. Usa un nombre que identifique esta edición.",
    ],
    ["document", "La alumna debe completar los documentos requeridos antes de reservar."],
  ];
  return (
    errors.find(([code]) => message.includes(code))?.[1] ??
    "No pudimos completar la operación. Revisa los datos e intenta nuevamente."
  );
}
export async function createProgram(
  _state: { error: string | null },
  data: FormData,
): Promise<{ error: string | null }> {
  const ctx = await getAdminContext("schedule.write");
  let program: ProgramDraft;
  try {
    program = JSON.parse(String(data.get("payload"))) as ProgramDraft;
  } catch {
    return { error: "Revisa los datos del programa." };
  }
  const validation = programError(program);
  if (validation) return { error: validation };
  const { data: id, error } = await ctx.supabase.rpc("admin_create_activity_program", {
    p_studio_id: ctx.studio.id,
    p_program: program,
  });
  if (error) return { error: friendlyProgramError(error.message) };
  revalidatePath("/admin/actividades");
  revalidatePath("/admin/agenda");
  revalidatePath("/admin/productos");
  redirect(`/admin/actividades/programas/${id}`);
}
export async function enrollProgram(
  _state: { error: string | null },
  data: FormData,
): Promise<{ error: string | null }> {
  const ctx = await getAdminContext("sales.write");
  if (data.get("payment_verified") !== "on") return { error: "Confirma que ya recibiste el pago." };
  const programId = String(data.get("program_id") ?? "");
  const { error } = await ctx.supabase.rpc("admin_enroll_activity_program", {
    p_program_id: programId,
    p_student_id: String(data.get("student_id") ?? ""),
    p_session_id: String(data.get("session_id") ?? "") || null,
    p_payment_method: String(data.get("payment_method") ?? ""),
    p_reference: String(data.get("reference") ?? "") || null,
    p_request_id: String(data.get("request_id") ?? ""),
  });
  if (error) return { error: friendlyProgramError(error.message) };
  revalidatePath("/admin/agenda");
  revalidatePath("/admin/alumnas");
  revalidatePath("/student");
  revalidatePath(`/admin/actividades/programas/${programId}`);
  redirect(`/admin/actividades/programas/${programId}?enrolled=1`);
}
