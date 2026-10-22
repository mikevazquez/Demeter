import { getAdminContext } from "@/lib/auth/admin-context";
import type { PlatformModuleKey } from "@/lib/platform/catalog";

import AdminModuleOffer from "./module-offer";

// NEB-01-03 · Envuelve las secciones de un módulo: si el estudio no lo tiene, muestra la oferta
// para activarlo (self-service) en lugar del contenido.
export default async function AdminModuleGuard({
  module: moduleKey,
  children,
}: {
  module: PlatformModuleKey;
  children: React.ReactNode;
}) {
  const ctx = await getAdminContext();
  if (!ctx.hasModule(moduleKey)) {
    return <AdminModuleOffer module={moduleKey} />;
  }
  return children;
}
