import type { SupabaseClient } from "@supabase/supabase-js";

export type TrialEnrollmentCredit = {
  payment_id: string;
  source_sale_id: string;
  reservation_id: string;
  amount_minor: number;
  /** NEB-01-36 · inscripción mínima configurada por el estudio para aplicar el abono. */
  min_enrollment_minor?: number;
  currency: string;
  class_on: string;
};

export async function loadTrialEnrollmentCredits(supabase: SupabaseClient, studentId: string) {
  const { data, error } = await supabase.rpc("get_trial_enrollment_credit_options", {
    target_student_id: studentId,
  });
  if (error || !Array.isArray(data)) {
    return { options: [] as TrialEnrollmentCredit[], unavailable: true };
  }
  return { options: data as TrialEnrollmentCredit[], unavailable: false };
}
