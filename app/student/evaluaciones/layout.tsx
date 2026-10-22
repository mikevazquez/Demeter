import StudentModuleGuard from "@/app/student/module-guard";

export default function ModuleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <StudentModuleGuard module="catalogo">{children}</StudentModuleGuard>;
}
