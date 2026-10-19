import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { context, loadBirthdays } = vi.hoisted(() => ({ context: vi.fn(), loadBirthdays: vi.fn() }));
vi.mock("@/lib/auth/admin-context", () => ({ getAdminContext: context }));
vi.mock("@/app/admin/hoy/load-birthdays", () => ({ loadBirthdayStudents: loadBirthdays }));
vi.mock("@/app/admin/hoy/QuickActions", () => ({ default: () => null }));
vi.mock("@/app/admin/hoy/TodayClasses", () => ({ TodayClasses: () => null }));
import AdminPage from "@/app/admin/page";

function setup(role = "owner", canReadStudents = true) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-14T18:00:00Z"));
  const query: unknown = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then")
          return (resolve: (value: unknown) => void) => resolve({ data: [], error: null });
        return () => query;
      },
    },
  );
  context.mockResolvedValue({
    supabase: { from: () => query, rpc: () => query },
    studio: {
      id: "studio-a",
      name: "Demeter",
      timezone: "America/Mexico_City",
      locale: "es-MX",
      currency: "MXN",
    },
    user: { email: "admin@example.test" },
    profile: { full_name: "Admin" },
    membership: { role },
    can: (capability: string) => canReadStudents && capability === "students.read",
  });
  loadBirthdays.mockClear();
  loadBirthdays.mockResolvedValue([
    { id: "ana", name: "Ana García", month: 11, day: 14, packageLabel: "Pole mensual" },
    { id: "bea", name: "Bea López", month: 11, day: 14, packageLabel: "Flex" },
  ]);
}

afterEach(() => vi.useRealTimers());

describe("Hoy birthday page integration and access", () => {
  it("adds the gift and accessible names to the week and the current-day banner", async () => {
    setup();
    const html = renderToStaticMarkup(
      await AdminPage({ searchParams: Promise.resolve({ date: "2026-11-14" }) }),
    );
    expect(html).toContain("cumpleaños de Ana García y Bea López");
    expect(html).toContain('width="13"');
    expect(html).toContain("Hoy cumple");
    expect(html).toContain("Ana García y Bea López");
    expect(loadBirthdays).toHaveBeenCalledWith(expect.anything(), "studio-a", "2026-11-14");
  });
  it("uses the other-day banner and the month selected by the calendar", async () => {
    setup();
    vi.setSystemTime(new Date("2026-11-13T18:00:00Z"));
    const html = renderToStaticMarkup(
      await AdminPage({ searchParams: Promise.resolve({ date: "2026-11-14" }) }),
    );
    expect(html).toContain("Este día cumple");
    const december = renderToStaticMarkup(
      await AdminPage({ searchParams: Promise.resolve({ date: "2026-12-02" }) }),
    );
    expect(december).toContain("Cumpleaños de diciembre");
    expect(december).not.toContain("Ana García");
  });
  it.each(["coach", "instructor", "student"])(
    "does not load or render birthday data for %s",
    async (role) => {
      setup(role);
      const html = renderToStaticMarkup(
        await AdminPage({ searchParams: Promise.resolve({ date: "2026-11-14" }) }),
      );
      expect(loadBirthdays).not.toHaveBeenCalled();
      expect(html).not.toContain("Ana García");
      expect(html).not.toContain("Cumpleaños de noviembre");
    },
  );
  it.each(["owner", "admin", "reception"])(
    "allows existing staff role %s with students.read",
    async (role) => {
      setup(role);
      await AdminPage({ searchParams: Promise.resolve({}) });
      expect(loadBirthdays).toHaveBeenCalledOnce();
    },
  );
  it("reports an unavailable birth field without changing schema or claiming an empty month", async () => {
    setup();
    loadBirthdays.mockRejectedValue(new Error("birthday_field_unavailable"));
    const html = renderToStaticMarkup(await AdminPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("No se pudieron consultar los cumpleaños.");
    expect(html).not.toContain("Sin cumpleaños registrados");
  });
  it("does not load birthdays without the existing read capability", async () => {
    setup("admin", false);
    await AdminPage({ searchParams: Promise.resolve({}) });
    expect(loadBirthdays).not.toHaveBeenCalled();
  });
});
