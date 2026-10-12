import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "owner",
  studioActive: true,
  accountActive: true,
  passwordError: false,
  updateUser: vi.fn(),
  rpc: vi.fn(),
  setCookie: vi.fn(),
  deleteCookie: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: state.setCookie, delete: state.deleteCookie }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } } }),
      updateUser: state.updateUser,
      signOut: vi.fn(),
    },
    rpc: state.rpc,
    from: (table: string) => {
      const rows =
        table === "user_accounts"
          ? { status: state.accountActive ? "active" : "disabled", must_change_password: true }
          : table === "studio_memberships"
            ? [{ studio_id: "studio-1", role: state.role, active: true, person_id: null }]
            : table === "role_capabilities"
              ? [
                  {
                    role: state.role,
                    capability_key:
                      state.role === "instructor" ? "instructor.portal" : "admin.portal",
                  },
                ]
              : state.studioActive
                ? [{ id: "studio-1", status: "active" }]
                : [];
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        maybeSingle: async () => ({ data: rows, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return query;
    },
  }),
}));

import { completeStudioPasswordActivation } from "@/app/auth/actions";

function form() {
  const data = new FormData();
  data.set("password", "Uat-password-123");
  data.set("password_confirmation", "Uat-password-123");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "owner";
  state.studioActive = true;
  state.accountActive = true;
  state.updateUser.mockResolvedValue({ error: null });
  state.rpc.mockResolvedValue({ error: null });
});

describe("studio password activation action", () => {
  it.each(["owner", "admin", "instructor"])(
    "activates %s and routes to its portal",
    async (role) => {
      state.role = role;
      await expect(completeStudioPasswordActivation(form())).rejects.toThrow(
        `redirect:${role === "instructor" ? "/admin/mis-clases" : "/admin"}`,
      );
      expect(state.updateUser).toHaveBeenCalledOnce();
      expect(state.rpc).toHaveBeenCalledWith("studio_complete_password_activation");
      expect(state.setCookie).toHaveBeenCalledWith(
        expect.any(String),
        "studio-1",
        expect.any(Object),
      );
    },
  );
  it("does not change the password when the studio is inactive", async () => {
    state.studioActive = false;
    await expect(completeStudioPasswordActivation(form())).rejects.toThrow(
      "redirect:/login/studio?error=access",
    );
    expect(state.updateUser).not.toHaveBeenCalled();
  });
  it("does not clear the activation requirement when the password update fails", async () => {
    state.updateUser.mockResolvedValue({ error: { message: "rejected" } });
    await expect(completeStudioPasswordActivation(form())).rejects.toThrow(
      "redirect:/login/studio/activar?error=password",
    );
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.setCookie).not.toHaveBeenCalled();
  });
});
