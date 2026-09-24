import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("SF-240 Progress & Rewards Portal Alumna v2", () => {
  it("keeps the primary student navigation focused on four everyday destinations", () => {
    const nav = read("app/student/StudentNav.tsx");

    expect(nav).toContain('href: "/student"');
    expect(nav).toContain('href: "/student/reservar"');
    expect(nav).toContain('href: "/student/mis-clases"');
    expect(nav).not.toContain('href: "/student/retos"');
    expect(nav).toContain('href: "/student/perfil"');
    expect(nav).not.toContain('href: "/student/recompensas"');
    expect(nav).toContain("grid-cols-4");
  });

  it("keeps progress and challenges discoverable without competing in primary navigation", () => {
    const home = read("app/student/page.tsx");
    const profile = read("app/student/perfil/page.tsx");

    expect(home).toContain('data-home-block="progress"');
    expect(home).toContain('href="/student/recompensas"');
    expect(home).toContain('href="/student/retos"');
    expect(profile).toContain('href="/student/recompensas"');
    expect(profile).toContain("Rewards");
    expect(profile).toContain("Medallas, beneficios y recompensas obtenidas");
  });

  it("keeps the Rewards hub for loyalty history and benefits", () => {
    const page = read("app/student/recompensas/page.tsx");

    expect(page).toContain("Consulta tus programas de fidelidad, logros y recompensas.");
    expect(page).toContain("Lo más cerca de conseguir");
    expect(page).toContain("Mis programas");
    expect(page).toContain("Retos activos");
    expect(page).toContain("Rachas");
    expect(page).toContain("Logros recientes");
    expect(page).toContain("Recompensas disponibles");
    expect(page).toContain('href="/student/recompensas/trayectoria"');
  });

  it("implements S02 program-specific progress with secret levels protected", () => {
    const page = read("app/student/recompensas/programas/[participationId]/page.tsx");

    expect(page).toContain("Tu objetivo actual");
    expect(page).toContain("Progreso exacto");
    expect(page).toContain("Tu racha");
    expect(page).toContain("Tu camino en el programa");
    expect(page).toContain("Nivel secreto");
    expect(page).toContain("Recompensa sorpresa");
    expect(page).toContain("Conseguido");
    expect(page).toContain("En progreso");
    expect(page).toContain("Bloqueado");
  });

  it("implements S03 challenge states and automatic participation copy", () => {
    const page = read("app/student/recompensas/retos/[participationId]/page.tsx");

    expect(page).toContain("Reto especial");
    expect(page).toContain("Próximamente");
    expect(page).toContain("Periodo no completado");
    expect(page).toContain("Finalizado");
    expect(page).toContain("¡Reto completado!");
    expect(page).toContain("Recompensa sorpresa");
    expect(page).toContain("Sin recompensa económica");
    expect(page).toContain("no necesitas inscribirte manualmente");
  });

  it("implements S04 achievements with unlocked, progress and secret states", () => {
    const page = read("app/student/recompensas/logros/page.tsx");

    expect(page).toContain("Cada clase cuenta. Aquí está tu trayectoria.");
    expect(page).toContain("Conseguidos");
    expect(page).toContain("En progreso");
    expect(page).toContain("secretos");
    expect(page).toContain("Programas");
    expect(page).toContain("Retos");
    expect(page).toContain("Independientes");
    expect(page).toContain("Algunos logros se revelan");
  });

  it("implements S05 reward availability and approved historical states", () => {
    const page = read("app/student/recompensas/mis-recompensas/page.tsx");
    const detail = read("app/student/recompensas/recompensa/[rewardId]/page.tsx");

    expect(page).toContain("Recompensas disponibles");
    expect(page).toContain("Utilizadas");
    expect(page).toContain("Vencidas");
    expect(page).toContain("Ajustadas");
    expect(page).toContain("Aplicación automática");
    expect(page).toContain("En uso");
    expect(detail).toContain("no se utiliza parcialmente");
    expect(detail).toContain("sobrante no se guarda como saldo");
  });

  it("implements S06 chronological journey with approved filters", () => {
    const page = read("app/student/recompensas/trayectoria/page.tsx");

    expect(page).toContain("Mi trayectoria");
    expect(page).toContain('{ key: "all", label: "Todo" }');
    expect(page).toContain('{ key: "achievement", label: "Logros" }');
    expect(page).toContain('{ key: "program", label: "Programas" }');
    expect(page).toContain('{ key: "challenge", label: "Retos" }');
    expect(page).toContain('{ key: "reward", label: "Recompensas" }');
    expect(page).toContain("Nivel conseguido");
    expect(page).toContain("Programa completado");
    expect(page).toContain("Reto completado");
    expect(page).toContain("Nueva racha");
    expect(page).toContain("Tu trayectoria empieza aquí");
  });

  it("loads programs, levels, challenges, achievements, rewards and permanent events from one read model", () => {
    const model = read("lib/student/rewards.ts");

    expect(model).toContain('from("reward_program_participations")');
    expect(model).toContain('from("reward_program_levels")');
    expect(model).toContain('from("reward_program_level_unlocks")');
    expect(model).toContain('from("reward_program_events")');
    expect(model).toContain('from("reward_participations")');
    expect(model).toContain('from("reward_progress_snapshots")');
    expect(model).toContain('from("reward_achievement_unlocks")');
    expect(model).toContain('from("reward_instances")');
    expect(model).toContain('from("reward_instance_events")');
  });
});
