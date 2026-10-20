import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { birthdayParts, isBirthdayStudent, type BirthdayStudent } from "./birthdays";

type BirthdayRow = {
  id: string;
  full_name: string;
  active: boolean;
  lifecycle_status: string;
  student_type: string;
  trial_status: string | null;
  person: { profile_field_values: { value: unknown }[] } | null;
  student_enrollments: { status: string; starts_on: string; expires_on: string | null }[];
  product_acquisitions: {
    status: string;
    starts_on: string | null;
    expires_on: string | null;
    refunded_at: string | null;
    created_at: string;
    product_templates: { name: string; product_type: string } | null;
  }[];
};

// Use the authenticated admin client. No service role or public birthday endpoint.
export async function loadBirthdayStudents(
  supabase: SupabaseClient,
  studioId: string,
  today: string,
): Promise<BirthdayStudent[]> {
  const definition = await supabase
    .from("profile_field_definitions")
    .select("id")
    .eq("studio_id", studioId)
    .eq("entity_type", "student")
    .eq("key", "birth_date")
    .eq("active", true)
    .maybeSingle();
  if (definition.error || !definition.data) throw new Error("birthday_field_unavailable");

  const students: BirthdayStudent[] = [];
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const result = await supabase
      .from("students")
      .select(
        `id,full_name,active,lifecycle_status,student_type,trial_status,
        person:persons!students_person_id_fkey!inner(profile_field_values!inner(value)),
        student_enrollments(status,starts_on,expires_on),
        product_acquisitions(status,starts_on,expires_on,refunded_at,created_at,
          product_templates(name,product_type))`,
      )
      .eq("studio_id", studioId)
      .eq("active", true)
      .eq("lifecycle_status", "active")
      .eq("person.studio_id", studioId)
      .eq("person.profile_field_values.studio_id", studioId)
      .eq("person.profile_field_values.definition_id", definition.data.id)
      .eq("student_enrollments.studio_id", studioId)
      .is("student_enrollments.refunded_at", null)
      .eq("product_acquisitions.studio_id", studioId)
      .order("id")
      .range(offset, offset + pageSize - 1)
      .returns<BirthdayRow[]>();
    if (result.error) throw new Error("birthday_students_unavailable");
    for (const student of result.data ?? []) {
      if (!isBirthdayStudent(student, student.student_enrollments, today)) continue;
      const parts = birthdayParts(student.person?.profile_field_values[0]?.value);
      if (!parts) continue;
      const packages = student.product_acquisitions
        .filter(
          (item) =>
            item.status === "active" &&
            !item.refunded_at &&
            (!item.starts_on || item.starts_on <= today) &&
            (!item.expires_on || item.expires_on >= today) &&
            ["package", "membership"].includes(item.product_templates?.product_type ?? ""),
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      students.push({
        id: student.id,
        name: student.full_name,
        ...parts,
        packageLabel:
          [...new Set(packages.map((item) => item.product_templates?.name).filter(Boolean))].join(
            " · ",
          ) || "Sin paquete activo",
      });
    }
    if ((result.data?.length ?? 0) < pageSize) break;
  }
  return students;
}
