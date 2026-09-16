import { readFile } from "node:fs/promises";
import prettier from "prettier";

const files = [
  "app/coach/page.tsx",
  "lib/auth/coach-context.ts",
  "tests/f11-coach-shell-contract.test.ts",
];

for (const file of files) {
  const source = await readFile(file, "utf8");
  const formatted = await prettier.format(source, { filepath: file });
  console.log(`<<<PRETTIER:${file}>>>`);
  console.log(formatted);
  console.log(`<<<END:${file}>>>`);
}

process.exit(1);
