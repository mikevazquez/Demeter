import { redirect } from "next/navigation";
import { CAPABILITIES, type Capability } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";

export async function getAdminContext(requiredCapability?: Capability) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login/admin");

  const { data: membership } = await supabase
    .from("studio_memberships")
    .select("studio_id, role, active")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (!membership) redirect("/login/admin?error=access");

  const [{ data: studio }, { data: roleCapabilities }] = await Promise.all([
    supabase.from("studios").select("id, name, timezone").eq("id", membership.studio_id).single(),
    supabase.from("role_capabilities").select("capability_key").eq("role", membership.role),
  ]);

  if (!studio) redirect("/login/admin?error=access");

  const capabilities = new Set(
    (roleCapabilities ?? []).map((item) => item.capability_key as Capability),
  );

  if (!capabilities.has(CAPABILITIES.ADMIN_PORTAL)) {
    redirect("/login/admin?error=access");
  }

  if (requiredCapability && !capabilities.has(requiredCapability)) {
    redirect("/admin?error=access");
  }

  return {
    supabase,
    user,
    membership,
    studio,
    capabilities,
    can(capability: Capability) {
      return capabilities.has(capability);
    },
  };
}
