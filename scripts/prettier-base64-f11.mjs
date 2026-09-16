import { readFile } from "node:fs/promises";
import prettier from "prettier";

const files = [
  "app/coach/actions.ts",
  "app/coach/clases/[sessionId]/page.tsx",
  "app/coach/page.tsx",
  "tests/f11-coach-roster-attendance-contract.test.ts",
  "tests/f11-coach-sessions-contract.test.ts",
];

for (const file of files) {
  const source = await readFile(file, "utf8");
  const formatted = await prettier.format(source, { filepath: file });
  console.log(`B64:${file}:${Buffer.from(formatted, "utf8").toString("base64")}`);
}

process.exit(1);
