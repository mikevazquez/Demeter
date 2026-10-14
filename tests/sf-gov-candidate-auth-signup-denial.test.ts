import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (destination: string) => {
    throw new Error(`redirect:${destination}`);
  },
}));

import { createInitialOwnerAccount } from "@/app/auth/actions";

function request() {
  const form = new FormData();
  form.set("full_name", "Synthetic fixture");
  form.set("email", "owner@studioflow.invalid");
  form.set("password", "synthetic-password-only");
  return form;
}

describe("Candidate Auth confirmation mail boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SF_GOV_CANDIDATE_PREVIEW", "0");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://qfhojvgvhrbautvczffq.supabase.co");
    vi.stubEnv("SUPABASE_URL", "https://qfhojvgvhrbautvczffq.supabase.co");
    mocks.createClient.mockResolvedValue({
      auth: { signUp: mocks.signUp, signOut: mocks.signOut },
    });
    mocks.signUp.mockResolvedValue({ data: { user: { id: "synthetic" } }, error: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  for (const [name, value] of [
    ["VERCEL_ENV", "preview"],
    ["SF_GOV_CANDIDATE_PREVIEW", "1"],
    ["SF_GOV_CANDIDATE_PREVIEW", "true"],
    ["NEXT_PUBLIC_SUPABASE_URL", "https://sdmxtlgjkodidjtvikng.supabase.co"],
    ["SUPABASE_URL", "https://sdmxtlgjkodidjtvikng.supabase.co"],
  ]) {
    it(`blocks signup before client creation with ${name}=${value}`, async () => {
      vi.stubEnv(name, value);
      await expect(createInitialOwnerAccount(request())).rejects.toThrow(
        "redirect:/setup?error=isolated",
      );
      expect(mocks.createClient).not.toHaveBeenCalled();
      expect(mocks.signUp).not.toHaveBeenCalled();
      expect(mocks.signOut).not.toHaveBeenCalled();
    });
  }

  it("keeps ordinary non-Candidate signup behavior using an inert mocked Auth client", async () => {
    await expect(createInitialOwnerAccount(request())).rejects.toThrow("redirect:/setup?created=1");
    expect(mocks.signUp).toHaveBeenCalledWith({
      email: "owner@studioflow.invalid",
      password: "synthetic-password-only",
      options: { data: { full_name: "Synthetic fixture" } },
    });
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
});
