import { readFileSync } from "node:fs";

for (const [label, path] of [
  ["PACKAGE_CATALOG", "app/student/paquete/package-catalog.tsx"],
  ["PACKAGE_PAGE", "app/student/paquete/page.tsx"],
]) {
  const content = readFileSync(path);
  console.log(`===${label}_BEGIN===`);
  console.log(content.toString("base64"));
  console.log(`===${label}_END===`);
}
