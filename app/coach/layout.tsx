import AdminLayout from "../admin/layout";

export default async function CoachCompatibilityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminLayout>{children}</AdminLayout>;
}
