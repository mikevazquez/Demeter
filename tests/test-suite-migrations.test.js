import { describe, expect, it } from "vitest";
import { evaluateTestMigrations } from "../scripts/test-suite-migrations.mjs";

const old = "old.test.ts :: old contract";
const replacement = "new.test.ts :: runtime regression";
const manifest = { replacementFile: "new.test.ts", retiredTests: [old], renames: [] };
const base = { tests: [old], failures: [old] };
const candidate = { tests: [replacement], passedTests: [replacement], failures: [] };

describe("explicit test migrations", () => {
  it("permits documented failing contracts only when replacements execute and pass", () => {
    expect(evaluateTestMigrations(base, candidate, manifest)).toEqual({
      approvedRemovals: [old],
      unapprovedRemovals: [],
      errors: [],
    });
  });

  it.each([
    { tests: [], passedTests: [], failures: [] },
    { tests: [replacement], passedTests: [], failures: [] },
    { tests: [replacement], passedTests: [], failures: [replacement] },
  ])("rejects missing or failing replacement suites: %j", (result) => {
    const check = evaluateTestMigrations(base, result, manifest);
    expect(check.unapprovedRemovals).toEqual([old]);
    expect(check.errors).toHaveLength(1);
  });

  it("does not retire a passing baseline contract", () => {
    expect(
      evaluateTestMigrations({ tests: [old], failures: [] }, candidate, manifest).errors,
    ).toHaveLength(1);
  });

  it("does not allow unlisted deletions", () => {
    expect(
      evaluateTestMigrations({ tests: ["unexpected"], failures: [] }, candidate, manifest)
        .unapprovedRemovals,
    ).toEqual(["unexpected"]);
  });

  it("permits an exact rename only if the target executes and passes", () => {
    const config = { ...manifest, retiredTests: [], renames: [{ from: old, to: replacement }] };
    expect(evaluateTestMigrations(base, candidate, config).approvedRemovals).toEqual([old]);
    expect(
      evaluateTestMigrations(
        base,
        { tests: [replacement], passedTests: [], failures: [replacement] },
        config,
      ).unapprovedRemovals,
    ).toEqual([old]);
  });

  it("rejects mapping a removal to an already-existing test", () => {
    const config = { ...manifest, retiredTests: [], renames: [{ from: old, to: replacement }] };
    const check = evaluateTestMigrations(
      { tests: [old, replacement], failures: [old] },
      candidate,
      config,
    );
    expect(check.errors).toHaveLength(1);
  });

  it("requires at least as many passing replacement cases as retired contracts", () => {
    const config = { ...manifest, retiredTests: [old, "another old contract"] };
    expect(evaluateTestMigrations(base, candidate, config).unapprovedRemovals).toEqual([old]);
  });
});
