import { redirect } from "next/navigation";

import { CAPABILITIES, type Capability } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";

export async function getCoachContext(requiredCapability?: Capability) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login/coach");

  const [{ data: account }, { data: membership }] = await Promise.all([
    supabase
      .from("user_accounts")
      .select("status")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("studio_memberships")
      .select("studio_id, role, active, person_id")
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle(),
  ]);

  if (
    !account ||
    account.status !== "active" ||
    !membership ||
    !membership.person_id
  ) {
    await supabase.auth.signOut();
    redirect("/login/coach?error=access");
  }

  const [
    { data: studio },
    { data: roleCapabilities },
    { data: instructor },
    { data: person },
  ] = await Promise.all([
    supabase
      .from("studios")
      .select("id, name, timezone, locale, currency, primary_color, status")
      .eq("id", membership.studio_id)
      .single(),
    supabase
      .from("role_capabilities")
      .select("capability_key")
      .eq("role", membership.role),
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
    !instructor ||
    instructor.status !== "active" ||
    !person
  ) {
    await supabase.auth.signOut();
    redirect("/login/coach?error=access");
  }

  const capabilities = new Set(
    (roleCapabilities ?? []).map((item) => item.capability_key as Capability),
  );

  if (!capabilities.has(CAPABILITIES.INSTRUCTOR_PORTAL)) {
    await supabase.auth.signOut();
    redirect("/login/coach?error=access");
  }

  if (requiredCapability && !capabilities.has(requiredCapability)) {
    redirect("/coach?error=access");
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
    can(capability: Capability) {
      return capabilities.has(capability);
    },
  };
}
