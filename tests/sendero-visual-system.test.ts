import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const globals = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const layout = readFileSync(join(process.cwd(), "app/student/layout.tsx"), "utf8");
const nav = readFileSync(join(process.cwd(), "app/student/StudentNav.tsx"), "utf8");
const home = readFileSync(join(process.cwd(), "app/student/page.tsx"), "utf8");

describe("Sendero visual system", () => {
  it("defines the approved Sendero foundations", () => {
    expect(globals).toContain("--sendero-mint: #8fe6c8");
    expect(globals).toContain("--sendero-moon: #f6d67a");
    expect(globals).toContain("--sendero-lilac: #cdb8ec");
    expect(globals).toContain("--sendero-coral: #f28a7a");
    expect(globals).toContain(".sendero-surface");
    expect(globals).toContain(".sendero-button-primary");
  });

  it("uses Marcellus and Montserrat only inside the student Sendero shell", () => {
    expect(layout).toContain('Marcellus');
    expect(layout).toContain('Montserrat');
    expect(layout).toContain('className={\`sendero ');
  });

  it("migrates student navigation to Sendero without changing routes", () => {
    expect(nav).toContain("sendero-desktop-nav");
    expect(nav).toContain("sendero-mobile-nav");
    expect(nav).toContain("studentNavigationItems");
  });

  it("migrates the home surfaces while preserving its data blocks", () => {
    expect(home).toContain('data-home-block="identity-benefits-technical"');
    expect(home).toContain('data-home-block="package"');
    expect(home).toContain('data-home-block="reward-credits"');
    expect(home).toContain('data-home-block="reserved-classes"');
    expect(home).toContain("sendero-surface");
    expect(home).toContain("sendero-button-primary");
    expect(home).toContain("sendero-chip-mint");
  });

  it("keeps existing booking and rewards data sources intact", () => {
    expect(home).toContain('supabase.rpc("student_reward_status_snapshot")');
    expect(home).toContain('supabase.rpc("student_reward_invitation_balance")');
    expect(home).toContain('supabase.rpc("student_classes_feed")');
  });

  it("migrates Reservar to Sendero without changing booking semantics", () => {
    const reserve = readFileSync(join(process.cwd(), "app/student/reservar/page.tsx"), "utf8");
    const quickBook = readFileSync(
      join(process.cwd(), "app/student/reservar/quick-book-button.tsx"),
      "utf8",
    );

    expect(reserve).toContain('supabase.rpc("student_booking_restrictions_snapshot"');
    expect(reserve).toContain('supabase.rpc("student_schedule_feed"');
    expect(reserve).toContain('supabase.rpc("student_waitlist_feed"');
    expect(reserve).toContain("sendero-surface");
    expect(reserve).toContain("bg-[var(--sendero-mint)]");
    expect(quickBook).toContain("bookStudentSessionInlineAction");
    expect(quickBook).toContain("sendero-button-primary");
  });
});
