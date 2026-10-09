// Intentional contract replacements must be explicit and backed by passing
// executable tests. Unlisted removals and every new failure still block CI.
export function evaluateTestMigrations(base, candidate, migrations) {
  const baseTests = new Set(base.tests);
  const baseFailures = new Set(base.failures);
  const candidateTests = new Set(candidate.tests);
  const candidatePassed = new Set(candidate.passedTests);
  const removed = base.tests.filter((test) => !candidateTests.has(test));
  const approvedRemovals = [];
  const errors = [];
  const replacements = candidate.tests.filter((test) =>
    test.startsWith(`${migrations.replacementFile} :: `),
  );
  const replacementsPass =
    replacements.length >= migrations.retiredTests.length &&
    replacements.every((test) => candidatePassed.has(test));

  for (const test of removed) {
    const rename = migrations.renames.find((entry) => entry.from === test);
    if (rename) {
      if (candidateTests.has(rename.to) && candidatePassed.has(rename.to)) {
        approvedRemovals.push(test);
      } else errors.push(`Renamed test is missing or failing: ${rename.to}`);
    } else if (migrations.retiredTests.includes(test)) {
      if (baseFailures.has(test) && replacementsPass) approvedRemovals.push(test);
      else
        errors.push(
          `Retired contract needs a failing baseline and passing V2 replacements: ${test}`,
        );
    }
  }

  // A manifest cannot silently rename a test to another pre-existing test.
  for (const rename of migrations.renames) {
    if (removed.includes(rename.from) && baseTests.has(rename.to)) {
      errors.push(`Rename target already existed in baseline: ${rename.to}`);
    }
  }

  return {
    approvedRemovals,
    unapprovedRemovals: removed.filter((test) => !approvedRemovals.includes(test)),
    errors,
  };
}
