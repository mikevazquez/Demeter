import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

function studentAuthEmailFromPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) return null;
  return `student.${digits}@auth.studioflow.invalid`;
}

function buildStudentActivationLink(baseUrl: string, tokenHash: string) {
  const activationLink = new URL(baseUrl);
  activationLink.searchParams.set("token_hash", tokenHash);
  activationLink.searchParams.set("type", "recovery");
  return activationLink.toString();
}

export async function provisionStudentAccessWithServiceClient(input: {
  supabase: SupabaseClient;
  studioId: string;
  studentId: string;
  activationUrl: string | null;
  mode: "provision" | "resend";
}) {
  if (!input.activationUrl) {
    return {
      generated: false,
      error: "activation_url_unavailable",
      activation_url: null as string | null,
    };
  }

  const { data: student, error: studentError } = await input.supabase
    .from("students")
    .select("id,user_id,phone,full_name,active,lifecycle_status")
    .eq("id", input.studentId)
    .eq("studio_id", input.studioId)
    .maybeSingle();

  if (studentError || !student) {
    return {
      generated: false,
      error: "student_access_lookup_failed",
      activation_url: null as string | null,
    };
  }

  if (!student.active || student.lifecycle_status !== "active") {
    return {
      generated: false,
      error: "student_not_active",
      activation_url: null as string | null,
    };
  }

  const authEmail = studentAuthEmailFromPhone(String(student.phone ?? ""));
  if (!authEmail) {
    return {
      generated: false,
      error: "student_phone_invalid",
      activation_url: null as string | null,
    };
  }

  let userId = student.user_id as string | null;

  if (!userId) {
    const internalPassword = `Sf!${randomUUID()}A9`;
    const { data: created, error: createError } = await input.supabase.auth.admin.createUser({
      email: authEmail,
      password: internalPassword,
      email_confirm: true,
      user_metadata: {
        full_name: student.full_name,
        login_phone: student.phone,
      },
    });

    if (createError || !created.user) {
      return {
        generated: false,
        error: "auth_create_failed",
        activation_url: null as string | null,
      };
    }

    userId = created.user.id;

    const { error: linkError } = await input.supabase.rpc("service_link_student_access", {
      target_student_id: input.studentId,
      target_user_id: userId,
    });

    if (linkError) {
      await input.supabase.auth.admin.deleteUser(userId);
      return {
        generated: false,
        error: "student_access_link_failed",
        activation_url: null as string | null,
      };
    }
  } else if (input.mode === "provision") {
    return {
      generated: false,
      already_has_access: true,
      activation_url: null as string | null,
    };
  }

  const { data: activationData, error: activationError } =
    await input.supabase.auth.admin.generateLink({
      type: "recovery",
      email: authEmail,
      options: { redirectTo: input.activationUrl },
    });

  if (activationError || !activationData.properties?.action_link) {
    return {
      generated: false,
      error: "activation_link_failed",
      activation_url: null as string | null,
    };
  }

  const generatedActionLink = new URL(activationData.properties.action_link);
  const tokenHash = generatedActionLink.searchParams.get("token");
  if (!tokenHash) {
    return {
      generated: false,
      error: "activation_link_failed",
      activation_url: null as string | null,
    };
  }

  return {
    generated: true,
    already_has_access: false,
    activation_url: buildStudentActivationLink(input.activationUrl, tokenHash),
  };
}
