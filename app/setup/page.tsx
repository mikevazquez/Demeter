import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { ProvisionStudioForm, type ProvisionPlanOption } from "./ProvisionStudioForm";

export default async function SetupPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login/studio");

  const { data: platformAdmin } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (!platformAdmin) redirect("/");

  const [{ data: plans }, { data: planModules }, { data: modules }] = await Promise.all([
    supabase
      .from("saas_plans")
      .select("id,plan_key,name,description,sort_order")
      .eq("active", true)
      .eq("internal_only", false)
      .order("sort_order")
      .order("name"),
    supabase
      .from("saas_plan_modules")
      .select("plan_id,module_key,enabled")
      .eq("enabled", true),
    supabase
      .from("saas_modules")
      .select("module_key,name,sort_order")
      .eq("active", true)
      .order("sort_order"),
  ]);

  const moduleByKey = new Map(
    (modules ?? []).map((module) => [module.module_key, module.name]),
  );
  const moduleOrder = new Map(
    (modules ?? []).map((module) => [module.module_key, module.sort_order]),
  );
  const modulesByPlan = new Map<string, string[]>();

  for (const item of planModules ?? []) {
    const rows = modulesByPlan.get(item.plan_id) ?? [];
    rows.push(item.module_key);
    modulesByPlan.set(item.plan_id, rows);
  }

  const planOptions: ProvisionPlanOption[] = (plans ?? []).map((plan) => ({
    planKey: plan.plan_key,
    name: plan.name,
    description: plan.description,
    moduleNames: (modulesByPlan.get(plan.id) ?? [])
      .sort(
        (left, right) =>
          (moduleOrder.get(left) ?? 999) - (moduleOrder.get(right) ?? 999),
      )
      .map((moduleKey) => moduleByKey.get(moduleKey) ?? moduleKey),
  }));

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="flex items-center justify-between gap-3">
          <Link className="back-link" href="/admin">
            ← Administración
          </Link>
          <Link className="back-link" href="/setup/planes">
            Administrar planes →
          </Link>
        </div>

        <p className="eyebrow">STUDIO FLOW · INTERNO</p>
        <h1 className="auth-title">Crear estudio</h1>
        <p className="auth-copy">
          Provisiona un tenant nuevo con owner, sede principal, sala, configuración base y plan
          comercial. Esta herramienta solo está disponible para administración de plataforma.
        </p>

        <ProvisionStudioForm plans={planOptions} />
      </section>
    </main>
  );
}
