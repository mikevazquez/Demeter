import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const core = readFileSync(
  join(process.cwd(), "supabase/migrations/20260921003000_sf255_reward_status_core.sql"),
  "utf8",
);
const waitlist = readFileSync(
  join(process.cwd(), "supabase/migrations/20260921004500_sf255_waitlist_priority.sql"),
  "utf8",
);
const creditFix = readFileSync(
  join(process.cwd(), "supabase/migrations/20260921005200_sf255_waitlist_credit_fix.sql"),
  "utf8",
);
const reservePage = readFileSync(join(process.cwd(), "app/student/reservar/page.tsx"), "utf8");
const detailPage = readFileSync(
  join(process.cwd(), "app/student/reservar/[sessionId]/page.tsx"),
  "utf8",
);
const classesPage = readFileSync(join(process.cwd(), "app/student/mis-clases/page.tsx"), "utf8");
const waitlistControl = readFileSync(
  join(process.cwd(), "app/student/reservar/WaitlistControl.tsx"),
  "utf8",
);
const homePage = readFileSync(join(process.cwd(), "app/student/page.tsx"), "utf8");
const profilePage = readFileSync(join(process.cwd(), "app/student/perfil/page.tsx"), "utf8");

describe("SF-255A monthly level and waitlist contracts", () => {
  it("keeps the approved four deterministic levels", () => {
    expect(core).toContain("('bronze', 1, 'Bronce', 4, null::integer, 0, 15, 1, 5, 5, 0)");
    expect(core).toContain("('silver', 2, 'Plata', 6, 8, 2, 10, 2, 10, 10, 0)");
    expect(core).toContain("('gold', 3, 'Oro', 8, 12, 4, 7, 3, 15, 15, 1)");
    expect(core).toContain("('diamond', 4, 'Diamante', 10, 16, 6, 3, 4, 20, 20, 2)");
    expect(core).toContain("maintenance_attendance");
    expect(core).toContain("promotion_attendance");
  });

  it("limits monthly movement and preserves the Bronze floor", () => {
    expect(core).toContain("v_to_level := v_next_level");
    expect(core).toContain("elsif v_from_level = 'bronze' then");
    expect(core).toContain("v_outcome := 'floor'");
    expect(core).toContain("v_outcome := 'partial_month'");
  });

  it("orders waitlist by current level and FIFO without public position", () => {
    expect(waitlist).toContain("order by d.level_order desc, w.joined_at asc, w.id asc");
    expect(waitlist).not.toContain("position_number");
    expect(waitlist).not.toContain("rank()");
  });

  it("revalidates eligibility and holds credit on automatic promotion", () => {
    expect(waitlist).toContain("private.waitlist_eligibility_core");
    expect(creditFix).toContain("from public.credit_ledger cl");
    expect(creditFix).toContain("'reserve'");
    expect(creditFix).toContain("'source', 'waitlist'");
  });

  it("uses the approved waitlist copy and visual states", () => {
    expect(reservePage).toContain("student_waitlist_feed");
    expect(detailPage).toContain("WaitlistControl");
    expect(waitlistControl).toContain("Unirme a lista de espera");
    expect(classesPage).toContain("En lista de espera");
    expect(classesPage).toContain("Te avisaremos si se libera un lugar.");
    expect(classesPage).toContain("border-amber-400");
  });

  it("integrates the approved level composition into Home and keeps Profile clean", () => {
    expect(homePage).toContain("student_reward_status_snapshot");
    expect(homePage).toContain("reward_status_memberships");
    expect(homePage).toContain("reward_status_level_definitions");
    expect(homePage).toContain('data-home-block="identity-level"');
    expect(homePage).toContain("Mi nivel");
    expect(homePage).toContain("Ver mis beneficios");
    expect(homePage).toContain("Mantener");
    expect(homePage).toContain("Camino a");
    expect(homePage).toContain("#CD7F32");
    expect(homePage).toContain("#C0C0C0");
    expect(homePage).toContain("#D4AF37");
    expect(homePage).toContain("#5EDFFF");
    expect(homePage).toContain('data-density="compact"');
    expect(homePage).toContain("px-3.5 py-2.5");
    expect(profilePage).toContain('data-profile-block="package"');
    expect(profilePage).not.toContain("student_reward_status_snapshot");
    expect(profilePage).not.toContain("Nivel actual");
    expect(profilePage).not.toContain("Tus beneficios");
  });
});
