import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseSupportRequests, supportRequestErrorCode } from "@/lib/platform/support-requests";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261023163000_neb01_support_requests.sql");

describe("NEB-01-19 solicitudes de soporte", () => {
  it("lee la bandeja", () => {
    const [request] = parseSupportRequests([
      {
        id: "r1",
        studio_id: "s1",
        studio_name: "Aurora",
        subject: "Precios",
        body: "",
        status: "resolved",
        created_at: "2026-10-23T10:00:00Z",
        resolved_at: "2026-10-23T11:00:00Z",
        response: "Listo",
      },
    ]);
    expect(request).toMatchObject({ studioName: "Aurora", status: "resolved", response: "Listo" });
    expect(parseSupportRequests(null)).toEqual([]);
  });

  it("traduce los errores conocidos", () => {
    expect(supportRequestErrorCode("support_too_many_open")).toBe("support_too_many_open");
    expect(supportRequestErrorCode("otra cosa")).toBe("error");
  });

  it("la tabla no se abre y las funciones piden permiso", () => {
    expect(migration).toContain(
      "revoke all on table public.support_requests from anon, authenticated;",
    );
    expect(migration).toContain("private.has_capability(p_studio, 'settings.write')");
    expect(migration).toContain("private.platform_require_admin()");
    expect(migration).toContain("'support.request.created'");
    expect(migration).toContain("'support.request.resolved'");
    for (const fn of [
      "studio_create_support_request(uuid, text, text)",
      "studio_support_requests(uuid)",
      "platform_support_requests(text)",
      "platform_resolve_support_request(uuid, text)",
    ]) {
      expect(migration).toContain(`revoke all on function public.${fn} from public, anon;`);
    }
  });
});
