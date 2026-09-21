import { withSupabase } from "npm:@supabase/server";

import { sendAsistianWebhook } from "../_shared/asistian-messaging.ts";

type ProvisionRequest = {
  studentId?: unknown;
  mode?: unknown;
  activationUrl?: unknown;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function studentAuthEmailFromPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) return null;

  return `student.${digits}@auth.studioflow.invalid`;
}

function generateInternalPassword() {
  return `Sf!${crypto.randomUUID()}A9`;
}

function buildStudentActivationLink(baseUrl: string, tokenHash: string) {
  const activationLink = new URL(baseUrl);
  activationLink.searchParams.set("token_hash", tokenHash);
  activationLink.searchParams.set("type", "recovery");
  return activationLink.toString();
}

const handler = {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

    const userClient = context.supabase;
    const adminClient = context.supabaseAdmin;

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) return jsonResponse({ error: "unauthenticated" }, 401);

    let payload: ProvisionRequest;
    try {
      payload = (await request.json()) as ProvisionRequest;
    } catch {
      return jsonResponse({ error: "invalid_request" }, 400);
    }

    const studentId = typeof payload.studentId === "string" ? payload.studentId.trim() : "";
    const mode =
      payload.mode === "resend" || payload.mode === "reset"
        ? "resend"
        : payload.mode === undefined
          ? "provision"
          : "";
    const activationUrl =
      typeof payload.activationUrl === "string" ? payload.activationUrl.trim() : "";
    if (!studentId || !mode) return jsonResponse({ error: "invalid_request" }, 400);

    try {
      const parsedActivationUrl = new URL(activationUrl);
      if (
        parsedActivationUrl.protocol !== "https:" ||
        parsedActivationUrl.pathname !== "/login/student/activar"
      ) {
        return jsonResponse({ error: "activation_url_invalid" }, 400);
      }
    } catch {
      return jsonResponse({ error: "activation_url_invalid" }, 400);
    }

    const { data: student, error: studentError } = await userClient
      .from("students")
      .select("id, studio_id, person_id, user_id, full_name, phone, active, lifecycle_status")
      .eq("id", studentId)
      .maybeSingle();

    if (studentError) return jsonResponse({ error: "student_lookup_failed" }, 500);
    if (!student) return jsonResponse({ error: "student_not_found" }, 404);
    if (!student.person_id) return jsonResponse({ error: "student_person_missing" }, 409);
    if (!student.active || student.lifecycle_status !== "active") {
      return jsonResponse({ error: "student_not_active" }, 409);
    }

    const authEmail = studentAuthEmailFromPhone(student.phone);
    if (!authEmail) return jsonResponse({ error: "student_phone_invalid" }, 409);

    const { data: callerMembership, error: membershipError } = await userClient
      .from("studio_memberships")
      .select("role, active")
      .eq("studio_id", student.studio_id)
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle();

    if (membershipError) return jsonResponse({ error: "authorization_failed" }, 500);
    if (!callerMembership) return jsonResponse({ error: "forbidden" }, 403);

    const { data: permission, error: permissionError } = await userClient
      .from("role_capabilities")
      .select("capability_key")
      .eq("role", callerMembership.role)
      .eq("capability_key", "settings.write")
      .maybeSingle();

    if (permissionError) return jsonResponse({ error: "authorization_failed" }, 500);
    if (!permission) return jsonResponse({ error: "forbidden" }, 403);

    if (mode === "resend") {
      if (!student.user_id) return jsonResponse({ error: "student_access_missing" }, 409);

      const [
        { data: account, error: accountError },
        { data: targetMembership, error: targetError },
      ] = await Promise.all([
        userClient
          .from("user_accounts")
          .select("status, must_change_password")
          .eq("id", student.user_id)
          .maybeSingle(),
        userClient
          .from("studio_memberships")
          .select("role, active")
          .eq("studio_id", student.studio_id)
          .eq("user_id", student.user_id)
          .maybeSingle(),
      ]);

      if (accountError || targetError) return jsonResponse({ error: "access_lookup_failed" }, 500);
      if (
        !account ||
        account.status !== "active" ||
        !targetMembership ||
        targetMembership.role !== "student" ||
        targetMembership.active !== true
      ) {
        return jsonResponse({ error: "student_access_inconsistent" }, 409);
      }
      if (account.must_change_password !== true) {
        return jsonResponse({ error: "activation_already_completed" }, 409);
      }

      const internalPassword = generateInternalPassword();
      const { error: resetError } = await adminClient.auth.admin.updateUserById(student.user_id, {
        email: authEmail,
        email_confirm: true,
        password: internalPassword,
      });
      if (resetError) return jsonResponse({ error: "auth_activation_reset_failed" }, 500);

      const { data: activationData, error: activationError } =
        await adminClient.auth.admin.generateLink({
          type: "recovery",
          email: authEmail,
          options: { redirectTo: activationUrl },
        });

      if (activationError || !activationData.properties?.action_link) {
        return jsonResponse({ error: "activation_link_failed" }, 500);
      }

      const generatedActionLink = new URL(activationData.properties.action_link);
      const tokenHash = generatedActionLink.searchParams.get("token");
      if (!tokenHash) return jsonResponse({ error: "activation_link_failed" }, 500);

      const activationLink = buildStudentActivationLink(activationUrl, tokenHash);
      const welcomeEventId = `student_welcome:${student.id}:${student.user_id}:${crypto.randomUUID()}`;
      const welcomeDelivery = await sendAsistianWebhook({
        adminClient,
        studioId: student.studio_id,
        template: "student_welcome",
        eventId: welcomeEventId,
        recipient: student.phone,
        variables: {
          nombre: student.full_name,
          activation_url: activationLink,
          activation_token: tokenHash,
        },
        metadata: {
          source: "student_access_activation_resend",
          student_id: student.id,
          user_id: student.user_id,
          must_change_password: true,
        },
      });

      return jsonResponse({
        ok: true,
        phone: student.phone,
        mustChangePassword: true,
        activationLinkGenerated: true,
        welcomeDelivery: {
          status: welcomeDelivery.status,
          errorCode: welcomeDelivery.status === "accepted" ? null : welcomeDelivery.errorCode,
        },
      });
    }

    if (student.user_id) return jsonResponse({ error: "student_already_linked" }, 409);

    const internalPassword = generateInternalPassword();

    let { data: createdUser, error: createError } = await adminClient.auth.admin.createUser({
      email: authEmail,
      password: internalPassword,
      email_confirm: true,
      user_metadata: { full_name: student.full_name, login_phone: student.phone },
    });
    let provisionedUser = createdUser.user;

    if (createError || !provisionedUser) {
      const message = createError?.message.toLowerCase() ?? "";
      const duplicate =
        message.includes("already") || message.includes("registered") || message.includes("exists");

      if (!duplicate) return jsonResponse({ error: "auth_create_failed" }, 500);

      let staleUser = null;
      for (let page = 1; page <= 50 && !staleUser; page += 1) {
        const { data: usersPage, error: listError } = await adminClient.auth.admin.listUsers({
          page,
          perPage: 200,
        });
        if (listError) return jsonResponse({ error: "auth_lookup_failed" }, 500);

        staleUser =
          usersPage.users.find((candidate) => candidate.email?.toLowerCase() === authEmail) ?? null;

        if (usersPage.users.length < 200) break;
      }

      if (!staleUser) return jsonResponse({ error: "auth_login_exists" }, 409);

      const [
        { data: activeMemberships, error: activeMembershipError },
        { data: linkedStudents, error: linkedStudentsError },
      ] = await Promise.all([
        adminClient
          .from("studio_memberships")
          .select("studio_id")
          .eq("user_id", staleUser.id)
          .eq("active", true)
          .limit(1),
        adminClient
          .from("students")
          .select("id")
          .eq("user_id", staleUser.id)
          .neq("lifecycle_status", "archived")
          .limit(1),
      ]);

      if (activeMembershipError || linkedStudentsError) {
        return jsonResponse({ error: "auth_reuse_check_failed" }, 500);
      }
      if ((activeMemberships?.length ?? 0) > 0 || (linkedStudents?.length ?? 0) > 0) {
        return jsonResponse({ error: "auth_login_exists" }, 409);
      }

      const { error: cleanupError } = await adminClient.auth.admin.deleteUser(staleUser.id);
      if (cleanupError) return jsonResponse({ error: "stale_auth_cleanup_failed" }, 500);

      const retry = await adminClient.auth.admin.createUser({
        email: authEmail,
        password: internalPassword,
        email_confirm: true,
        user_metadata: { full_name: student.full_name, login_phone: student.phone },
      });
      createdUser = retry.data;
      createError = retry.error;
      provisionedUser = retry.data.user;

      if (createError || !provisionedUser) {
        return jsonResponse({ error: "auth_create_failed" }, 500);
      }
    }

    const { error: linkError } = await adminClient.rpc("service_link_student_access", {
      target_student_id: student.id,
      target_user_id: provisionedUser.id,
    });

    if (linkError) {
      await adminClient.auth.admin.deleteUser(provisionedUser.id);
      return jsonResponse({ error: "link_failed" }, 500);
    }

    const { data: activationData, error: activationError } =
      await adminClient.auth.admin.generateLink({
        type: "recovery",
        email: authEmail,
        options: { redirectTo: activationUrl },
      });

    if (activationError || !activationData.properties?.action_link) {
      return jsonResponse({
        ok: true,
        phone: student.phone,
        mustChangePassword: true,
        activationLinkGenerated: false,
        welcomeDelivery: {
          status: "error",
          errorCode: "activation_link_failed",
        },
      });
    }

    const generatedActionLink = new URL(activationData.properties.action_link);
    const tokenHash = generatedActionLink.searchParams.get("token");
    if (!tokenHash) {
      return jsonResponse({
        ok: true,
        phone: student.phone,
        mustChangePassword: true,
        activationLinkGenerated: false,
        welcomeDelivery: {
          status: "error",
          errorCode: "activation_link_failed",
        },
      });
    }

    const activationLink = buildStudentActivationLink(activationUrl, tokenHash);
    const welcomeEventId = `student_welcome:${student.id}:${provisionedUser.id}:${crypto.randomUUID()}`;
    const welcomeDelivery = await sendAsistianWebhook({
      adminClient,
      studioId: student.studio_id,
      template: "student_welcome",
      eventId: welcomeEventId,
      recipient: student.phone,
      variables: {
        nombre: student.full_name,
        activation_url: activationLink,
      },
      metadata: {
        source: "student_access_provisioning",
        student_id: student.id,
        user_id: provisionedUser.id,
        must_change_password: true,
      },
    });

    return jsonResponse({
      ok: true,
      phone: student.phone,
      mustChangePassword: true,
      activationLinkGenerated: true,
      welcomeDelivery: {
        status: welcomeDelivery.status,
        errorCode: welcomeDelivery.status === "accepted" ? null : welcomeDelivery.errorCode,
      },
    });
  }),
};

export default handler;
