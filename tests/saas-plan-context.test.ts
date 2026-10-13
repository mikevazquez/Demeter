import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  effective: ["admin.portal", "students.read"],
  error: null as null | { message: string },
  signOut: vi.fn(),
  clients: vi.fn(),
}));

vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "studio-1" }) }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async (...args: unknown[]) => {
    state.clients(...args);
    return {
      auth: {
        getUser: async () => ({ data: { user: { id: "owner-1" } }, error: null }),
        signOut: state.signOut,
      },
      rpc: async () => ({
        data: state.effective.map((capability_key) => ({ capability_key })),
        error: state.error,
      }),
      from: (table: string) => {
        const data =
          table === "user_accounts"
            ? { status: "active" }
            : table === "studio_memberships"
              ? [{ studio_id: "studio-1", role: "owner", active: true }]
              : table === "studios"
                ? { id: "studio-1", status: "active" }
                : table === "role_capabilities"
                  ? ["admin.portal", "students.read", "reports.read"].map((capability_key) => ({
                      capability_key,
                    }))
                  : { full_name: "Owner" };
        const q = {
          select: () => q,
          eq: () => q,
          single: async () => ({ data, error: null }),
          maybeSingle: async () => ({ data, error: null }),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data, error: null }).then(resolve),
        };
        return q;
      },
    };
  },
}));

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

beforeEach(() => {
  vi.clearAllMocks();
  state.effective = ["admin.portal", "students.read"];
  state.error = null;
});

describe("SaaS plan authorization after authentication", () => {
  it("filters role capabilities using the selected studio plan", async () => {
    const ctx = await getAdminContext();
    expect(state.clients.mock.calls).toEqual([["admin"], ["admin", "studio-1"]]);
    expect(ctx.can(CAPABILITIES.STUDENTS_READ)).toBe(true);
    expect(ctx.can(CAPABILITIES.REPORTS_READ)).toBe(false);
  });
  it("does not grant a capability absent from the caller role", async () => {
    state.effective.push("evaluations.read");
    const ctx = await getAdminContext();
    expect(ctx.can(CAPABILITIES.EVALUATIONS_READ)).toBe(false);
  });
  it("routes an owner to subscription recovery without signing out", async () => {
    await expect(getAdminContext(CAPABILITIES.REPORTS_READ)).rejects.toThrow(
      "redirect:/admin/suscripcion?error=plan_access",
    );
    expect(state.signOut).not.toHaveBeenCalled();
  });
  it("preserves authentication if the plan service is temporarily unavailable", async () => {
    state.error = { message: "temporarily unavailable" };
    await expect(getAdminContext()).rejects.toThrow("admin_plan_lookup_temporarily_unavailable");
    expect(state.signOut).not.toHaveBeenCalled();
  });
});
