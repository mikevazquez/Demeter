import fs from "node:fs/promises";
import prettier from "prettier";

const files = [
  "app/admin/agenda/page.tsx",
  "app/admin/alumnas/[studentId]/page.tsx",
  "app/admin/ventas/nueva/page.tsx",
];

for (const file of files) {
  const source = await fs.readFile(file, "utf8");
  const config = (await prettier.resolveConfig(file)) ?? {};
  const formatted = await prettier.format(source, { ...config, filepath: file });
  console.log(`PRETTIER_BASE64_START ${file}`);
  console.log(Buffer.from(formatted, "utf8").toString("base64"));
  console.log(`PRETTIER_BASE64_END ${file}`);
}

process.exit(1);
