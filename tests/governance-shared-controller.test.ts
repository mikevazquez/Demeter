import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";

test("governance shared journal and existing executor gate", () => {
  const output = execFileSync(
    process.execPath,
    ["--test", "--test-reporter=tap", "tests/automation/governance-shared.node.mjs"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 25000,
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
    },
  );
  console.log(output);
  expect(output).toContain("# fail 0");
}, 30000);
