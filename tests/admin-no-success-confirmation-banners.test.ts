import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function filesRecursively(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? filesRecursively(path) : [path];
  });
}

describe("Studio Flow admin success feedback rule", () => {
  it("does not use persistent top confirmation banners for successful actions", () => {
    const adminDir = join(process.cwd(), "app/admin");
    const files = filesRecursively(adminDir).filter((path) => /\.(ts|tsx)$/.test(path));

    const forbidden = [
      "?saved=",
      "?created=1",
      "?published=1",
      "Cambios guardados correctamente",
      "guardado correctamente",
      "guardados correctamente",
      "actualizada correctamente",
      "actualizado correctamente",
      "publicada para la alumna",
    ];

    const violations = files.flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return forbidden
        .filter((token) => source.includes(token))
        .map((token) => `${path}: ${token}`);
    });

    expect(
      violations,
      "Successful actions must confirm themselves through updated UI state; persistent top banners are reserved for actionable errors.",
    ).toEqual([]);
  });
});
