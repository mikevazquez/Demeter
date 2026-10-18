# Governance 2.0: admission of new tasks (block 1)

New tasks use the existing adapter and registry through `reserveApproved`.
A hardcoded pilot ID is no longer required for this path. An arbitrary task object,
issue comment, candidate file or unpinned catalog never grants execution authority.
The example catalog contains no tasks and activates nothing.

## Trusted boundary

The supervisor supplies an approved catalog's absolute path outside the candidate,
its reviewed SHA256 and a work key. The model cannot choose that pin or approve its
own contract. The file must be regular, single-linked, at most 1 MiB and reached
without symlinks. It must match the supplied digest exactly. Copying a candidate's
proposed digest into the trusted argument is not approval.

The current bounded repository/authorization is `mikevazquez/Demeter` and issue
#318, matching the existing execution authority. Other repositories, authorization
URLs, unknown fields or providers require a separately reviewed extension. No
services, runners, paid API credentials, queue or publisher are introduced.

A catalog has the schema shown in `task-catalog.example.json` and at most 100
entries. Each entry has exactly these fields:

| Field               | Meaning                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `workKey`           | Stable lowercase logical-work identity, 3–64 characters; never a display name used to retry                                  |
| `goal`              | Exact reviewed objective, at most 8000 characters                                                                            |
| `baseSha`           | Exact 40-character Git base commit                                                                                           |
| `baseBranch`        | Exact reviewed publication target, which must still point at that base                                                       |
| `allowedPaths`      | 1–10 exact relative file paths, no wildcards/traversal or protected controls                                                 |
| `checks`            | Exact Node script argv arrays, no shell or inline evaluation                                                                 |
| `independentChecks` | At least one check from `checks`, with its entrypoint's `sourceSha256` pinned to the reviewed base and outside allowed paths |
| `startBefore`       | ISO timestamp after which a first generation cannot begin                                                                    |
| `limits`            | Exact provider, call, time, file and byte budget below                                                                       |

The independent check record is `{ "argv": ["node", "checks/verify.mjs"],
"sourceSha256": "<reviewed SHA256>" }`. Its baseline Git blob and current checkout
must both match. The supervisor must review the check's behavior and dependencies;
a matching hash alone does not establish that an acceptance test is adequate.

The exact `limits` shape is:

```json
{
  "provider": "codex-cli-chatgpt",
  "maxModelInvocations": 1,
  "timeoutMs": 240000,
  "maxFiles": 2,
  "maxTotalBytes": 65536
}
```

Hard caps are one CLI generation invocation, 1000–240000 ms, at most the declared
allowed-path count (maximum 10) and at most 256 KiB raw output. The existing per-file
128 KiB and sealed-package 512 KiB limits remain. These are output postconditions,
not a disk quota on the process. The runtime deadline bounds the CLI process.
Smaller runtime timeouts are permitted; larger ones are rejected before execution.

Protected paths include the admission/execution/authority/recovery/supervisor
controls, operating policy, AGENTS.md, dependency manifests, credentials and
.github paths. Candidate dependencies and ignored files are not permitted in the
generation checkout. Checkers and dependencies run separately in isolated
certification; new ignored output cannot hide behind git's ordinary exclusions.

## Identity, consumption and successors

The task ID is `g2-` plus 40 hex characters derived from repository and workKey.
It does not include catalog name, policy digest, goal or base. Editing the catalog
therefore cannot make a consumed logical identity fresh. The catalog rejects
repeated work keys and identical work payloads renamed under another key.

Before reserve, the existing registry mutex protects a check of consumed local
history. It rejects the same ID/workKey or an identical contract renamed to a new
key, including blocked or published history. This does not provide semantic
comparison of different goals or global coordination between independent hosts;
those are outside block 1. Existing remote per-ID consumption still applies.

No automatic successor is authorized for a failed/uncertain attempt. A new ID or
work key cannot be used as an automatic retry loop. Classify and reconcile the
original attempt first; a genuinely new or successor work contract needs explicit
review within the user's authorized scope.

## Adapter flow

Illustrative supervisor API, not an instruction to launch this example:

```js
import { reserveApproved, executeOnce } from "./scripts/automation/codex-executor.mjs";
import { admitTask } from "./scripts/automation/task-admission.mjs";

const trustedCatalog = {
  path: "/workspace/work/control/approved-catalog.json",
  sha256: reviewedCatalogDigest,
};
const task = admitTask(repo, trustedCatalog, approvedWorkKey); // Read-only preflight.
reserveApproved(repo, canonicalRegistry, trustedCatalog, approvedWorkKey);
const result = executeOnce(repo, canonicalRegistry, task.id, { trustedCatalog });
```

The admitted task carries a proof bound to the catalog digest, workKey, exact task
digest, target branch, limits, deadline and independent checks. The original
reservation contract hash, remote claim, checkpoint and sealed result bind this
proof too. Admission does not create another operational registry or publisher.

Before the first execution, the adapter reopens and verifies the same external
catalog and immutable acceptance source. It requires the default Codex executable
and an authenticated ChatGPT account reported by `codex login status`; output is
not printed or stored. API-key authentication and another binary are rejected.
After remote claim/checkpoint, it rechecks catalog/deadline/account immediately
before the native execution. Failure there leaves the existing intent consumed
and uncertain; no automatic regeneration is permitted.

The exclusive executor directory and existing remote claim consume the single
invocation. Replaying or recovering an existing attempt does not require a still
unexpired catalog and cannot generate again. The deadline limits starting work,
not inspecting an existing attempt. This also preserves replay after catalog loss
or revocation. A publisher must match the admitted target and the exact durable
result/certificate; a verification-only registry cannot publish or start work.

File and byte budgets apply during capture and again while validating a remote
result. Exceeding scope, ignored-output or size limits blocks sealing/publication;
it does not permit another call to repair the candidate. Review the original
candidate and evidence. A successful login preflight is not a guarantee against a
later 401; the original failure/reconciliation rules still apply.

## Acceptance and release boundary

The block's tests use disposable real Git repositories/files, an explicitly
mocked native Codex process and an explicitly mocked GitHub authority. They test
admission, first-spawn guards, revocation between checkpoint/spawn, consumption,
output budgets, branch binding and checkpoint/result/recovery provenance. They
make no real model call and no canonical reservation. CI checks the aggregate code
and the earlier published pilot independently; that is not a new admitted-task E2E.

Block 1 supplies executable admission and rejection controls. Block 2 still owns
cross-host registry coordination. Block 3 will test a separately authorized new
task end-to-end. Block 4 still requires review/integration; no merge or deployment
is authorized here. The empty example catalog is deliberately not a live queue.
