// Live no-secret rehearsal. A valid signature is NOT production authorization.
// Never persist a token or log an error from the token/JWKS endpoints.
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  OIDC_AUDIENCE,
  loadGitHubPublicKeys,
  verifyGitHubOidcSignature,
  authenticateController,
} from "./metadata-broker-identity.mjs";
const BRANCH = "refs/heads/feat/sf-gov-metadata-broker-prototype-20261016";
const WORKFLOW =
  "mikevazquez/Demeter/.github/workflows/metadata-broker-oidc-rehearsal.yml@" +
  BRANCH;
const CONTROLLER_SHA = "4a989e96ccb5caeb831953f93a90d1d0d89304c3";
export async function rehearseOidc({
  requestUrl,
  requestToken,
  sourceSha,
  fetcher = fetch,
  now = () => new Date(),
}) {
  let stage = "configuration";
  try {
    if (
      typeof requestToken !== "string" ||
      !requestToken ||
      !/^[0-9a-f]{40}$/.test(sourceSha ?? "")
    )
      throw Error();
    const url = new URL(requestUrl);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".actions.githubusercontent.com") ||
      url.username ||
      url.password ||
      url.hash
    )
      throw Error();
    url.searchParams.set("audience", OIDC_AUDIENCE);
    stage = "token_request";
    const r = await fetcher(url.href, {
      headers: { Authorization: "Bearer " + requestToken },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw Error();
    const reader = r.body.getReader();
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const n = await reader.read();
        if (n.done) break;
        size += n.value.byteLength;
        if (size > 32768) throw Error();
        chunks.push(Buffer.from(n.value));
      }
    } finally {
      await reader.cancel();
    }
    stage = "token_response";
    const token = JSON.parse(Buffer.concat(chunks).toString("utf8")).value;
    stage = "public_keys";
    const keys = await loadGitHubPublicKeys(fetcher);
    stage = "signature";
    const verifiedAt = typeof now === "function" ? now() : now;
    let c;
    try {
      c = verifyGitHubOidcSignature(token, keys, verifiedAt);
    } catch (error) {
      if (
        [
          "token_format",
          "jwt_header",
          "public_key",
          "signature",
          "token_time",
          "issuer_audience",
        ].includes(error.code)
      )
        stage = error.code;
      throw Error();
    }
    stage = "rehearsal_claims";
    if (
      c.repository !== "mikevazquez/Demeter" ||
      c.repository_id !== "1370494017" ||
      c.sha !== sourceSha ||
      c.workflow_sha !== sourceSha ||
      c.ref !== BRANCH ||
      c.workflow_ref !== WORKFLOW ||
      c.event_name !== "push" ||
      c.environment !== undefined
    )
      throw Error();
    stage = "production_denial";
    let productionDenied = false;
    try {
      authenticateController(
        token,
        keys,
        { controller_sha: CONTROLLER_SHA },
        verifiedAt,
      );
    } catch {
      productionDenied = true;
    }
    const parts = token.split(".");
    const altered = { ...c, sha: "f".repeat(40) };
    parts[1] = Buffer.from(JSON.stringify(altered)).toString("base64url");
    let tamperDenied = false;
    try {
      verifyGitHubOidcSignature(parts.join("."), keys, verifiedAt);
    } catch {
      tamperDenied = true;
    }
    if (!productionDenied || !tamperDenied) throw Error();
    return {
      version: 1,
      source: "github-actions-live-oidc-rehearsal",
      signature_verified: true,
      jwt_header_fields: Object.keys(
        JSON.parse(Buffer.from(token.split(".")[0], "base64url")),
      ).sort(),
      production_identity_denied: true,
      tampered_token_denied: true,
      release_eligible: false,
      source_sha: sourceSha,
      run_id: c.run_id,
      run_attempt: c.run_attempt,
      ref: c.ref,
      workflow_ref: c.workflow_ref,
      protected_environment_requested: false,
      sql_executed: false,
    };
  } catch {
    throw Object.assign(
      new Error("OIDC rehearsal denied; no production authorization"),
      { code: stage },
    );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv.length !== 3) throw Error();
    const report = await rehearseOidc({
      requestUrl: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
      requestToken: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
      sourceSha: process.env.GITHUB_SHA,
    });
    writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log(
      "PASS: live OIDC signature verified; production identity denied; no SQL",
    );
  } catch (error) {
    console.error(
      "DENIED: OIDC rehearsal incomplete; no production authorization [" +
        (error.code ?? "configuration") +
        "]",
    );
    process.exitCode = 1;
  }
}
