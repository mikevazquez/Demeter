import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  headers: vi.fn(),
  reset: vi.fn(),
  getUser: vi.fn(),
  update: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: mocks.headers }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
import { requestStudioPasswordReset, completeStudioPasswordReset } from "@/app/auth/actions";
describe("shared studio recovery actions preserved during workshop delivery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.headers.mockResolvedValue(new Headers({ host: "sandbox.example" }));
    mocks.client.mockResolvedValue({
      auth: {
        resetPasswordForEmail: mocks.reset,
        getUser: mocks.getUser,
        updateUser: mocks.update,
      },
    });
  });
  it("requests recovery using the email field without requiring a login password", async () => {
    mocks.reset.mockResolvedValue({ error: null });
    const data = new FormData();
    data.set("email", " Example@Example.com ");
    await expect(requestStudioPasswordReset(data)).rejects.toThrow(
      "redirect:/login/studio?recovery=sent",
    );
    expect(mocks.client).toHaveBeenCalledWith("admin");
    expect(mocks.reset).toHaveBeenCalledWith("example@example.com", {
      redirectTo: "https://sandbox.example/auth/callback?next=/login/studio/restablecer",
    });
  });
  it("rejects an invalid confirmation before touching authentication", async () => {
    const data = new FormData();
    data.set("password", "synthetic-test-only");
    data.set("password_confirmation", "different-test-only");
    await expect(completeStudioPasswordReset(data)).rejects.toThrow("error=invalid");
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("does not change a password without an authenticated recovery user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const data = new FormData();
    data.set("password", "synthetic-test-only");
    data.set("password_confirmation", "synthetic-test-only");
    await expect(completeStudioPasswordReset(data)).rejects.toThrow("error=recovery_session");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

vi.mock("@/app/login/login-card", () => ({ LoginCard: () => null }));
import StudioLoginPage from "@/app/login/studio/page";
it("passes the recovery status to the studio login card", async () => {
  const page = await StudioLoginPage({ searchParams: Promise.resolve({ recovery: "sent" }) });
  expect(page.props).toMatchObject({ mode: "studio", recovery: "sent" });
});
