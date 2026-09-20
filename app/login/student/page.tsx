import { LoginCard } from "../login-card";

export default async function StudentLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  return <LoginCard mode="student" error={error} returnTo={next} />;
}
