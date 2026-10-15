import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { selectAuthorizedStudioMembership } from "@/lib/auth/studio-membership-selection";

const tenantA = { studio_id: "tenant-a", role: "admin", active: true };
const tenantB = { studio_id: "tenant-b", role: "student", active: true };

describe("B03 tenant membership selection — synthetic, no database or providers", () => {
  it("keeps the frozen admin context aligned with the tested selection contract", () => {
    const source = readFileSync("lib/auth/admin-context.ts", "utf8");
    expect(source).toContain("memberships.find((item) => item.studio_id === selectedStudioId)");
    expect(source).toContain("memberships.length === 1 ? memberships[0] : null");
    expect(source).toContain(`.eq("active", true)`);
  });

  it("B03-A04: cannot select a foreign tenant with a forged cookie", () => {
    const membership = selectAuthorizedStudioMembership([tenantA, tenantB], "tenant-outsider");
    expect(membership).toBeNull();
  });

  it("B03-A04: honors only a membership belonging to the current user", () => {
    expect(selectAuthorizedStudioMembership([tenantA, tenantB], "tenant-b")).toEqual(tenantB);
    expect(selectAuthorizedStudioMembership([tenantA, tenantB], "tenant-a")).toEqual(tenantA);
  });

  it("B03-A04: cannot create access from an empty membership list", () => {
    expect(selectAuthorizedStudioMembership([], "tenant-b")).toBeNull();
    expect(selectAuthorizedStudioMembership([], null)).toBeNull();
  });

  it("B03-A04: preserves the existing single-studio fallback", () => {
    expect(selectAuthorizedStudioMembership([tenantA], "tenant-outsider")).toEqual(tenantA);
    expect(selectAuthorizedStudioMembership([tenantA])).toEqual(tenantA);
  });

  it("B03-A04: requires a choice when multiple memberships exist and no cookie is selected", () => {
    expect(selectAuthorizedStudioMembership([tenantA, tenantB])).toBeNull();
  });
});
