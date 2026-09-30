import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CAPABILITIES, type Capability } from "@/lib/auth/capabilities";
import { type StudioModule } from "@/lib/auth/modules";
import { STUDIO_CONTEXT_COOKIE } from "@/lib/auth/studio-context-cookie";
import { createClient } from "@/lib/supabase/server";

export type StudioSubscriptionSnapshot = {
  plan_key: string;
  plan_name: string;
  status: string;
  effective_status: string;
  access_mode: "full" | "restricted";
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  grace_ends_at: string | null;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  suspended_at: string | null;
  last_payment_failure_at: string | null;
  billing_provider: string | null;
};

type AdminContextOptions = {
  allowRestricted?: boolean;
};

export async function getAdminContext(
  requiredCapability?: Capability,
  options: AdminContextOptions = {},
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login/studio");

  const [{ data: account }, { data: memberships }] = await Promise.all([
    supabase.from("user_accounts").select("status").eq("id", user.id).maybeSingle(),
    supabase
      .from("studio_memberships")
      .select("studio_id, role, active, person_id")
      .eq("user_id", user.id)
      .eq("active", true),
  ]);

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

  const [
    { data: studio },
    { data: effectiveCapabilities, error: capabilitiesError },
    { data: effectiveModules, error: modulesError },
    { data: subscriptionRows, error: subscriptionError },
  ] = await Promise.all([
    supabase
      .from("studios")
      .select("id, name, slug, logo_path, tagline, timezone, locale, currency, phone_country_calling_code, primary_color, status")
      .eq("id", membership.studio_id)
      .single(),
    supabase.rpc("current_studio_capabilities", {
      p_studio_id: membership.studio_id,
    }),
    supabase.rpc("current_studio_modules", {
      p_studio_id: membership.studio_id,
    }),
    supabase.rpc("current_studio_subscription", {
      p_studio_id: membership.studio_id,
    }),
  ]);

  const subscription = ((subscriptionRows ?? [])[0] ?? null) as
    | StudioSubscriptionSnapshot
    | null;

  if (!studio || studio.status !== "active") {
    await supabase.auth.signOut();
    redirect("/login/studio?error=access");
  }

  // SaaS entitlement metadata must never invalidate a valid studio login.
  // Fall back to the membership role while subscription/module metadata is unavailable.
  const fallbackCapabilities = new Set<Capability>();
  if (["owner", "admin"].includes(membership.role)) fallbackCapabilities.add(CAPABILITIES.ADMIN_PORTAL);
  if (membership.role === "instructor") fallbackCapabilities.add(CAPABILITIES.INSTRUCTOR_PORTAL);

  const capabilities = capabilitiesError
    ? fallbackCapabilities
    : new Set(
        (effectiveCapabilities ?? []).map(
          (item: { capability_key: string }) => item.capability_key as Capability,
        ),
      );
  const modules = modulesError
    ? new Set<StudioModule>()
    : new Set(
        (effectiveModules ?? []).map(
          (item: { module_key: string }) => item.module_key as StudioModule,
        ),
      );
  const canUseStudioPortal =
    capabilities.has(CAPABILITIES.ADMIN_PORTAL) || capabilities.has(CAPABILITIES.INSTRUCTOR_PORTAL);

  if (!canUseStudioPortal) {
    await supabase.auth.signOut();
    redirect("/login/studio?error=access");
  }

  if (subscription && !subscriptionError && subscription.access_mode === "restricted" && !options.allowRestricted) {
    redirect("/admin/suscripcion");
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
    subscription: subscription ?? ({ plan_key: "legacy", plan_name: "Studio activo", status: "active", effective_status: "active", access_mode: "full", trial_ends_at: null, current_period_start: null, current_period_end: null, grace_ends_at: null, cancel_at_period_end: false, cancelled_at: null, suspended_at: null, last_payment_failure_at: null, billing_provider: null } satisfies StudioSubscriptionSnapshot),
    capabilities,
    modules,
    can(capability: Capability) {
      return capabilities.has(capability);
    },
    hasModule(module: StudioModule) {
      return modules.has(module);
    },
  };
}
