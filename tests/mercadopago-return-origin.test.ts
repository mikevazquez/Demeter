import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const actions = readFileSync("app/student/actions.ts", "utf8");

describe("Mercado Pago return origin", () => {
  it("uses the current request host so the student session cookie survives the return", () => {
    expect(actions).toContain('import { headers } from "next/headers"');
    expect(actions).toContain('requestHeaders.get("x-forwarded-host")');
    expect(actions).toContain('requestHeaders.get("host")');
    expect(actions).toContain('requestHeaders.get("x-forwarded-proto")');
    expect(actions).toContain("await mercadoPagoReturnBaseUrl()");
    expect(actions).not.toContain("VERCEL_PROJECT_PRODUCTION_URL");
  });

  it("keeps return origins restricted to Studio Flow Vercel hosts", () => {
    expect(actions).toContain('hostname === "demeterbueno.vercel.app"');
    expect(actions).toContain('hostname.startsWith("demeterbueno-")');
    expect(actions).toContain('hostname.endsWith("-demeter3.vercel.app")');
  });
});
