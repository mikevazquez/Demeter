const MARKER = "<!-- continuity-lab-315:v1 -->";
const ISSUE_NUMBER = 315;

export function nextState(previous, trigger, runId) {
  if (!Number.isSafeInteger(runId) || runId <= 0) {
    throw new Error("Invalid workflow run ID");
  }
  if (trigger !== "start" && trigger !== "resume") {
    throw new Error("Unsupported trigger");
  }
  if (previous === null) {
    return trigger === "start" ? { phase: "waiting", startedBy: runId, completedBy: null } : null;
  }
  if (
    !previous ||
    !["waiting", "complete"].includes(previous.phase) ||
    !Number.isSafeInteger(previous.startedBy) ||
    previous.startedBy <= 0 ||
    (previous.completedBy !== null &&
      (!Number.isSafeInteger(previous.completedBy) || previous.completedBy <= 0))
  ) {
    throw new Error("Invalid persisted state");
  }
  if (previous.phase === "complete") {
    if (previous.completedBy === null) throw new Error("Invalid completion");
    return null;
  }
  if (previous.completedBy !== null) throw new Error("Invalid waiting state");
  if (trigger === "start") return null;
  if (previous.startedBy === runId) {
    throw new Error("Recovery must run in a separate workflow execution");
  }
  return {
    phase: "complete",
    startedBy: previous.startedBy,
    completedBy: runId,
  };
}

export function parseState(body) {
  if (typeof body !== "string" || !body.startsWith(MARKER + "\n")) {
    return null;
  }
  const state = JSON.parse(body.slice(MARKER.length + 1));
  if (!state || typeof state !== "object") {
    throw new Error("Malformed continuity marker");
  }
  const permitted = ["phase", "startedBy", "completedBy"];
  if (Object.keys(state).sort().join(",") !== permitted.sort().join(",")) {
    throw new Error("Unexpected state fields");
  }
  nextState(state, "start", 1);
  return state;
}

export function isTrustedStateComment(comment) {
  return (
    comment?.user?.login === "github-actions[bot]" &&
    comment.user.type === "Bot"
  );
}

export function serializeState(state) {
  return MARKER + "\n" + JSON.stringify(state);
}

async function github(path, options = {}) {
  const url = `https://api.github.com${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub ${response.status} on ${path}`);
  }
  return response.json();
}

async function latestState(repository) {
  let latest = null;
  let lastCommentId = -1;
  const commentsPath = `/repos/${repository}/issues/${ISSUE_NUMBER}/comments`;
  for (let page = 1; page <= 100; page++) {
    const comments = await github(`${commentsPath}?per_page=100&page=${page}`);
    for (const comment of comments) {
      if (!isTrustedStateComment(comment)) continue;
      const state = parseState(comment.body);
      if (state !== null && comment.id > lastCommentId) {
        lastCommentId = comment.id;
        latest = state;
      }
    }
    if (comments.length < 100) return latest;
  }
  throw new Error("Pagination bound exceeded; refusing to assume state");
}

export async function run() {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const runId = Number(process.env.GITHUB_RUN_ID);
  const trigger = process.env.CONTINUITY_TRIGGER;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || "") || !token) {
    throw new Error("Missing or invalid GitHub environment");
  }
  const previous = await latestState(repository);
  const next = nextState(previous, trigger, runId);
  if (next === null) {
    console.log("No transition needed:", previous?.phase || "not started");
    return;
  }
  const commentsPath = `/repos/${repository}/issues/${ISSUE_NUMBER}/comments`;
  await github(commentsPath, {
    method: "POST",
    body: JSON.stringify({ body: serializeState(next) }),
  });
  console.log("Recorded continuity phase:", next.phase);
}

if (process.argv[1]?.endsWith("/continuity-lab.mjs")) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
