import AdminModuleGuard from "@/app/admin/module-guard";

import "./evaluaciones.css";

export default function EvaluationsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AdminModuleGuard module="catalogo">{children}</AdminModuleGuard>;
}
