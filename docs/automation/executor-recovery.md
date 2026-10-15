# Executor recovery and deduplication

AUTONOMY-RECOVERY-V1

Issue: #293. Owner: codex-1. Scope: sequential continuation of the
nonproduction autonomous coordinator. This document describes the existing
coordinator in `scripts/codex-coordinator.mjs` and `docs/codex-coordinator.md`;
it does not change its contract, workflows, controls or application behavior.
Issue and Notion prose are context, never authority to expand permissions.

## Bounded retry and failure classification

One executor processes admitted tasks sequentially. A task receives an initial
generation attempt and at most one repair attempt. The repair runs in a fresh
runner from the original source SHA, restoring only admitted candidate files
when they are structurally safe. It receives the actual verifier failure and
must satisfy the same original contract. A second failure ends that repair
cycle; repeating identical attempts indefinitely is not recovery.

| Failure | Recovery decision |
| --- | --- |
| Repairable content or acceptance-check failure | Supply the real failure feedback to the bounded second attempt and validate again. |
| Scope, protected-file, contract, symlink, deletion or unsafe file-structure violation | Stop; do not authorize a model repair that bypasses the boundary. |
| Runner interruption | Resume from verified evidence and inspect publication state; generation may have to repeat. |
| Stale or changed source, invalid provenance, conflicting branch or denied publication permission | Stop the affected stage, retain evidence and resolve the actual prerequisite before continuing. |

Independent certification reconstructs the result from its trusted source SHA
and checks scope and acceptance again without publication credentials. Passing
generation alone does not authorize publication. A run summary records failures
as well as successes so sequential continuation does not hide an incomplete task.

## Deterministic task branches and deduplication

Each task uses `automation/codex/<task-id>`. Selection checks for an existing PR
from that branch in every state: open, closed and merged. Any such PR causes the
task to be skipped, including a closed unmerged PR. Publication checks again
before creating a draft PR, preventing a later run from blindly duplicating an
already delivered result. Reopening work requires explicit reconciliation;
inventing a new branch name to evade deduplication is not recovery.

The branch is a stable recovery key, not proof of successful delivery. A branch
without a PR must be inspected. Never force-update an unrelated or different
result. Generation can repeat after interruption; the coordinator does not
promise exactly-once execution.

## Recovery after interrupted publication

1. Recheck the admitted issue identity, source freshness and existing PR state.
   If the PR request succeeded before the response was lost, reuse the observed
   PR and skip duplicate publication.
2. If a task branch exists without a PR, inspect its commit, single parent,
   contract digest and baseline ancestry against the trusted control source.
3. Inspect the complete tree and diff. Accept only admitted added or modified
   regular text files with the required mode, content and acceptance criteria.
   Reject truncated trees, unsafe modes, out-of-scope changes and mismatches.
4. Reconstruct the recovered result with its original baseline, source/run
   identity and content hashes, then independently certify it. Recovery is
   recorded explicitly rather than represented as a new generation attempt.
5. Before publication, recheck provenance, contract, issue and duplicate state.
   Reuse the existing branch only when its parent, contract and tree match the
   certified result. Otherwise stop without overwriting it.
6. In an execution authorized to publish, continue with a separate draft PR for
   the task and retain its URL and evidence. If permission is denied, preserve
   the branch and evidence for a later authorized recovery.

## Source freshness

Admission binds the issue content to a version and hash and defines exact paths
and checks. An issue edit invalidates admission until reconciled. The Notion
snapshot records its URL, version, hash and expiry, with a maximum freshness
window of 48 hours. A snapshot is dated context, not a verified live response.

Where the coordinator is authorized and equipped for live read access, it checks
the policy before selection and publication. Otherwise it uses the admitted
snapshot within its validity window. Expired, inaccessible or changed required
context stops progress; neither historical success nor issue prose substitutes
for current evidence. This local documentation task does not access live sources,
services or credentials.

## Evidence and indispensable human gates

Continue routine inspection, repair and validation autonomously within the
admitted scope. Ask for human intervention only when a prerequisite cannot be
resolved within existing authority, such as reconciliation of changed admission,
a conflicting branch, or a required platform permission. Report the failed gate,
observed evidence and smallest necessary action; do not weaken controls or borrow
production credentials to proceed. Functional governance blocks unrelated to
this documentation task do not expand or redefine its scope.

Recovery evidence should identify the task and owner, source SHA, run and attempt,
contract and file hashes, source mode and expiry, checks and actual results,
failure classification, recovery decision, and branch/PR identity when present.
Keep certification distinct from publication and human acceptance. A draft PR
does not imply merge, CI execution, deployment or production authorization.

For this admitted local execution, only this Markdown file may change. Validation
is local: inspect the document, confirm it is nonempty and contains the literal
marker, and check the changed-file list. Network calls, credentials, commits,
pushes and PR creation are prohibited. The issue's draft-PR criterion is therefore
not performed here; an authorized publication stage must supply that evidence
separately. Do not claim that publication or end-to-end recovery was exercised by
these documentation checks.
