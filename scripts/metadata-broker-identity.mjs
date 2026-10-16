// No endpoint or environment is activated here. Policy and JWKS must come from
// trusted host configuration, never from the HTTP request or token header.
import { createPublicKey, verify } from "node:crypto";
export const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const OIDC_JWKS_URL = OIDC_ISSUER + "/.well-known/jwks";
export const OIDC_AUDIENCE = "sf-gov-metadata-broker-v1";
const deny = () => {
  throw new Error("Broker identity denied");
};
const SHA = /^[0-9a-f]{40}$/;
function decode(part) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) deny();
  const bytes = Buffer.from(part, "base64url");
  if (bytes.toString("base64url") !== part) deny();
  return bytes;
}

export function authenticateController(token, jwks, policy, now = new Date()) {
  try {
    if (
      typeof token !== "string" ||
      token.length > 16384 ||
      typeof policy?.controller_sha !== "string" ||
      !SHA.test(policy.controller_sha)
    )
      deny();
    const parts = token.split(".");
    if (parts.length !== 3) deny();
    const header = JSON.parse(decode(parts[0]));
    if (
      Object.keys(header).sort().join(",") !== "alg,kid,typ" ||
      header.alg !== "RS256" ||
      header.typ !== "JWT" ||
      typeof header.kid !== "string" ||
      !header.kid
    )
      deny();
    const keys = jwks?.keys?.filter((k) => k.kid === header.kid);
    if (!Array.isArray(keys) || keys.length !== 1) deny();
    const jwk = keys[0];
    if (
      jwk.kty !== "RSA" ||
      (jwk.alg && jwk.alg !== "RS256") ||
      (jwk.use && jwk.use !== "sig") ||
      Object.hasOwn(jwk, "d")
    )
      deny();
    const key = createPublicKey({ key: jwk, format: "jwk" });
    if (
      key.asymmetricKeyDetails.modulusLength < 2048 ||
      !verify(
        "RSA-SHA256",
        Buffer.from(parts[0] + "." + parts[1]),
        key,
        decode(parts[2]),
      )
    )
      deny();
    const c = JSON.parse(decode(parts[1]));
    const seconds = now.getTime() / 1000;
    if (
      !Number.isFinite(seconds) ||
      ![c.exp, c.iat, c.nbf].every(Number.isSafeInteger) ||
      c.nbf > seconds ||
      c.iat > seconds + 30 ||
      c.exp <= seconds ||
      c.exp <= c.iat ||
      c.exp - c.iat > 600 ||
      seconds - c.iat > 600 ||
      c.nbf > c.iat
    )
      deny();
    const expected = {
      iss: OIDC_ISSUER,
      aud: OIDC_AUDIENCE,
      repository: "mikevazquez/Demeter",
      repository_id: "1370494017",
      repository_owner_id: "55609925",
      sub: "repo:mikevazquez/Demeter:environment:sf-gov-schema-capture",
      environment: "sf-gov-schema-capture",
      ref: "refs/heads/governance/sf-gov-001-controller",
      ref_type: "branch",
      ref_protected: "true",
      event_name: "push",
      runner_environment: "github-hosted",
      run_attempt: "1",
      workflow_ref:
        "mikevazquez/Demeter/.github/workflows/schema-controller.yml@refs/heads/governance/sf-gov-001-controller",
      sha: policy.controller_sha,
      workflow_sha: policy.controller_sha,
    };
    if (
      Object.entries(expected).some(([k, v]) => c[k] !== v) ||
      typeof c.run_id !== "string" ||
      !/^[1-9][0-9]*$/.test(c.run_id) ||
      c.job_workflow_ref !== undefined ||
      typeof c.jti !== "string" ||
      !c.jti ||
      c.jti.length > 256
    )
      deny();
    // Return only necessary verified claims, never a bearer token.
    return Object.freeze({
      controller_sha: c.sha,
      run_id: c.run_id,
      run_attempt: c.run_attempt,
      expires_at: new Date(c.exp * 1000).toISOString(),
    });
  } catch {
    deny();
  }
}

export async function loadGitHubPublicKeys(fetcher = fetch) {
  try {
    const r = await fetcher(OIDC_JWKS_URL, {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) deny();
    const reader = r.body.getReader();
    let length = 0;
    const parts = [];
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > 65536) deny();
        parts.push(Buffer.from(next.value));
      }
    } finally {
      await reader.cancel();
    }
    const jwks = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (
      !Array.isArray(jwks.keys) ||
      jwks.keys.length === 0 ||
      jwks.keys.length > 32
    )
      deny();
    return jwks;
  } catch {
    deny();
  }
}
