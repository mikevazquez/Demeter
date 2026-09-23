"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getStudentPortalContext } from "@/lib/student/portal";

export async function acknowledgeBronzeUnlockAction() {
  const { supabase } = await getStudentPortalContext();
  const { error } = await supabase.rpc("student_acknowledge_bronze_unlock");

  if (error) {
    redirect("/student/recompensas?error=bronze_acknowledge");
  }

  revalidatePath("/student");
  revalidatePath("/student/recompensas");
  redirect("/student/recompensas");
}
