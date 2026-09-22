import fs from "node:fs";
import path from "node:path";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("KIOSCO-01 admin roster parity", () => {
  it("gives admin a dedicated live roster view with attendance controls", () => {
    const rosterPage = source("app/admin/agenda/[sessionId]/roster/page.tsx");
    const sessionPage = source("app/admin/agenda/[sessionId]/page.tsx");

    expect(rosterPage).toContain("getAdminContext(CAPABILITIES.ATTENDANCE_WRITE)");
    expect(rosterPage).toContain("<SessionOperations");
    expect(rosterPage).toContain("canAttendance");
    expect(rosterPage).toContain("ROSTER EN VIVO");
    expect(sessionPage).toContain("Ver roster en vivo");
    expect(sessionPage).toContain("/roster");
  });

  it("keeps admin on the admin surface instead of requiring instructor context", () => {
    const rosterPage = source("app/admin/agenda/[sessionId]/roster/page.tsx");

    expect(rosterPage).not.toContain("getCoachContext");
    expect(rosterPage).not.toContain("/coach/");
  });
});
