import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("DOCUMENTOS-01 booking blocker freshness", () => {
  const reserve = source("app/student/reservar/page.tsx");
  const detail = source("app/student/reservar/[sessionId]/page.tsx");
  const confirm = source("app/student/reservar/[sessionId]/confirmar/page.tsx");
  const refresh = source("app/student/reservar/BookingEligibilityRefresh.tsx");
  const nav = source("app/student/StudentNav.tsx");

  it("keeps eligibility-sensitive reservation screens dynamic", () => {
    for (const file of [reserve, detail, confirm]) {
      expect(file).toContain('export const dynamic = "force-dynamic"');
      expect(file).toContain("export const revalidate = 0");
    }
  });

  it("refreshes the reserve screen when the portal regains focus", () => {
    expect(reserve).toContain("<BookingEligibilityRefresh />");
    expect(refresh).toContain('window.addEventListener("focus", refresh)');
    expect(refresh).toContain('document.addEventListener("visibilitychange", onVisibility)');
    expect(refresh).toContain("router.refresh()");
  });

  it("does not prefetch the reserve route with stale eligibility", () => {
    expect(nav).toContain('prefetch={item.href === "/student/reservar" ? false : undefined}');
  });
});
