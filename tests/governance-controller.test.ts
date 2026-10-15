import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";

test("governance decision core and durable local ledger", () => {
  const output = execFileSync(process.execPath, ["--test", "tests/automation/governance.node.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 25000,
    env: { PATH: process.env.PATH ?? "" },
  });
  console.log(output);
  expect(output).toContain("# fail 0");
}, 30000);
