# GOV-SUPERVISOR-001 · Acceptance and evidence

## Objective

Operate the existing Governance components from outside a conversation and show
which admitted task has an executor, its last observed signal, the evidence it
produced, and its next eligible action. Preserve the identity and history of the
work when recovering an interrupted attempt.

This document defines acceptance. It does not declare an active scheduler, a real
worker run, production approval, or successful recovery. The coordinating agent
must add the exact commit, environment, runs and observed results below.

## Existing decisions and boundaries

- [Governance 2.0](https://app.notion.com/p/3fbd78f7146381dfac4dff5ecd9b98f5):
  Notion owns intent, scope, decisions and gates; GitHub, CI and the environment
  provide technical evidence. Task ownership stays with Governance.
- [GOV-AGENTS-001](https://app.notion.com/p/3fed78f7146381fabf3ee163c0b41c8f):
  reuse the existing worker registry/dispatcher and Claude Routine bridge. An
  accepted dispatch is not a completed task. Reconcile receipts and exact SHAs.
- [Checkpoint C1](https://app.notion.com/p/3fed78f7146381b2aa24d195eb04e07b)
  and [Recovery C2](https://app.notion.com/p/3fed78f71463816abd34db6f3653dc79):
  retain task identity, checkpoint, evidence and scope; revalidate current sources
  before effects. A stale checkpoint or an open historical PR is not authority to
  resume work. Lease expiry does not authorize repeating uncertain effects.
- [Trigger C3](https://app.notion.com/p/3fed78f7146381a1a3f4e0a735a8898a):
  a 15-minute eligible tick, backoff 15 → 30 → 60 minutes, and one request per
  work/generation. No eligible work means NOOP. Human gates stop automatic retries.
- [Executor C4](https://app.notion.com/p/3fed78f71463811f9b47dee5fabcd87c):
  keep ChatGPT authentication on its existing trusted host. No copying that
  session to Actions or introducing a paid API fallback to bypass authentication.
- [C5](https://app.notion.com/p/3fed78f7146381478a02cb026a6f3d2e) is a separate
  native Codex Goal test. Its last documented state is an authentication gate
  before phase 1. A Claude supervisor test cannot complete C5 by substitution.
- [Existing shared authority](./registry-authority.md) and
  [task admission](./task-admission.md): preserve consumed IDs and immutable
  history. No silent registry replacement, force update, heartbeat takeover or
  recycled work under a new ID. The legacy authority is not reset by this block.

These documents contain historical checkpoints. The exact remote state and
current authorization must be checked before activation. Prior release approval
does not authorize a future production release.

## Implementation and operating boundary

| Component                                     | Responsibility and boundary                                                                                                                                                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `supervisor.mjs`                              | Admits immutable contracts, reserves one active attempt durably before dispatch, reconciles receipts, and decides bounded recovery. It reuses the existing worker dispatcher.                                                                                                  |
| `supervisor-store.mjs`                        | Stores the supervisor envelope, immutable legacy snapshot, transition events and Markdown projection in Git. Publication is a compare-and-swap fast-forward; an uncertain write does not authorize repeating an external effect.                                               |
| `supervisor-runner.mjs`                       | Connects the GitHub store, Claude Routine bridge, authorized issue receipts and independent verifier. Operating commands require reviewed `main` and explicit activation.                                                                                                      |
| `.github/workflows/governance-supervisor.yml` | Defines isolated candidate tests, a pilot dispatch job, a separate observer job and the gated operating schedule. A committed workflow is not evidence that its scheduled runtime is active.                                                                                   |
| `supervisor-process.mjs`                      | Observes only an explicitly launched local process, its protocol events and its own process group. A terminal event, exit, group closure, checkpoint and independent completion are distinct facts.                                                                            |
| `supervisor-managed-worker.mjs`               | Connects a registered local executable to the reserved attempt, persists genuine worker activity, records a second durable launch claim, and requires independent checkpoint reconciliation before resuming writable work. It does not provision or authenticate a Codex host. |

The operating authority remains `governance2/registry-318-v1`. The candidate
workflow uses the isolated `governance2/supervisor-proof-353-v1` registry and the
separately pinned `governance2/supervisor-review-353-v1` source branch for its
read-only task. Its authorization reference is
[GOV-SUPERVISOR-001, issue 353](https://github.com/mikevazquez/Demeter/issues/353).
The exact actual refs, candidate SHA and observed runs remain to be recorded below;
these names describe configuration, not a successful execution.

Only acknowledged pre-activation capacity rejection permits a routine retry.
An uncertain dispatch, silent worker or orphaned launch reservation retains the
active slot. A managed local worker can become eligible for bounded recovery only
after the observer proves it stopped and its process group closed, and its
contract permits the recovery. Writable recovery additionally requires a checked
checkpoint and confirmation that no effects remain pending. Authentication stops
the retries. A POSIX process group is not a containment guarantee for deliberately
escaped descendants; a suitable runner or container is still required for that
threat model.

The current hosted runner configures the Claude Routine bridge. The local managed
adapter is an integration component; the existence of its code or synthetic
process proof does not establish a continuously provisioned Codex executor or
fulfill the separate C5 acceptance.

## Dashboard interface

`scripts/automation/supervisor-dashboard.mjs` exports:

```js
renderSupervisorMarkdown(
  state,
  ({ now = new Date().toISOString(), runUrl = null, staleAfterMinutes = 30 } = {}),
);

renderSupervisorHtml(state, (options = {}));
```

Both return strings and perform no I/O. Supplying `now` makes output deterministic.
The renderer does not mutate state, dispatch work, poll a provider or create an
authority. The HTML is a responsive static view without scripts, remote resources,
forms or action buttons. Links are restricted to HTTPS on `github.com`,
`api.github.com` and `claude.ai`, without credentials or sensitive query keys.

The runner adds `observer_checked_at` to its output projection after each
observation. This is **Última consulta del supervisor**, and it is separate from
`last_tick_at`, the **Última transición persistida**, and the last actual worker
signal. An idle or unchanged tick updates the Actions summary and artifacts
without creating a registry transition. The `status.md` committed with the
registry changes only on a real transition; its absent observer timestamp is
shown as unrecorded. The current observation belongs in the latest run's summary
or artifact, not in a fabricated state write.

Task updates, dispatch intent and a new dashboard render do not refresh a worker
heartbeat. The default 30-minute display threshold marks insufficiently recent
activity; it never authorizes takeover. Missing worker/state is displayed as
unrecorded, not guessed. Dates are shown in America/Mexico_City. A reserved attempt
is **Intento reservado** until the provider acknowledges delivery; it is not yet
**Enviado** or **Ejecutando**.

If the latest managed worker event is `turn.completed` or `turn.failed` while the
attempt still awaits closure reconciliation, the view shows **Cierre pendiente**.
That event does not prove a closed process group or independently verified work.
An **Incierto** or **Verificando** state retains its higher-priority meaning.

A `completed` receipt alone is shown as **Entregado**, including a task whose
verification status is still the default `pending` from admission. **Verificando**
requires a verification state to have been recorded. Green **Verificado** requires
explicit verified/passed/success verification, a full result SHA and a permitted
evidence link. This is a display of the supervisor's recorded verification, not
an independent verification performed by the renderer. A task requiring functional
acceptance remains **UAT pendiente** until the state records that acceptance.
Production authorization remains a separate gate.

The runner records a permitted `reported_receipt_url` as soon as a correlated
receipt is observed. The panel can therefore link to the receipt while checks
remain pending or evidence needs review. A reported receipt link is not verified
evidence and cannot, by itself, make the task green.

## Independent receipt verification

`scripts/automation/supervisor-evidence.mjs` exports:

```js
await verifySupervisorReceipt({ task, attempt, receipt, source, request, policy });
// { status: 'verified' | 'blocked' | 'pending', reason, evidence?, checkpoint? }

parseSupervisorReceipts(comments);
// [{ receipt, source: { author, channel, receipt_url }, comment_id }]
```

`request(method, endpoint)` is the supervisor's authenticated GitHub adapter. The
verifier only invokes `GET`, with relative endpoints such as `repos/owner/repo/...`.
It never executes the worker's commands, imports candidate code, checks out a
branch, creates a comment or writes a registry. API failures remain pending and
return a fixed reason without copying response bodies, tokens or exception text.

The supervisor supplies an admitted, immutable contract and its canonical SHA256
digest. This verifier requires the same full digest in the task, attempt and
receipt; contract admission separately recomputes the digest from the complete
contract. A receipt cannot supply its own verification policy or source identity.

The receipt schema is `governance-worker-receipt-v2`. It requires `task_id`,
`attempt_id`, `worker_id`, `contract_sha256`, `dispatch_fingerprint`, `base_sha`,
`current_sha`, the five arrays `files_changed`, `commands_run`, `tests_passed`,
`blockers`, `remaining_work`, and `next_action` (string or null). Its `status` is
`completed`, `blocked` or `failed`. SHAs must contain all 40 lowercase hex digits;
digests contain 64. A completed receipt with blockers or remaining work does not
pass verification. Worker commands and test claims are retained by the source
receipt, not repeated in the sanitized checkpoint.

Accepted comment formats are a `governance-worker-receipt-v2` fenced block, or the
marker `GOVERNANCE_WORKER_RECEIPT_V2` followed by one JSON fenced block. The existing
Claude generated-by footer is accepted after that block. A complete raw JSON body
with the schema is also accepted. Multiple markers, another trailing JSON block
or contradictory receipts for the same author/task/attempt are rejected. Exact
canonical duplicates collapse; they are not a new completion event. A caller
should select the authorized task/source before scanning unrelated conversations.

The pilot source policy is explicit:

```js
{
  allowed_sources: [{
    author: 'mikevazquez',
    channel: 'github_issue_comment',
    receipt_url_prefix:
      'https://github.com/mikevazquez/Demeter/issues/341#issuecomment-'
  }],
  require_baseline_ci: true
}
```

The worker identity is `claude-code-routine-worker`; the task contract requires
`{ name: 'supervisor-tests', app_slug: 'github-actions' }`. For issue comments,
the verifier re-fetches the actual GitHub comment by ID and checks its author,
URL and canonical receipt body. Copying those fields into an untrusted envelope
does not satisfy that check. Other explicitly allowed source channels depend on
the trusted runner to authenticate the envelope; they are not configured here.

Verification then checks the exact remote branch head, the existence of the full
commit, and ancestry from the admitted base. It compares the remote file list
with the worker's claimed list and the contract's allowed scope. Literal files,
directory prefixes ending in `/`, and prefixes ending in `/**` are supported;
arbitrary globs, traversal and prefix lookalikes are rejected. Both sides of a
rename must remain in scope. The default limit is 100 changed files. The hard
limit is 299 because the
[GitHub comparison response](https://docs.github.com/en/rest/commits/commits#compare-two-commits)
can truncate its file list at 300; a possibly incomplete list cannot prove scope.

Required CI is the union of contract and supervisor policy requirements. A
[check run](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference)
must match the exact SHA, check name and allowed app, finish with `success`, and
be the newest matching run. Missing or unfinished checks remain pending; failed,
neutral, skipped or cancelled checks do not count as success. Paginated reads
must be complete and stable within the configured bound. An optional legacy
[`kind: 'status'` requirement](https://docs.github.com/en/rest/commits/statuses#get-the-combined-status-for-a-specific-reference)
also requires the exact combined SHA and an explicitly allowed status creator;
missing producer metadata cannot pass. The pilot uses check runs only.

An optional PR must point to that same repository, branch and SHA. The branch
and PR are checked again after CI reads to detect movement during verification.
These reads provide a point-in-time result, not a lock against later changes.
Any future promotion must revalidate the required gates at its own exact SHA.

A read-only task may have an empty diff and an unchanged base. It still needs
the expected successful baseline CI under the pilot policy. The generic verifier
permits an explicit `require_baseline_ci: false` exemption only for read-only
contracts with no configured required checks; the operating admission and this
pilot do not use that exemption. Baseline CI proves the candidate passed those
checks. It does not independently prove that the worker executed each command
it reported, completed a subjective review, or met functional UAT. Those limits
remain visible when describing pilot results.

## Required acceptance cases

| Case                                           | Required observation                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| No eligible task                               | NOOP with no worker dispatch or unnecessary state writes             |
| Concurrent ticks                               | At most one effective dispatch for the same admitted work/generation |
| Dispatch response lost after acceptance        | Uncertain state; no blind repeat of the provider call                |
| Valid receipt repeated                         | Same result; no duplicate dispatch, close or publication             |
| Receipt identity, fingerprint or SHA conflicts | Blocked reconciliation with preserved evidence                       |
| Worker stops reporting                         | Visible last signal and age; no claim that it is still executing     |
| Capacity failure before acceptance             | Bounded backoff or eligible reassignment of the same work            |
| Authentication or human decision gate          | Stop the affected retries; retain the checkpoint                     |
| Existing result or PR                          | Recover and verify it rather than generate/publish it again          |
| Canonical work closed                          | Do not reactivate because a historical PR remains open               |
| Conflicting branch or scope                    | Block only the affected write                                        |
| Supervisor process restarted                   | Recover the same durable state without a duplicate model run         |
| Worker says completed but DoD is incomplete    | Delivery remains unverified or at its remaining gate                 |
| Production action                              | Requires the applicable explicit scope/version authorization         |
| Dashboard hostile text/URLs                    | Escaped content, approved link hosts, no executable markup           |

## Definition of Done

- [ ] Exact candidate SHA, branch and environment recorded.
- [ ] Existing authority and historical receipts preserved and revalidated.
- [ ] Two distinct real supervisor executions read the same durable state.
- [ ] A bounded nonproductive task reaches the actual worker and returns evidence.
- [ ] The result is reconciled against the correct contract, fingerprint and SHA.
- [ ] The dashboard accurately shows worker, attempt, tick, signal and result.
- [ ] Concurrent dispatch, lost acknowledgement and duplicate receipt checks pass.
- [ ] A subsequent execution recovers an interrupted attempt without duplication.
- [ ] Required technical checks pass on the final candidate, with links to evidence.
- [ ] A usable dashboard example is reviewed, including mobile width and focus.
- [ ] Activation state is explicit: prepared, tested, active, or waiting for release.
- [ ] Functional UAT and production approval are separately recorded where needed.

## Evidence levels and results

`node tests/automation/supervisor-dashboard.node.mjs` exercises pure rendering
with synthetic state. `node tests/automation/supervisor-evidence.node.mjs` exercises
the independent verifier with synthetic GitHub API responses. Together they prove
the tested formatting, source, SHA, scope and CI boundaries. They do not prove a
live worker, scheduler, authenticated browser session or a real interruption and
recovery. Neither test suite uses production data or dispatches an executor.

An injected lost acknowledgement is identified as injected. Two processes on one
machine are not two machines or proof of surviving destruction of a host. A read
of a persistent Goal is not another model turn. A dispatch success is not task
completion. The coordinating agent records these distinctions with each result.

The managed-process continuity fixture uses two real local Node child processes
with a synthetic JSONL worker protocol and synthetic checkpoint/effects. It
checks prior group closure, reading the saved checkpoint, one continuation and
zero additional launches on a repeated verified proof. It does not claim a real
Codex model turn, a Claude task, a C5 result or continuity after loss of that
machine. The managed adapter's tests must remain separately identified from the
remote Claude pilot and the durable GitHub observer run.

| Evidence                                     | Result / exact reference                                    |
| -------------------------------------------- | ----------------------------------------------------------- |
| Candidate branch and SHA                     | Pending                                                     |
| Pure renderer checks                         | 16 local synthetic cases passed                             |
| Independent evidence verifier                | 47 local synthetic cases passed; lint and formatting passed |
| Supervisor transition and transport checks   | Pending                                                     |
| Managed adapter and local process continuity | Pending final candidate result                              |
| Real worker dispatch and receipt             | Pending                                                     |
| Subsequent recovery execution                | Pending                                                     |
| Final CI                                     | Pending                                                     |
| Dashboard visual review                      | Pending                                                     |
| Runtime activation                           | Pending                                                     |
| Functional acceptance, if applicable         | Pending                                                     |
| Production authorization                     | Not included in implementation acceptance                   |
