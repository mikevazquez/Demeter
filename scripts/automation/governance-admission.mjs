import { createGatewayContracts, validateGatewayPlan } from "./governance-gateway.mjs";
import { admitSupervisorTask } from "./supervisor.mjs";

const MARKER = "GOVERNANCE_GPT_ADMISSION_V1";
const SCHEMA = "governance-gpt-admission-v1";
const ISSUE_URL = "https://github.com/mikevazquez/Demeter/issues/382";
const COMMENT_PREFIX = `${ISSUE_URL}#issuecomment-`;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SHA = /^[a-f0-9]{40}$/;

const ensure = (ok, message) => {
  if (!ok) throw new Error(message);
};

export function parseGatewayAdmissionComment(comment) {
  if (typeof comment?.body !== "string" || !comment.body.includes(MARKER)) return null;
  ensure(comment.body.length <= 100_000, "Admission comment exceeds limit");
  if (comment.user?.login !== "mikevazquez") return null;
  ensure(
    typeof comment.html_url === "string" && comment.html_url.startsWith(COMMENT_PREFIX),
    "Admission comment is outside the reviewed channel",
  );
  ensure(
    typeof comment.created_at === "string" && Number.isFinite(Date.parse(comment.created_at)),
    "Admission timestamp required",
  );

  const tail = comment.body.slice(comment.body.indexOf(MARKER) + MARKER.length);
  const blocks = [...tail.matchAll(/```(?:json|governance-gpt-admission-v1)?\s*\n([\s\S]*?)```/g)];
  ensure(blocks.length === 1, "Admission requires exactly one JSON block");

  let payload;
  try {
    payload = JSON.parse(blocks[0][1]);
  } catch {
    throw new Error("Admission JSON is invalid");
  }

  ensure(payload?.schema === SCHEMA, "Unsupported admission schema");
  ensure(ID.test(payload.request_id ?? ""), "Valid admission request_id required");
  ensure(SHA.test(payload.base_sha ?? ""), "Exact base SHA required");
  ensure(payload.repository === "mikevazquez/Demeter", "Unreviewed repository");
  ensure(payload.environment === "sandbox", "New gateway work must start in sandbox");
  ensure(payload.production_authorized === false, "Gateway admission cannot authorize production");
  validateGatewayPlan(payload.plan);

  return {
    request_id: payload.request_id,
    base_sha: payload.base_sha,
    plan: payload.plan,
    source_comment_url: comment.html_url,
    authorized_at: new Date(comment.created_at).toISOString(),
  };
}

export function contractsFromGatewayAdmission(admission) {
  ensure(admission && typeof admission === "object", "Parsed admission required");
  return createGatewayContracts(admission.plan, { baseSha: admission.base_sha }).map(
    (contract) => ({
      ...contract,
      gateway: {
        ...contract.gateway,
        admission_request_id: admission.request_id,
        admission_channel: "github_issue_comment",
        admission_comment_url: admission.source_comment_url,
      },
    }),
  );
}

export async function admitGatewayAdmission({ store, admission }) {
  const contracts = contractsFromGatewayAdmission(admission);
  const results = [];
  for (const contract of contracts) {
    const result = await admitSupervisorTask({
      store,
      contract,
      authorization: {
        actor: "mikevazquez",
        reference: ISSUE_URL,
        authorized_at: admission.authorized_at,
      },
    });
    results.push({ task_id: contract.task_id, action: result.action });
  }
  return { request_id: admission.request_id, results };
}

export async function reconcileGatewayAdmissions({ request, store }) {
  const admissions = [];
  for (let page = 1; page <= 20; page++) {
    const comments = await request(
      "GET",
      `repos/mikevazquez/Demeter/issues/382/comments?per_page=100&page=${page}`,
    );
    ensure(Array.isArray(comments), "Admission comments response required");
    for (const comment of comments) {
      if (typeof comment.body !== "string" || !comment.body.includes(MARKER)) continue;
      const admission = parseGatewayAdmissionComment(comment);
      if (!admission) continue;
      admissions.push(await admitGatewayAdmission({ store, admission }));
    }
    if (comments.length < 100) break;
    ensure(page < 20, "Admission history exceeds pagination limit");
  }
  return admissions;
}

export { ISSUE_URL as GATEWAY_ADMISSION_ISSUE_URL, MARKER as GATEWAY_ADMISSION_MARKER };
