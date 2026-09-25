import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("ALUMNA UX FINAL · Home approved", () => {
  const home = source("app/student/page.tsx");
  const nav = source("app/student/StudentNav.tsx");

  it("uses the approved dynamic hero with the fixed 3D forms artwork", () => {
    expect(home).toContain('data-home-block="next-class"');
    expect(home).toContain("/student/home/hero-forms.jpg");
    expect(home).toContain("TU PRÓXIMA CLASE");
    expect(home).toContain("Tu lugar está confirmado");
    expect(home).toContain("Hero calendar icon");
    expect(home).not.toContain('className="relative h-[34px] w-[34px] shrink-0 overflow-hidden rounded-full');
  });

  it("removes the calendar and the duplicate next-class card from Home", () => {
    expect(home).not.toContain('aria-label="Tu semana"');
    expect(home).not.toContain("calendarDays");
    expect(home).not.toContain("calendarChip");
    expect(home).not.toContain('data-home-block="space-next-class"');
    expect(home).not.toContain("Tu espacio");
  });

  it("keeps the approved primary actions below the hero", () => {
    expect(home).toContain("Reservar");
    expect(home).toContain("Ver mis clases");
    expect(home).toContain('href="/student/reservar"');
    expect(home).toContain('href="/student/mis-clases"');
  });

  it("uses Lo importante para ti with the four approved cards", () => {
    expect(home).toContain("Lo importante para ti");
    expect(home).toContain('data-home-block="package"');
    expect(home).toContain('data-home-block="medal"');
    expect(home).toContain('data-home-block="evaluation"');
    expect(home).toContain('data-home-block="benefits"');
  });

  it("shows real package and gift-credit information", () => {
    expect(home).toContain("giftClassWallets");
    expect(home).toContain("giftClassesAvailable");
    expect(home).toContain("packageAvailablePercent");
    expect(home).toContain("clases de regalo");
  });

  it("uses the approved first-medal state with real onboarding progress", () => {
    expect(home).toContain("Tu primera medalla 🏅");
    expect(home).toContain("Desbloquea Bronce");
    expect(home).toContain("onboardingCompleted");
    expect(home).toContain("onboardingPercent");
    expect(home).toContain("/student/home/bronze-medal.jpg");
    expect(home).not.toContain('"Por activar"');
  });

  it("keeps technical evaluation separate from rewards", () => {
    expect(home).toContain("Diagnóstico");
    expect(home).toContain("evaluationHref");
    expect(home).not.toContain('data-home-block="technical-level"');
  });

  it("surfaces benefits from reward-level data instead of hardcoding entitlement", () => {
    expect(home).toContain("waitlist_priority");
    expect(home).toContain("private_discount_pct");
    expect(home).toContain("event_discount_pct");
    expect(home).toContain("monthly_guest_invites");
    expect(home).toContain("benefitItems");
  });

  it("lets the mobile shell use the wider approved composition", () => {
    expect(home).toContain('sm:max-w-[430px]');
    expect(nav).toContain('max-w-[406px]');
    expect(nav).not.toContain('max-w-[365px]');
  });

  it("keeps Demeter branding and no public Studio Flow branding", () => {
    expect(home).toContain("D E M E T E R");
    expect(home).toContain("Hola, {snapshot.profile.first_name} 👋");
    expect(home).not.toContain("STUDIO FLOW");
  });
});
