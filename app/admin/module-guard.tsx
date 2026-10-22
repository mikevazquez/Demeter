import ModuleLocked from "@/app/components/ModuleLocked";
import { getAdminContext } from "@/lib/auth/admin-context";
import type { PlatformModuleKey } from "@/lib/platform/catalog";

// NEB-01-03 · Envuelve las secciones de un módulo: si el estudio no lo tiene, no las muestra.
export default async function AdminModuleGuard({
  module: moduleKey,
  children,
}: {
  module: PlatformModuleKey;
  children: React.ReactNode;
}) {
  const ctx = await getAdminContext();
  if (!ctx.hasModule(moduleKey)) {
    return (
      <ModuleLocked module={moduleKey} surface="admin" isOwner={ctx.membership.role === "owner"} />
    );
  }
  return children;
}
