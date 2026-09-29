"use server";

import { redirect } from "next/navigation";

import { normalizeMexicanPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

const DEMETER_STUDIO_SLUG = "demeter-fitness";

export async function resolveStudentAccess(formData: FormData) {
  const phone = normalizeMexicanPhone(String(formData.get("phone") ?? ""));

  if (!phone) {
    redirect("/acceso?state=invalid");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke("student-access-entry", {
    body: {
      phone,
      studioSlug: DEMETER_STUDIO_SLUG,
    },
  });

  if (error) {
    console.error("[access.resolveStudentAccess] lookup failed", {
      message: error.message.slice(0, 160),
    });
    redirect("/acceso?state=error");
  }

  const status = String(data?.status ?? "");

  if (status === "login") {
    redirect("/login/student");
  }

  if (status === "pending") {
    redirect("/acceso?state=pending");
  }

  redirect("/acceso?state=not_found");
}
