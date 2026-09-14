import { LoginCard } from "../login-card";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return <LoginCard mode="admin" error={error} />;
}
