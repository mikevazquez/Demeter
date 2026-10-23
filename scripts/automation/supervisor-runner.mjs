import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { writeSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { createGitHubSupervisorStore, migrateSupervisorStore } from "./supervisor-store.mjs";
import { admitSupervisorTask, tickSupervisor } from "./supervisor.mjs";
import { renderSupervisorHtml, renderSupervisorMarkdown } from "./supervisor-dashboard.mjs";
import { fireClaudeRoutine } from "./claude-routine-worker.mjs";
import { verifySupervisorReceipt } from "./supervisor-evidence.mjs";

export const SUPERVISOR_CONFIG = Object.freeze({
  repository: "mikevazquez/Demeter",
  authorityRef: "refs/heads/governance2/registry-318-v1",
  proofRef: "refs/heads/governance2/supervisor-proof-353-v1",
  proofSourceBranch: "governance2/supervisor-review-353-v1",
  anchorSha: "3ff186ab3975c15a0cdf7a524114be3c47d8294a",
  legacySha256: "6233dbc1436867781d476e6179be8020ce20a7d374bc4642396267527385c900",
  receiptIssue: 341,
  authorizationIssue: "https://github.com/mikevazquez/Demeter/issues/353",
});

const ensure = (condition, message) => {
  if (!condition) throw new Error(message);
};
const SHA = /^[a-f0-9]{40}$/;

// No retries for mutating requests. The store resolves ambiguous acknowledgements.
export function githubSupervisorRequest({ token, fetchImpl = globalThis.fetch, allowedRef }) {
  ensure(typeof token === "string" && token.length > 0, "GitHub token required");
  ensure(
    [SUPERVISOR_CONFIG.authorityRef, SUPERVISOR_CONFIG.proofRef].includes(allowedRef),
    "Reviewed registry ref required",
  );
  const api = `repos/${SUPERVISOR_CONFIG.repository}`;
  return async (method, path, body) => {
    ensure(
      ["GET", "POST", "PATCH"].includes(method) &&
        typeof path === "string" &&
        path.startsWith(`${api}/`) &&
        !path.split(/[/?]/).includes("..") &&
        !/[\r\n#]/.test(path),
      "Request outside supervisor repository",
    );
    if (method === "POST") {
      const objectWrite = ["blobs", "trees", "commits"].some(
        (kind) => path === `${api}/git/${kind}`,
      );
      const allowedCreate =
        path === `${api}/git/refs` &&
        [allowedRef, `refs/heads/${SUPERVISOR_CONFIG.proofSourceBranch}`].includes(body?.ref) &&
        allowedRef === SUPERVISOR_CONFIG.proofRef &&
        SHA.test(body?.sha ?? "");
      ensure(
        objectWrite || allowedCreate,
        "Only registry Git objects and isolated proof refs may be created",
      );
    }
    if (method === "PATCH")
      ensure(
        path === `${api}/git/refs/${allowedRef.slice(5)}` &&
          body?.force === false &&
          SHA.test(body.sha ?? ""),
        "Only fast-forward registry publication is permitted",
      );
    const response = await fetchImpl(`https://api.github.com/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    if (!response.ok)
      throw Object.assign(new Error(`GitHub request failed (${response.status})`), {
        httpStatus: response.status,
      });
    const text = await response.text();
    ensure(Buffer.byteLength(text) <= 5 * 1024 * 1024, "GitHub response exceeds limit");
    return JSON.parse(text);
  };
}

async function ensureProofRef(request, ref, sha) {
  const base = `repos/${SUPERVISOR_CONFIG.repository}/git`;
  try {
    return await request("GET", `${base}/ref/${ref.slice(5)}`);
  } catch (error) {
    if (error.httpStatus !== 404) throw error;
  }
  try {
    return await request("POST", `${base}/refs`, { ref, sha });
  } catch (error) {
    // Creation may have succeeded without acknowledgement. Read; never create twice.
    if (error.httpStatus && error.httpStatus !== 422) throw error;
    return request("GET", `${base}/ref/${ref.slice(5)}`);
  }
}

async function migrate(config, request) {
  const blob = await request(
    "GET",
    `repos/${config.repository}/contents/registry.json?ref=${config.anchorSha}`,
  );
  ensure(
    blob.encoding === "base64" && typeof blob.content === "string" && blob.size < 2 * 1024 * 1024,
    "Pinned legacy registry required",
  );
  const state = JSON.parse(Buffer.from(blob.content, "base64").toString("utf8"));
  return migrateSupervisorStore({
    ...config,
    request,
    legacySnapshot: { head_sha: config.anchorSha, sha256: config.legacySha256, state },
    event: {
      type: "explicit_supervisor_migration",
      authorization: SUPERVISOR_CONFIG.authorizationIssue,
      operating_authority: config.ref === SUPERVISOR_CONFIG.authorityRef,
    },
  });
}

export function buildSupervisorDelivery(task, attempt) {
  return {
    ...task.contract,
    worker_id: attempt.worker_id,
    attempt_id: attempt.attempt_id,
    contract_sha256: task.contract_sha256,
    dispatch_fingerprint: attempt.dispatch_fingerprint,
    resume_checkpoint: task.checkpoint,
    receipt_protocol: "GOVERNANCE_WORKER_RECEIPT_V2",
    receipt_instructions: [
      "After completing or blocking, publish exactly one receipt comment to https://github.com/mikevazquez/Demeter/issues/341 using your connected GitHub identity. This reporting write is authorized; source changes are not authorized for a read_only contract.",
      "Start with GOVERNANCE_WORKER_RECEIPT_V2 followed by a fenced json object. Set schema to governance-worker-receipt-v2. Copy task_id, worker_id, attempt_id, contract_sha256, dispatch_fingerprint and base_sha exactly from this delivery. Never recompute contract_sha256 from this augmented delivery.",
      "Include status (completed|blocked|failed), current_sha, files_changed, commands_run, tests_passed, blockers, remaining_work and next_action. Use arrays for all five list fields. A complete result has no blockers or remaining_work. Do not claim tests you did not run.",
      "Read-only review: verify the remote candidate branch matches base_sha, inspect only allowed_paths, run the requested local checks without committing or pushing, report exact base_sha as current_sha and [] files_changed. Do not update registry, tasks, workflows, PRs or settings. Return BLOCKED if scope or identity cannot be verified.",
    ],
  };
}

function parseReceipt(body) {
  if (
    typeof body !== "string" ||
    body.length > 100_000 ||
    !body.includes("GOVERNANCE_WORKER_RECEIPT_V2")
  )
    return null;
  const tail = body.slice(
    body.indexOf("GOVERNANCE_WORKER_RECEIPT_V2") + "GOVERNANCE_WORKER_RECEIPT_V2".length,
  );
  const blocks = [...tail.matchAll(/```(?:json|governance-worker-receipt-v2)?\s*\n([\s\S]*?)```/g)];
  if (blocks.length !== 1) return null;
  try {
    return JSON.parse(blocks[0][1]);
  } catch {
    return null;
  }
}

export function createReceiptObserver(request) {
  return async ({ task, attempt }) => {
    const matches = [];
    for (let page = 1; page <= 20; page++) {
      const comments = await request(
        "GET",
        `repos/${SUPERVISOR_CONFIG.repository}/issues/${SUPERVISOR_CONFIG.receiptIssue}/comments?per_page=100&page=${page}`,
      );
      ensure(Array.isArray(comments), "Receipt comments response required");
      for (const comment of comments) {
        // Trusted account is checked again against a fresh API read in the verifier.
        if (comment.user?.login !== "mikevazquez") continue;
        const receipt = parseReceipt(comment.body);
        if (receipt?.task_id === task.task_id && receipt.attempt_id === attempt.attempt_id)
          matches.push({
            receipt,
            source: {
              author: comment.user.login,
              channel: "github_issue_comment",
              receipt_url: comment.html_url,
            },
          });
      }
      if (comments.length < 100) break;
      ensure(
        page < 20,
        "Receipt history exceeds pagination limit; narrow/archive the evidence channel before continuing",
      );
    }
    if (matches.some((entry) => !isDeepStrictEqual(entry.receipt, matches[0].receipt)))
      return { receipt: {}, source: {} }; // Conflicts fail closed; identical retransmissions are idempotent.
    return matches[0] ?? null;
  };
}

function proofContract(sha) {
  return {
    task_id: "GOV-SUPERVISOR-001-PILOT-01",
    objective:
      "Revisar el candidato del supervisor y ejecutar sus pruebas de automatización. Piloto de lectura: entregar evidencia V2 para que otro job compruebe el resultado.",
    repo: SUPERVISOR_CONFIG.repository,
    branch: SUPERVISOR_CONFIG.proofSourceBranch,
    base_sha: sha,
    read_only: true,
    requires_uat: false,
    allowed_paths: [
      "scripts/automation/",
      "tests/automation/",
      "docs/automation/",
      ".github/workflows/governance-supervisor.yml",
    ],
    required_checks: [{ name: "supervisor-tests", app_slug: "github-actions" }],
    recovery: { mode: "read_only", max_attempts: 2 },
    category: "software",
    required_capabilities: ["repository_review"],
    required_permissions: ["repository:read", "receipt:write"],
    acceptance_criteria: [
      "Ejecutar node --test tests/automation/supervisor*.node.mjs en Node 22 o superior.",
      "Comprobar que el supervisor reserva el intento antes del POST, conserva el historial y no duplica al perder la respuesta.",
      "Publicar un receipt V2 con las claves de correlación exactas.",
    ],
    definition_of_done: [
      "Pruebas indicadas pasan y se reporta el SHA exacto.",
      "No existen cambios de fuentes ni un nuevo commit.",
      "El supervisor verifica el receipt y CI de forma independiente; el worker no puede autocertificar ese paso.",
    ],
    forbidden: [
      "Modificar archivos versionados, hacer commit/push o abrir PR.",
      "Merge, producción, datos de clientes, secrets o configuración.",
      "Iniciar otro worker o reactivar tareas históricas.",
    ],
  };
}

async function proveRemoteCas(store) {
  const snapshot = await store.read();
  if (snapshot.state.proof?.cas_single_winner === true) return snapshot;
  ensure(snapshot.state.tasks.length === 0, "Run the CAS proof before admitting live work");
  const candidates = ["observer-a", "observer-b"].map((observer) => ({
    ...snapshot.state,
    sequence: snapshot.state.sequence + 1,
    previous: snapshot.version,
    proof: {
      contender_committed: true,
      winning_observer: observer,
      scope: "isolated_registry_concurrency",
    },
  }));
  const results = await Promise.allSettled(
    candidates.map((next) =>
      store.compareAndSwap(snapshot.version, next, {
        type: "isolated_cas_contender",
        observer: next.proof.winning_observer,
      }),
    ),
  );
  ensure(
    results.filter((result) => result.status === "fulfilled").length === 1,
    "Remote CAS proof did not have exactly one acknowledged winner",
  );
  ensure(
    results
      .filter((result) => result.status === "rejected")
      .every((result) => result.reason.code === "CAS_CONFLICT"),
    "Unexpected CAS failure",
  );
  const observed = await store.read();
  const confirmed = {
    ...observed.state,
    sequence: observed.state.sequence + 1,
    previous: observed.version,
    proof: {
      ...observed.state.proof,
      cas_single_winner: true,
      acknowledged_winners: 1,
      rejected_competitors: 1,
    },
  };
  return store.compareAndSwap(observed.version, confirmed, {
    type: "isolated_cas_proof_verified",
    winners: 1,
    conflicts: 1,
  });
}

async function output(snapshot, { directory, runUrl, action }) {
  const observedAt = new Date().toISOString();
  const projection = { ...snapshot.state, observer_checked_at: observedAt };
  const markdown = renderSupervisorMarkdown(projection, { now: observedAt, runUrl });
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "status.md"), markdown);
  await writeFile(
    resolve(directory, "status.html"),
    renderSupervisorHtml(projection, { now: observedAt, runUrl }),
  );
  await writeFile(
    resolve(directory, "observation.json"),
    JSON.stringify(
      {
        schema: "governance-supervisor-observation-v1",
        action,
        observed_at: observedAt,
        registry_version: snapshot.version,
        active_task_id: snapshot.state.active_task_id,
        run_url: runUrl,
        task_statuses: snapshot.state.tasks.map(
          ({ task_id, status, verification_status, attempts, contract, evidence }) => ({
            task_id,
            status,
            verification_status,
            base_sha: contract.base_sha,
            evidence_sha: evidence?.sha ?? null,
            attempt_id: attempts.at(-1)?.attempt_id ?? null,
            worker_id: attempts.at(-1)?.worker_id ?? null,
          }),
        ),
      },
      null,
      2,
    ) + "\n",
  );
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
  writeSync(
    1,
    JSON.stringify({
      action,
      registry_version: snapshot.version,
      active_task_id: snapshot.state.active_task_id,
      observed_at: observedAt,
    }) + "\n",
  );
}

export async function runSupervisorCommand({
  mode,
  environment = process.env,
  fetchImpl = globalThis.fetch,
  directory = resolve("supervisor-output"),
}) {
  ensure(
    ["proof-init", "proof-tick", "tick", "admit", "migrate", "render"].includes(mode),
    "Unknown supervisor mode",
  );
  const proof = mode.startsWith("proof-");
  if (!proof && mode !== "render") {
    ensure(
      environment.GITHUB_REF === "refs/heads/main",
      "Operating supervisor commands run from reviewed main only",
    );
    ensure(
      environment.GOVERNANCE_SUPERVISOR_ENABLED === "true",
      "Operating supervisor is not activated",
    );
  }
  if (proof)
    ensure(
      environment.GITHUB_REPOSITORY === SUPERVISOR_CONFIG.repository &&
        environment.GITHUB_REF === "refs/heads/feat/governance-supervisor-20261020",
      "Proof only runs from its authorized candidate branch",
    );
  const ref = proof ? SUPERVISOR_CONFIG.proofRef : SUPERVISOR_CONFIG.authorityRef;
  const request = githubSupervisorRequest({
    token: environment.GH_TOKEN ?? environment.GITHUB_TOKEN,
    fetchImpl,
    allowedRef: ref,
  });
  const runUrl = environment.GITHUB_RUN_ID
    ? `https://github.com/${SUPERVISOR_CONFIG.repository}/actions/runs/${environment.GITHUB_RUN_ID}`
    : null;
  const config = {
    repository: SUPERVISOR_CONFIG.repository,
    ref,
    anchorSha: SUPERVISOR_CONFIG.anchorSha,
    legacySha256: SUPERVISOR_CONFIG.legacySha256,
    renderStatus: (state) => renderSupervisorMarkdown(state, { runUrl }),
  };
  const store = createGitHubSupervisorStore({ ...config, request });
  if (mode === "migrate") {
    ensure(
      environment.GOVERNANCE_MIGRATION_APPROVED_HEAD === config.anchorSha &&
        environment.GITHUB_ACTOR === "mikevazquez",
      "Explicit owner confirmation of the pinned legacy head required",
    );
    const migrated = await migrate(config, request);
    await output(migrated, { directory, runUrl, action: "migrated" });
    return migrated;
  }
  if (mode === "proof-init") {
    ensure(
      environment.GITHUB_ACTOR === "mikevazquez",
      "Pilot activation requires the owner actor recorded in its authorization",
    );
    ensure(SHA.test(environment.GITHUB_SHA ?? ""), "Candidate SHA required");
    await ensureProofRef(request, ref, config.anchorSha);
    let current;
    try {
      current = await store.read();
    } catch (error) {
      if (error.code !== "MIGRATION_REQUIRED") throw error;
      current = await migrate(config, request);
    }
    if (!current.state.tasks.length) {
      await proveRemoteCas(store);
      const source = await ensureProofRef(
        request,
        `refs/heads/${SUPERVISOR_CONFIG.proofSourceBranch}`,
        environment.GITHUB_SHA,
      );
      ensure(
        source.object?.sha === environment.GITHUB_SHA,
        "Existing pilot source differs; never reset an earlier pilot",
      );
      await admitSupervisorTask({
        store,
        contract: proofContract(environment.GITHUB_SHA),
        authorization: {
          actor: "mikevazquez",
          reference: SUPERVISOR_CONFIG.authorizationIssue,
          authorized_at: "2026-10-20T18:01:03.000Z",
        },
      });
    }
    const admitted = await store.read();
    ensure(
      admitted.state.tasks.length === 1 &&
        admitted.state.tasks[0].task_id === "GOV-SUPERVISOR-001-PILOT-01" &&
        admitted.state.tasks[0].contract.base_sha === environment.GITHUB_SHA,
      "The existing pilot belongs to another candidate SHA; do not reuse its evidence or reset its identity",
    );
  }
  if (mode === "admit") {
    ensure(
      environment.GITHUB_ACTOR === "mikevazquez" &&
        (environment.SUPERVISOR_TASK_CONTRACT_JSON?.length ?? 0) <= 64 * 1024,
      "Owner and bounded contract required",
    );
    const admitted = await admitSupervisorTask({
      store,
      contract: JSON.parse(environment.SUPERVISOR_TASK_CONTRACT_JSON),
      authorization: {
        actor: environment.GITHUB_ACTOR,
        reference: environment.SUPERVISOR_AUTHORIZATION_ISSUE,
        authorized_at: new Date().toISOString(),
      },
    });
    await output(admitted, { directory, runUrl, action: admitted.action });
    return admitted;
  }
  if (mode === "render") {
    const snapshot = await store.read();
    await output(snapshot, { directory, runUrl, action: "rendered" });
    return snapshot;
  }
  const configured =
    mode !== "proof-tick" &&
    Boolean(environment.CLAUDE_ROUTINE_FIRE_URL && environment.CLAUDE_ROUTINE_FIRE_TOKEN);
  const workers = [
    {
      workerId: "claude-code-routine-worker",
      state: configured ? "available" : "disconnected",
      stateSource: "configured_routine_bridge_capacity_unprobed",
      capabilities: ["repository_review"],
      permissions: ["repository:read", "receipt:write"],
      quality: { default: 0.9 },
      relativeCost: 1,
      maxRiskTier: 0,
    },
  ];
  const result = await tickSupervisor({
    store,
    workers,
    runUrl,
    observerId: `github-${environment.GITHUB_RUN_ID ?? "manual"}-${environment.GITHUB_JOB ?? "tick"}`,
    observe: createReceiptObserver(request),
    verify: (input) =>
      verifySupervisorReceipt({
        ...input,
        request,
        policy: {
          allowed_sources: [
            {
              author: "mikevazquez",
              channel: "github_issue_comment",
              receipt_url_prefix: "https://github.com/mikevazquez/Demeter/issues/341#issuecomment-",
            },
          ],
          require_baseline_ci: true,
        },
      }),
    dispatch: async ({ task, attempt }) => {
      const response = await fireClaudeRoutine({
        fireUrl: environment.CLAUDE_ROUTINE_FIRE_URL,
        token: environment.CLAUDE_ROUTINE_FIRE_TOKEN,
        contract: buildSupervisorDelivery(task, attempt),
        fetchImpl: (url, options) =>
          fetchImpl(url, { ...options, signal: AbortSignal.timeout(45_000), redirect: "error" }),
      });
      return {
        status: response.status,
        ...(response.http_status ? { http_status: response.http_status } : {}),
        ...(response.claude_code_session_url
          ? { session_url: response.claude_code_session_url }
          : {}),
      };
    },
  });
  await output(result, { directory, runUrl, action: result.action });
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2];
  const outputDirectory = process.argv[3] ? resolve(process.argv[3]) : resolve("supervisor-output");
  runSupervisorCommand({ mode, directory: outputDirectory }).catch((error) => {
    // Adapters intentionally omit provider response bodies, prompts, credentials and raw errors.
    writeSync(
      2,
      `Supervisor stopped: ${error.code ?? "VALIDATION_OR_RUNTIME_FAILURE"}. ${error.message}\n`,
    );
    process.exitCode = 1;
  });
}
