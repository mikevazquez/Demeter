"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import {
  STUDIO_CONTEXT_COOKIE,
  studioContextCookieOptions,
} from "@/lib/auth/studio-context-cookie";
import { studentAuthEmailFromPhone } from "@/lib/auth/student-login-identifier";
import { normalizeMexicanPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

type LoginMode = "studio" | "student";

type StudioMembership = {
  studio_id: string;
  role: string;
  active: boolean;
  person_id: string | null;
};

type PortalCapability = {
  role: string;
  capability_key: string;
};

function loginPath(mode: LoginMode) {
  return mode === "student" ? "/login/student" : "/login/studio";
}

function passwordIntegrity(password: string) {
  return {
    passwordLength: password.length,
    hasOuterWhitespace: password !== password.trim(),
    asciiOnly: /^[\x20-\x7e]*$/.test(password),
    unicodeNormalizationChanged: password.normalize("NFKC") !== password,
  };
}

function authErrorSummary(error: { code?: string; status?: number; message?: string } | null) {
  if (!error) return null;
  return {
    code: error.code,
    status: error.status,
    message: error.message?.slice(0, 160),
  };
}

function portalDestination(membership: StudioMembership, capabilities: PortalCapability[]) {
  const hasAdminPortal = capabilities.some(
    (item) => item.role === membership.role && item.capability_key === CAPABILITIES.ADMIN_PORTAL,
  );
  return hasAdminPortal ? "/admin" : "/admin/mis-clases";
}

async function setSelectedStudio(studioId: string) {
  const cookieStore = await cookies();
  cookieStore.set(STUDIO_CONTEXT_COOKIE, studioId, studioContextCookieOptions());
}

async function clearSelectedStudio() {
  const cookieStore = await cookies();
  cookieStore.delete(STUDIO_CONTEXT_COOKIE);
}

async function getEligibleStudioAccess(
  accessClient: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const membershipResult = await accessClient
    .from("studio_memberships")
    .select("studio_id, role, active, person_id")
    .eq("user_id", userId)
    .eq("active", true);

  if (membershipResult.error) {
    return {
      error: membershipResult.error,
      memberships: [] as StudioMembership[],
      capabilities: [] as PortalCapability[],
    };
  }

  const memberships = (membershipResult.data ?? []) as StudioMembership[];
  if (!memberships.length) {
    return { error: null, memberships: [], capabilities: [] as PortalCapability[] };
  }

  const roles = [...new Set(memberships.map((item) => item.role))];
  const capabilityResult = await accessClient
    .from("role_capabilities")
    .select("role, capability_key")
    .in("role", roles)
    .in("capability_key", [CAPABILITIES.ADMIN_PORTAL, CAPABILITIES.INSTRUCTOR_PORTAL]);

  if (capabilityResult.error) {
    return {
      error: capabilityResult.error,
      memberships: [] as StudioMembership[],
      capabilities: [] as PortalCapability[],
    };
  }

  const capabilities = (capabilityResult.data ?? []) as PortalCapability[];
  const eligibleRoles = new Set(capabilities.map((item) => item.role));
  const portalMemberships = memberships.filter((item) => eligibleRoles.has(item.role));

  if (!portalMemberships.length) {
    return { error: null, memberships: [], capabilities };
  }

  const studioIds = [...new Set(portalMemberships.map((item) => item.studio_id))];
  const studiosResult = await accessClient
    .from("studios")
    .select("id, status")
    .in("id", studioIds)
    .eq("status", "active");

  if (studiosResult.error) {
    return {
      error: studiosResult.error,
      memberships: [] as StudioMembership[],
      capabilities,
    };
  }

  const activeStudioIds = new Set((studiosResult.data ?? []).map((item) => item.id));
  return {
    error: null,
    memberships: portalMemberships.filter((item) => activeStudioIds.has(item.studio_id)),
    capabilities,
  };
}

export async function signIn(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const requestedMode = String(formData.get("mode") ?? "");
  const mode: LoginMode = requestedMode === "student" ? "student" : "studio";
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const phone = normalizeMexicanPhone(String(formData.get("phone") ?? ""));
  const studentAuthEmail = phone ? studentAuthEmailFromPhone(phone) : null;

  if (!password || (mode === "student" ? !phone || !studentAuthEmail : !email)) {
    redirect(`${loginPath(mode)}?error=missing`);
  }

  const authPortal = mode === "student" ? "student" : "admin";
  const supabase = await createClient(authPortal);
  const credentials =
    mode === "student" ? { email: studentAuthEmail!, password } : { email, password };
  let { data, error } = await supabase.auth.signInWithPassword(credentials);
  let trimRetryAttempted = false;

  if (mode === "student" && error?.code === "invalid_credentials") {
    const trimmedPassword = password.trim();
    if (trimmedPassword && trimmedPassword !== password) {
      trimRetryAttempted = true;
      const retry = await supabase.auth.signInWithPassword({
        email: studentAuthEmail!,
        password: trimmedPassword,
      });
      if (!retry.error && retry.data.user) {
        data = retry.data;
        error = null;
      }
    }
  }

  if (error || !data.user) {
    if (error) {
      console.error("[auth.signIn] Supabase Auth rejected sign-in", {
        mode,
        code: error.code,
        status: error.status,
        name: error.name,
        message: error.message.slice(0, 160),
        ...(mode === "student"
          ? {
              ...passwordIntegrity(password),
              trimRetryAttempted,
            }
          : {}),
      });
    }

    if (error?.code === "invalid_credentials") {
      redirect(`${loginPath(mode)}?error=invalid`);
    }

    if (error?.status === 429) {
      redirect(`${loginPath(mode)}?error=rate`);
    }

    redirect(`${loginPath(mode)}?error=auth`);
  }

  const accessClient = await createClient(authPortal);
  const accountResult = await accessClient
    .from("user_accounts")
    .select("status, must_change_password")
    .eq("id", data.user.id)
    .maybeSingle();

  if (accountResult.error) {
    console.error("[auth.signIn] Account lookup failed", {
      mode,
      accountError: authErrorSummary(accountResult.error),
    });
    await accessClient.auth.signOut();
    redirect(`${loginPath(mode)}?error=auth`);
  }

  const account = accountResult.data;
  if (!account || account.status !== "active") {
    await accessClient.auth.signOut();
    redirect(`${loginPath(mode)}?error=access`);
  }

  if (mode === "student") {
    const membershipResult = await accessClient
      .from("studio_memberships")
      .select("studio_id, role, active")
      .eq("user_id", data.user.id)
      .eq("role", "student")
      .eq("active", true)
      .limit(1)
      .maybeSingle();

    if (membershipResult.error) {
      console.error("[auth.signIn] Student membership lookup failed", {
        membershipError: authErrorSummary(membershipResult.error),
      });
      await accessClient.auth.signOut();
      redirect("/login/student?error=auth");
    }

    const membership = membershipResult.data;
    if (!membership) {
      await accessClient.auth.signOut();
      redirect("/login/student?error=pending");
    }

    const [studioResult, capabilityResult] = await Promise.all([
      accessClient.from("studios").select("status").eq("id", membership.studio_id).maybeSingle(),
      accessClient
        .from("role_capabilities")
        .select("capability_key")
        .eq("role", membership.role)
        .eq("capability_key", CAPABILITIES.STUDENT_PORTAL)
        .maybeSingle(),
    ]);

    if (studioResult.error || capabilityResult.error) {
      console.error("[auth.signIn] Student portal capability lookup failed", {
        studioError: authErrorSummary(studioResult.error),
        capabilityError: authErrorSummary(capabilityResult.error),
      });
      await accessClient.auth.signOut();
      redirect("/login/student?error=auth");
    }

    if (!studioResult.data || studioResult.data.status !== "active" || !capabilityResult.data) {
      await accessClient.auth.signOut();
      redirect("/login/student?error=access");
    }

    if (account.must_change_password) {
      redirect("/login/student/activar");
    }

    redirect("/student");
  }

  const studioAccess = await getEligibleStudioAccess(accessClient, data.user.id);

  if (studioAccess.error) {
    console.error("[auth.signIn] Studio access lookup failed", {
      error: authErrorSummary(studioAccess.error),
    });
    await accessClient.auth.signOut();
    redirect("/login/studio?error=auth");
  }

  if (!studioAccess.memberships.length) {
    await accessClient.auth.signOut();
    redirect("/login/studio?error=pending");
  }

  if (account.must_change_password) {
    const supportsActivation = studioAccess.memberships.some(
      (membership) => membership.role === "instructor",
    );
    if (!supportsActivation) {
      await accessClient.auth.signOut();
      redirect("/login/studio?error=activation");
    }
    await clearSelectedStudio();
    redirect("/login/studio/activar");
  }

  if (studioAccess.memberships.length > 1) {
    await clearSelectedStudio();
    redirect("/login/studio/seleccionar");
  }

  const membership = studioAccess.memberships[0];
  await setSelectedStudio(membership.studio_id);
  redirect(portalDestination(membership, studioAccess.capabilities));
}

export async function selectStudio(formData: FormData) {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  if (!studioId) redirect("/login/studio/seleccionar?error=missing");

  const accessClient = await createClient("admin");
  const {
    data: { user },
  } = await accessClient.auth.getUser();

  if (!user) redirect("/login/studio");

  const accountResult = await accessClient
    .from("user_accounts")
    .select("status, must_change_password")
    .eq("id", user.id)
    .maybeSingle();

  if (!accountResult.data || accountResult.data.status !== "active") {
    await accessClient.auth.signOut();
    redirect("/login/studio?error=access");
  }

  if (accountResult.data.must_change_password) {
    redirect("/login/studio/activar");
  }

  const studioAccess = await getEligibleStudioAccess(accessClient, user.id);
  const membership = studioAccess.memberships.find((item) => item.studio_id === studioId);

  if (studioAccess.error || !membership) {
    redirect("/login/studio/seleccionar?error=access");
  }

  await setSelectedStudio(studioId);
  redirect(portalDestination(membership, studioAccess.capabilities));
}

export async function completeStudioPasswordActivation(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("password_confirmation") ?? "");

  if (password.length < 8 || password !== confirmation) {
    redirect("/login/studio/activar?error=invalid");
  }

  const supabase = await createClient("admin");
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login/studio");

  const accountResult = await supabase
    .from("user_accounts")
    .select("status, must_change_password")
    .eq("id", user.id)
    .maybeSingle();

  if (!accountResult.data || accountResult.data.status !== "active") {
    await supabase.auth.signOut();
    redirect("/login/studio?error=access");
  }

  const studioAccess = await getEligibleStudioAccess(supabase, user.id);
  if (studioAccess.error || !studioAccess.memberships.length) {
    await supabase.auth.signOut();
    redirect("/login/studio?error=access");
  }

  if (!accountResult.data.must_change_password) {
    if (studioAccess.memberships.length > 1) redirect("/login/studio/seleccionar");
    const membership = studioAccess.memberships[0];
    await setSelectedStudio(membership.studio_id);
    redirect(portalDestination(membership, studioAccess.capabilities));
  }

  const hasInstructorMembership = studioAccess.memberships.some(
    (membership) => membership.role === "instructor",
  );
  if (!hasInstructorMembership) redirect("/login/studio?error=activation");

  const { error: passwordError } = await supabase.auth.updateUser({ password });
  if (passwordError) redirect("/login/studio/activar?error=password");

  const { error: activationError } = await supabase.rpc("instructor_complete_password_activation");
  if (activationError) redirect("/login/studio/activar?error=save");

  if (studioAccess.memberships.length > 1) {
    await clearSelectedStudio();
    redirect("/login/studio/seleccionar");
  }

  const membership = studioAccess.memberships[0];
  await setSelectedStudio(membership.studio_id);
  redirect(portalDestination(membership, studioAccess.capabilities));
}

export async function createInitialOwnerAccount(formData: FormData) {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!fullName || !email || password.length < 8) {
    redirect("/setup?error=invalid");
  }

  const supabase = await createClient("admin");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });

  if (error || !data.user) {
    redirect("/setup?error=signup");
  }

  await supabase.auth.signOut();
  redirect("/setup?created=1");
}

export async function signOut(formData?: FormData) {
  const mode = String(formData?.get("mode") ?? "");
  const portal = mode === "student" ? "student" : "admin";
  const supabase = await createClient(portal);
  await supabase.auth.signOut();

  if (portal === "admin") {
    await clearSelectedStudio();
  }

  redirect(portal === "student" ? "/login/student" : "/login/studio");
}
