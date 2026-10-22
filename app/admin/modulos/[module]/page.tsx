import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { PLATFORM_MODULES, type PlatformModuleKey } from "@/lib/platform/catalog";

import AdminModuleOffer from "../../module-offer";

const MODULE_HOME: Record<PlatformModuleKey, string> = {
  recompensas: "/admin/recompensas",
  recursos: "/admin/configuracion/recursos",
  catalogo: "/admin/evaluaciones",
  demi: "/admin/mas/demi",
};

// NEB-01-03 · Página de un módulo de Nébora: oferta si no está contratado, si no, su sección.
export default async function ModuleOfferPage({
  params,
  searchParams,
}: {
  params: Promise<{ module: string }>;
  searchParams: Promise<{ estado?: string }>;
}) {
  const [{ module: moduleParam }, query, ctx] = await Promise.all([
    params,
    searchParams,
    getAdminContext(),
  ]);
  const moduleKey = PLATFORM_MODULES.find((entry) => entry.key === moduleParam)?.key;
  if (!moduleKey) redirect("/admin/mas");
  if (ctx.hasModule(moduleKey) && query.estado !== "module_already_active") {
    redirect(MODULE_HOME[moduleKey]);
  }
  return <AdminModuleOffer module={moduleKey} notice={query.estado} />;
}
