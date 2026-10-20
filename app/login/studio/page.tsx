import { LoginCard } from "../login-card";

export default async function StudioLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; recovery?: string }>;
}) {
  const { error, recovery } = await searchParams;
  return <LoginCard mode="studio" error={error} recovery={recovery} />;
}
