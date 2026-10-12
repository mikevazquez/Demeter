import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: state.create }));
vi.mock("@/lib/env", () => ({
  env: { supabaseUrl: "https://example.test", supabasePublishableKey: "test-key" },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: vi.fn() }),
  headers: async () => ({ get: () => null }),
}));
import { createClient } from "@/lib/supabase/server";

beforeEach(() => vi.clearAllMocks());
describe("validated studio scope on the SSR client", () => {
  it("keeps identity and login clients unscoped", async () => {
    await createClient("admin");
    expect(state.create.mock.calls[0][2].global).toBeUndefined();
  });
  it("sends the explicit validated studio context to database RPCs", async () => {
    await createClient("admin", "validated-studio");
    expect(state.create.mock.calls[0][2].global.headers).toEqual({
      "x-studio-id": "validated-studio",
    });
  });
  it("keeps student clients unscoped by default", async () => {
    await createClient("student");
    expect(state.create.mock.calls[0][2].global).toBeUndefined();
  });
});
