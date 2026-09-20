import { LoginCard } from "../login-card";

export default async function StudioLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return <LoginCard mode="studio" error={error} />;
}
