// Read-only public GitHub verification. No credential, reservation or SQL access.
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  verifyReservationRuleset,
  RESERVATION_PATTERN,
} from "./metadata-broker-rules.mjs";
export const VERIFIED_RULESET_ID = 25272082;
export const PROTECTION_URL =
  "https://api.github.com/repos/mikevazquez/Demeter/rulesets/" +
  VERIFIED_RULESET_ID;
export async function fetchReservationProtection(fetcher = fetch) {
  try {
    const response = await fetcher(PROTECTION_URL, {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) throw Error();
    const reader = response.body.getReader();
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const n = await reader.read();
        if (n.done) break;
        size += n.value.byteLength;
        if (size > 65536) throw Error();
        chunks.push(Buffer.from(n.value));
      }
    } finally {
      await reader.cancel();
    }
    const rule = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (
      rule.id !== VERIFIED_RULESET_ID ||
      rule.source !== "mikevazquez/Demeter"
    )
      throw Error();
    verifyReservationRuleset(rule);
    return {
      version: 1,
      source: "github-public-ruleset-preflight",
      ruleset_id: VERIFIED_RULESET_ID,
      protection_verified: true,
      pattern: RESERVATION_PATTERN,
      bypass_actors: [],
      restrictions: ["update", "deletion", "non_fast_forward"],
      capture_activated: false,
      sql_executed: false,
      checked_at: new Date().toISOString(),
    };
  } catch {
    throw new Error("Reservation protection preflight denied");
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv.length !== 3) throw Error();
    const report = await fetchReservationProtection();
    writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log(
      "PASS: live reservation protection verified; no reservation, capture or SQL",
    );
  } catch {
    console.error(
      "DENIED: reservation protection not verified; no capture authorization",
    );
    process.exitCode = 1;
  }
}
