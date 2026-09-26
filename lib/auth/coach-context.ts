import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CAPABILITIES, type Capability } from "@/lib/auth/capabilities";
import { type StudioModule } from "@/lib/auth/modules";
import { STUDIO_CONTEXT_COOKIE } from "@/lib/auth/studio-context-cookie";
import { createClient } from "@/lib/supabase/server";

export async function getCoachContext(requiredCapability?: Capability) {
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
      .eq("role", "instructor")
      .eq("active", true),
  ]);

  if (!account || account.status !== "active" || !memberships?.length) {
    await supabase.auth.signOut();
    redirect("/login/studio?error=access");
  }

  const cookieStore = await cookies();
  const selectedStudioId = cookieStore.get(STUDIO_CONTEXT_COOKIE)?.value;
  const membership = selectedStudioId
    ? memberships.find((item) => item.studio_id === selectedStudioId)
    : memberships.length === 1
      ? memberships[0]
      : null;

  if (!membership?.person_id) {
    redirect("/login/studio/seleccionar");
  }

  const [
    { data: studio },
    { data: effectiveCapabilities, error: capabilitiesError },
    { data: effectiveModules, error: modulesError },
    { data: instructor },
    { data: person },
  ] = await Promise.all([
      supabase
        .from("studios")
        .select("id, name, timezone, locale, currency, primary_color, status")
        .eq("id", membership.studio_id)
        .single(),
      supabase.rpc("current_studio_capabilities", {
        p_studio_id: membership.studio_id,
      }),
      supabase.rpc("current_studio_modules", {
        p_studio_id: membership.studio_id,
      }),
      supabase
        .from("instructors")
        .select("id, studio_id, person_id, status")
        .eq("studio_id", membership.studio_id)
        .eq("person_id", membership.person_id)
        .maybeSingle(),
      supabase
        .from("persons")
        .select("id, first_name, last_name")
        .eq("studio_id", membership.studio_id)
        .eq("id", membership.person_id)
        .maybeSingle(),
    ]);

  if (
    !studio ||
    studio.status !== "active" ||
    capabilitiesError ||
    modulesError ||
    !instructor ||
    instructor.status !== "active" ||
    !person
  ) {
    await supabase.auth.signOut();
    redirect("/login/studio?error=access");
  }

  const capabilities = new Set(
    (effectiveCapabilities ?? []).map(
      (item: { capability_key: string }) => item.capability_key as Capability,
    ),
  );
  const modules = new Set(
    (effectiveModules ?? []).map(
      (item: { module_key: string }) => item.module_key as StudioModule,
    ),
  );

  if (!capabilities.has(CAPABILITIES.INSTRUCTOR_PORTAL)) {
    await supabase.auth.signOut();
    redirect("/login/studio?error=access");
  }

  if (requiredCapability && !capabilities.has(requiredCapability)) {
    redirect("/admin/mis-clases?error=access");
  }

  return {
    supabase,
    user,
    account,
    membership,
    studio,
    instructor,
    person,
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
