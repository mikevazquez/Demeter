import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
  const temp = path.join(os.tmpdir(), `prettier-${Buffer.from(file).toString("hex")}.txt`);
  await fs.writeFile(temp, formatted, "utf8");
  console.log(`PRETTIER_DIFF_START ${file}`);
  const result = spawnSync("diff", ["-u", "--label", `${file}:current`, "--label", `${file}:prettier`, file, temp], {
    encoding: "utf8",
  });
  process.stdout.write(result.stdout || "(no diff)\n");
  console.log(`PRETTIER_DIFF_END ${file}`);
}

process.exit(1);
