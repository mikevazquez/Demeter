export const DEMI_UAT_HOST = "hedouonyhynuvwbckdlg.supabase.co";

export function assertDemiUatEnvironment(url: string | undefined, vercelEnv?: string) {
  let parsed: URL;
  try {
    parsed = new URL(url ?? "");
  } catch {
    throw new Error("demi_uat_sandbox_required");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== DEMI_UAT_HOST ||
    parsed.username ||
    parsed.password ||
    vercelEnv === "production"
  ) {
    throw new Error("demi_uat_sandbox_required");
  }
}
