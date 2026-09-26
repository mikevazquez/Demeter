import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CAPABILITIES, type Capability } from "@/lib/auth/capabilities";
import { STUDIO_CONTEXT_COOKIE } from "@/lib/auth/studio-context-cookie";
import { createClient } from "@/lib/supabase/server";

export async function getAdminContext(requiredCapability?: Capability) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError && (authError.status == null || authError.status === 0 || authError.status >= 500)) {
    throw new Error("admin_auth_temporarily_unavailable");
  }
  if (!user) redirect("/login/studio");

  const [accountResult, membershipsResult] = await Promise.all([
    supabase.from("user_accounts").select("status").eq("id", user.id).maybeSingle(),
    supabase
      .from("studio_memberships")
      .select("studio_id, role, active, person_id")
      .eq("user_id", user.id)
      .eq("active", true),
  ]);

  if (accountResult.error || membershipsResult.error) {
    throw new Error("admin_access_lookup_temporarily_unavailable");
  }

  const account = accountResult.data;
  const memberships = membershipsResult.data;

  if (!account || account.status !== "active" || !memberships?.length) {
    await supabase.auth.signOut();
    redirect("/login/studio?error=access");
  }

  const cookieStore = await cookies();
  const selectedStudioId = cookieStore.get(STUDIO_CONTEXT_COOKIE)?.value;
  const selectedMembership = selectedStudioId
    ? memberships.find((item) => item.studio_id === selectedStudioId)
    : null;
  const membership = selectedMembership ?? (memberships.length === 1 ? memberships[0] : null);

  if (!membership) {
    redirect("/login/studio/seleccionar");
  }

  const [studioResult, roleCapabilitiesResult] = await Promise.all([
    supabase
      .from("studios")
      .select("id, name, slug, logo_path, timezone, locale, currency, primary_color, status")
      .eq("id", membership.studio_id)
      .single(),
    supabase.from("role_capabilities").select("capability_key").eq("role", membership.role),
  ]);

  if (studioResult.error || roleCapabilitiesResult.error) {
    throw new Error("admin_studio_lookup_temporarily_unavailable");
  }

  const studio = studioResult.data;
  const roleCapabilities = roleCapabilitiesResult.data;

  if (!studio || studio.status !== "active") {
    await supabase.auth.signOut();
    redirect("/login/studio?error=access");
  }

  const capabilities = new Set(
    (roleCapabilities ?? []).map((item) => item.capability_key as Capability),
  );
  const canUseStudioPortal =
    capabilities.has(CAPABILITIES.ADMIN_PORTAL) || capabilities.has(CAPABILITIES.INSTRUCTOR_PORTAL);

  if (!canUseStudioPortal) {
    await supabase.auth.signOut();
    redirect("/login/studio?error=access");
  }

  if (requiredCapability && !capabilities.has(requiredCapability)) {
    redirect(
      capabilities.has(CAPABILITIES.ADMIN_PORTAL)
        ? "/admin?error=access"
        : "/admin/mis-clases?error=access",
    );
  }

  return {
    supabase,
    user,
    account,
    membership,
    studio,
    capabilities,
    can(capability: Capability) {
      return capabilities.has(capability);
    },
  };
}
