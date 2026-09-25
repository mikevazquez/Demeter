import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("SF-240 Progress & Rewards Portal Alumna v2", () => {
  it("keeps the final four-destination student navigation", () => {
    const nav = read("app/student/StudentNav.tsx");

    expect(nav).toContain('href: "/student"');
    expect(nav).toContain('href: "/student/reservar"');
    expect(nav).toContain('href: "/student/mis-clases"');
    expect(nav).toContain('href: "/student/perfil"');
    expect(nav).not.toContain('label: "Retos"');
    expect(nav).not.toContain('href: "/student/recompensas"');
    expect(nav).toContain('"/student/retos"');
    expect(nav).toContain("grid-cols-4");
  });

  it("keeps Medallas y beneficios in Perfil while Retos stays inside that loyalty universe", () => {
    const home = read("app/student/page.tsx");
    const profile = read("app/student/perfil/page.tsx");
    const nav = read("app/student/StudentNav.tsx");

    expect(home).not.toContain('data-home-block="progress"');
    expect(home).not.toContain('href="/student/recompensas"');
    expect(profile).toContain('href="/student/recompensas"');
    expect(profile).toContain("Medallas y beneficios");
    expect(profile).toContain("Mi medalla y beneficios");
    expect(profile).toContain('title="Retos"');
    expect(profile).toContain('title="Logros"');
    expect(profile).toContain('title="Recompensas"');
    expect(nav).not.toContain('label: "Retos"');
    expect(nav).toContain('"/student/retos"');
  });

  it("keeps Medallas y beneficios as a simple loyalty landing", () => {
    const page = read("app/student/recompensas/page.tsx");

    expect(page).toContain("Medallas y beneficios");
    expect(page).toContain("Tu medalla");
    expect(page).toContain("Tus beneficios");
    expect(page).toContain("Tu avance de este mes");
    expect(page).toContain("Puedes obtener directamente cualquier medalla");
    expect(page).toContain('href="/student/retos"');
    expect(page).toContain('href="/student/recompensas/logros"');
    expect(page).toContain('href="/student/recompensas/mis-recompensas"');
    expect(page).not.toContain("Lo más cerca de conseguir");
    expect(page).not.toContain("Mis programas");
    expect(page).not.toContain("Rachas");
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

  it("uses the canonical Retos experience with exact progress and competitive states", () => {
    const home = read("app/student/retos/page.tsx");
    const page = read("app/student/retos/[ruleId]/page.tsx");

    expect(home).toContain("Medallas y beneficios");
    expect(home).toContain("{challenge.current_value} de {target}");
    expect(home).toContain("Te faltan");
    expect(page).toContain("Top 3");
    expect(page).toContain("gap_to_top3");
    expect(page).toContain("Recompensa");
    expect(page).toContain("clases extra");
    expect(page).not.toContain("sección de Rewards");
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
