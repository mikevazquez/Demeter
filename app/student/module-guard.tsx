import ModuleLocked from "@/app/components/ModuleLocked";
import type { PlatformModuleKey } from "@/lib/platform/catalog";
import { loadStudioEntitlements, studioHasModule } from "@/lib/platform/entitlements";
import { getStudentAccessContext } from "@/lib/student/portal";

// NEB-01-03 · Secciones del portal que dependen de un módulo contratado por el estudio.
export default async function StudentModuleGuard({
  module: moduleKey,
  children,
}: {
  module: PlatformModuleKey;
  children: React.ReactNode;
}) {
  const access = await getStudentAccessContext();
  const entitlements = await loadStudioEntitlements(access.supabase, access.membership.studio_id);
  if (!studioHasModule(entitlements, moduleKey)) {
    return <ModuleLocked module={moduleKey} />;
  }
  return children;
}
