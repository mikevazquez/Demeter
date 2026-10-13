import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const clientRoles = new Set(["anon", "authenticated", "public"]);
const dangerousPrivileges = new Set(["all", "truncate", "trigger", "references", "maintain"]);

function removeSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/--[^\n]*/g, (comment) => " ".repeat(comment.length));
}

export function inspectMigrationGrants(sql) {
  const clean = removeSqlComments(sql);
  const findings = [];
  let offset = 0;

  for (const fragment of clean.split(";")) {
    const first = fragment.search(/\S/);
    const statement = fragment.replace(/\s+/g, " ").trim();
    const line = 1 + (clean.slice(0, offset + Math.max(first, 0)).match(/\n/g) ?? []).length;
    offset += fragment.length + 1;

    if (!/^(?:GRANT\b|ALTER\s+DEFAULT\s+PRIVILEGES\b)/i.test(statement)) {
      continue;
    }

    const grant = statement.match(
      /\bGRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+(.+?)(?:\s+WITH\s+GRANT\s+OPTION)?$/i,
    );
    if (!grant) continue;

    const [, privileges, object, recipients] = grant;
    if (
      /^(?:(?:ALL\s+)?(?:SEQUENCES?|FUNCTIONS?|PROCEDURES?|ROUTINES?)|SCHEMAS?|TYPES?|DATABASES?|LANGUAGES?|TABLESPACES?)\b/i.test(
        object,
      )
    ) {
      continue;
    }

    const roles = recipients
      .split(",")
      .map((role) => role.trim().replace(/^"|"$/g, "").toLowerCase())
      .filter((role) => clientRoles.has(role));
    if (roles.length === 0) continue;

    const unsafe = privileges
      .split(",")
      .map((privilege) => privilege.trim().toLowerCase())
      .filter((privilege) => dangerousPrivileges.has(privilege.replace(/\s+privileges$/, "")));
    if (unsafe.length === 0) continue;

    findings.push({ line, roles, privileges: unsafe, statement });
  }

  return findings;
}

function changedMigrations(baseSha) {
  if (!/^[a-f\d]{40}$/i.test(baseSha ?? "")) {
    throw new Error("Expected a 40-character base commit SHA for migration grant checks");
  }

  const args =
    baseSha === "0".repeat(40)
      ? ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD", "--", "supabase/migrations"]
      : [
          "diff",
          "--name-only",
          "--diff-filter=ACMR",
          baseSha + "...HEAD",
          "--",
          "supabase/migrations",
        ];

  return execFileSync("git", args, { encoding: "utf8" })
    .split(/\r?\n/)
    .filter((path) => /^supabase\/migrations\/[\w./-]+\.sql$/.test(path));
}

function main() {
  const files = changedMigrations(process.argv[2] ?? process.env.TEST_BASE_SHA);
  const findings = [];

  for (const path of files) {
    for (const issue of inspectMigrationGrants(readFileSync(path, "utf8"))) {
      findings.push(
        path + ":" + issue.line + " " + issue.privileges.join(", ") + " to " + issue.roles.join(", "),
      );
    }
  }

  if (findings.length > 0) {
    console.error("Unsafe table grants to client roles in changed SQL migrations:");
    for (const finding of findings) console.error("- " + finding);
    console.error(
      "Grant only necessary DML and enforce RLS. Existing historical debt is tracked in issue #280.",
    );
    process.exitCode = 1;
    return;
  }

  console.log("Migration grant guard passed: " + files.length + " changed SQL migrations checked.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
