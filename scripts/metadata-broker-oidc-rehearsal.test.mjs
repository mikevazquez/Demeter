import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, sign } from "node:crypto";
import { rehearseOidc } from "./metadata-broker-oidc-rehearsal.mjs";
import {
  OIDC_AUDIENCE,
  OIDC_ISSUER,
  OIDC_JWKS_URL,
} from "./metadata-broker-identity.mjs";
const at = new Date("2026-10-16T14:00:00.000Z"),
  seconds = at.getTime() / 1000,
  sha = "a".repeat(40);
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwks = {
  keys: [
    {
      ...publicKey.export({ format: "jwk" }),
      kid: "rehearsal",
      alg: "RS256",
      use: "sig",
    },
  ],
};
const branch = "refs/heads/feat/sf-gov-metadata-broker-prototype-20261016";
const claims = () => ({
  iss: OIDC_ISSUER,
  aud: OIDC_AUDIENCE,
  iat: seconds,
  nbf: seconds - 5,
  exp: seconds + 300,
  repository: "mikevazquez/Demeter",
  repository_id: "1370494017",
  sha,
  workflow_sha: sha,
  ref: branch,
  workflow_ref:
    "mikevazquez/Demeter/.github/workflows/metadata-broker-oidc-rehearsal.yml@" +
    branch,
  event_name: "push",
  run_id: "555",
  run_attempt: "1",
});
function fixture(patch = {}) {
  const input = [
    { alg: "RS256", kid: "rehearsal", typ: "JWT" },
    { ...claims(), ...patch },
  ]
    .map((x) => Buffer.from(JSON.stringify(x)).toString("base64url"))
    .join(".");
  return (
    input +
    "." +
    sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")
  );
}
function config(patch = {}) {
  return {
    requestUrl: "https://vstoken.actions.githubusercontent.com/request",
    requestToken: "fake-ephemeral-request-credential",
    sourceSha: sha,
    now: at,
    fetcher: async (url, options) => {
      if (url === OIDC_JWKS_URL) return new Response(JSON.stringify(jwks));
      assert.equal(new URL(url).searchParams.get("audience"), OIDC_AUDIENCE);
      assert.equal(options.redirect, "error");
      return new Response(JSON.stringify({ value: fixture() }));
    },
    ...patch,
  };
}
test("rehearsal accepts a signed isolated identity but rejects production and altered token", async () => {
  const report = await rehearseOidc(config());
  assert.equal(report.signature_verified, true);
  assert.equal(report.production_identity_denied, true);
  assert.equal(report.tampered_token_denied, true);
  assert.equal(report.release_eligible, false);
  assert.equal(report.sql_executed, false);
  assert.ok(
    !JSON.stringify(report).includes("fake-ephemeral-request-credential"),
  );
  assert.ok(!JSON.stringify(report).includes(fixture()));
});
test("invalid endpoints cannot receive the ephemeral request credential", async () => {
  for (const requestUrl of [
    "http://vstoken.actions.githubusercontent.com",
    "https://evil.example",
    "https://vstoken.actions.githubusercontent.com.evil.example",
    "https://user:pass@vstoken.actions.githubusercontent.com",
  ]) {
    let calls = 0;
    await assert.rejects(
      rehearseOidc(
        config({
          requestUrl,
          fetcher: async () => {
            calls++;
            throw Error();
          },
        }),
      ),
      /OIDC rehearsal denied/,
    );
    assert.equal(calls, 0);
  }
});
test("bad or oversized responses fail without leaking endpoint response contents", async () => {
  for (const r of [
    new Response("fake-sensitive-error", { status: 500 }),
    new Response("x".repeat(32769)),
    new Response('{"value":"fake-sensitive-token"}'),
  ])
    await assert.rejects(
      rehearseOidc(config({ fetcher: async () => r })),
      (e) => e.message === "OIDC rehearsal denied; no production authorization",
    );
});
test("signed identity from another ref or a protected environment is refused by rehearsal", async () => {
  for (const patch of [
    { ref: "refs/heads/main" },
    { environment: "sf-gov-schema-capture" },
    { workflow_sha: "b".repeat(40) },
    { event_name: "pull_request" },
  ])
    await assert.rejects(
      rehearseOidc(
        config({
          fetcher: async (url) =>
            new Response(
              JSON.stringify(
                url === OIDC_JWKS_URL ? jwks : { value: fixture(patch) },
              ),
            ),
        }),
      ),
      /rehearsal denied/,
    );
});
test("rehearsal workflow requests no protected environment or database credentials", () => {
  const workflow = readFileSync(
    new URL(
      "../.github/workflows/metadata-broker-oidc-rehearsal.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /contents: read/);
  assert.match(
    workflow,
    /paths:\s*\n\s*- controller\/oidc-rehearsal-request.json/,
  );
  assert.doesNotMatch(
    workflow,
    /\benvironment:|secrets\.|psql|npm |capture-release-gate/,
  );
  assert.match(workflow, /uses: actions\/upload-artifact@[0-9a-f]{40}/);
});

test("verification clock is sampled after token retrieval, not before token issuance", async () => {
  let clock = at;
  const c = config({
    now: () => clock,
    fetcher: async (url) => {
      if (url === OIDC_JWKS_URL) return new Response(JSON.stringify(jwks));
      clock = new Date(at.getTime() + 2000);
      return new Response(
        JSON.stringify({
          value: fixture({
            iat: seconds + 2,
            nbf: seconds + 2,
            exp: seconds + 302,
          }),
        }),
      );
    },
  });
  const result = await rehearseOidc(c);
  assert.equal(result.signature_verified, true);
  assert.equal(result.production_identity_denied, true);
});
