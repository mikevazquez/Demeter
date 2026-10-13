import { describe, expect, it } from "vitest";
import { canActivateStudioAccount } from "@/lib/saas/studio-activation";

describe("studio account activation", () => {
  it.each(["owner", "admin", "instructor"])("allows an active %s membership", (role) => {
    expect(canActivateStudioAccount([role])).toBe(true);
  });
  it("does not grant activation to student or unknown roles", () => {
    expect(canActivateStudioAccount(["student", "guest"])).toBe(false);
    expect(canActivateStudioAccount([])).toBe(false);
  });
  it("accepts an eligible membership when the account belongs to several studios", () => {
    expect(canActivateStudioAccount(["student", "owner"])).toBe(true);
  });
});
