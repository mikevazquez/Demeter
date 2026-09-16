import { LoginCard } from "../login-card";

export default async function CoachLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return <LoginCard mode="coach" error={error} />;
}
