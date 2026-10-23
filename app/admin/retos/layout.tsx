import AdminModuleGuard from "@/app/admin/module-guard";

export default function ModuleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AdminModuleGuard module="recompensas">{children}</AdminModuleGuard>;
}
