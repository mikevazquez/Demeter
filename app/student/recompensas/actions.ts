"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getStudentPortalContext } from "@/lib/student/portal";

export async function acknowledgeMedalsAccessAction() {
  const { supabase } = await getStudentPortalContext();
  const { error } = await supabase.rpc("student_acknowledge_medals_access");

  if (error) {
    redirect("/student/recompensas?error=medals_access_acknowledge");
  }

  revalidatePath("/student");
  revalidatePath("/student/recompensas");
  redirect("/student/recompensas");
}
