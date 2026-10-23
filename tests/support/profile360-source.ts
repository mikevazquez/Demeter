import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * P360-V2-08 · El Perfil 360 dejó de ser un solo archivo: la lectura vive en
 * `load-profile-360.ts`, el encabezado en `Profile360Header.tsx` y cada pestaña en `tabs/`.
 * Los contratos que antes leían `page.tsx` leen el conjunto completo del perfil.
 */
export function profile360Source() {
  const root = join(process.cwd(), "app/admin/alumnas/[studentId]");
  const files = [
    "page.tsx",
    "load-profile-360.ts",
    "profile-format.ts",
    "profile-pending.ts",
    "profile-tabs.ts",
    "Profile360Header.tsx",
    ...readdirSync(join(root, "tabs"))
      .filter((file) => file.endsWith(".tsx"))
      .sort()
      .map((file) => join("tabs", file)),
  ];
  return files.map((file) => readFileSync(join(root, file), "utf8")).join("\n");
}
