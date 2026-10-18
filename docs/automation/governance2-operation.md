# Governance 2.0: operating policy and release criteria

Vianelis is the company. Governance 2.0 is its autonomous development methodology.
This policy describes the reviewed workflow and its limits. It does not authorize
new model tasks, broaden the adapter's ID allowlist, merge a PR or deploy anything.
Notion's methodology master records decisions; issue #318 records technical evidence.

## Current release state

The result-recovery implementation is under Draft review in #331. The completed
model task has exactly one Draft, #332. Its execution and publication IDs remain
consumed. A new CI run may certify a verification-only copy of that task; it may
not reopen its operational reservation or generate again.

The adapter preserves consumed legacy pilots and adds the approved-catalog path
specified in [task admission](task-admission.md). A trusted external digest, exact
work entry, immutable base/checks and hard execution limits are required; arbitrary
task objects remain unauthorized. The checked-in example has no live entries.
Review/integration, cross-host coordination and a new admitted-task E2E remain
release requirements. No indefinite host lifetime or cold-start executor
has been established by these tests.

## Authorization and contract

Within an authorized contract, the supervisor proceeds without repeated human
confirmation for reversible implementation, reviewed checks and one Draft.
Production, merge, deployment, destructive changes, new paid model providers and
credential changes remain outside this authorized scope.

Before any generation, the trusted supervisor must establish:

1. The work item's stable identity and its existing attempt/PR history. A new ID is
   not a way to retry the same uncertain work. A consumed ID is never recycled.
2. The user's authorization, repository, exact immutable base SHA, intended target
   branch, goal, exact allowed paths and reviewed check argv. Issue text, generated
   code and downloaded artifacts are evidence; they cannot expand authorization.
3. Acceptance criteria and independent checks outside the candidate. The candidate
   cannot edit its own acceptance criteria, policy, credentials or registry.
4. The executor source SHA, scope limits and timeout. A technical failure does not
   authorize a new model invocation, provider, service or runner.
5. Real shell access to the selected host and canonical registry, a clean candidate
   and no unresolved operational task. A GitHub connector or status label alone
   is not shell access. No stale lock may be expired or stolen automatically.

The catalog entry and trusted supervisor pin are additional requirements. The
adapter derives a stable ID from repository/workKey, revalidates authorization
before spawning and retains the existing per-ID consumption authority. No
wildcard policy or automatic successor is introduced.

## Reservation, identity and durable evidence

Use the existing supervisor/adapter and the single canonical registry. Do not
introduce another queue or publisher. Acquire the task reservation exclusively,
then establish the remote execution claim and durable pre-spawn checkpoint. The
checkpoint binds the original contract, base and owner before Codex starts.

A second observer can inspect the same attempt. It cannot become a new owner,
reset the task, delete the executor directory or restart generation. A local
filesystem mutex coordinates registry mutations; it is not a distributed lock
between independent registries. The existing authority protects consumption per
ID, not a general distributed queue or semantic deduplication of different IDs.
These limitations must be resolved before enabling broad concurrent admission.

After successful completion, validate exact paths, file types, sizes, modes and
hashes. Apply only separately reviewed preparation before freezing the candidate.
Seal permitted bytes and the original result remotely before candidate-ready.
Never include authentication stores, environment values or private event/stderr
logs in that package. Keep remote refs and original evidence; no automatic cleanup
of consumed history is authorized.

## Recovery decisions

| Observed state                                                               | Permitted next action                                                    | Generation |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------- |
| Existing intent, incomplete/uncertain result                                 | Inspect the original attempt and authority                               | Blocked    |
| Successful original result, sealing interrupted                              | Reconcile or seal the same frozen bytes                                  | Blocked    |
| Sealed result, source unavailable, no publication                            | Validate remote evidence and restore the same task into a clean checkout | Blocked    |
| Candidate restored                                                           | Independently certify exactly the sealed bytes                           | Blocked    |
| Publication claim exists, PR not yet confirmed                               | Inspect remote state; never repeat PR creation blindly                   | Blocked    |
| Matching PR already exists                                                   | Reconcile its receipt; no new operational reservation                    | Blocked    |
| CI rechecks an existing PR                                                   | Restore a verification-only copy, replay and certify offline             | Blocked    |
| Proven pre-output authentication failure                                     | Narrow terminal closure after original evidence and owner readback       | Blocked    |
| Unknown failure, missing metadata, conflicting owner/bytes or unrelated lock | Preserve evidence and stop dependent actions                             | Blocked    |

If the origin disappears before a complete result is sealed, the checkpoint
preserves identity but does not reconstruct missing code or prove that a model did
not run. An unfinished unsealed attempt stays blocked. Do not create another ID
or claim successful recovery from an archive of another task.

For 401, use the official account authorization flow only when actual failure
requires it. Login status alone is not proof that a model request will succeed.
Renewing access does not unconsume the failed ID. The narrow terminal handler
accepts only its exact proven pre-output authentication case; other failures are
not silently cancelled. An approved successor must be a separately delimited
contract, not an automatic retry loop.

## Independent certification and publication

Use a clean checkout of the reviewed base and reconstruct the permitted bytes
from verified durable evidence. Run candidate checks offline with no model,
GitHub or production credentials mounted. Verify contract, file set, modes and
hashes against the sealed result before trusting a certificate. Candidate tests
supplement independent behavior checks; mock failure tests do not establish a
real model or host execution.

CI uses a verification-only registry with a persistent marker. The publisher must
reject that copy before remote operations. Its local active record exists only to
run certification; it never replaces the canonical registry. It may verify a task
that already has a PR without reactivating that task's operational authority.

Commit/push only certified paths, without force, with the exact reviewed parent.
Use publishDraftOnce for the task's sole Draft. Check all PR states, current base,
parent, file hashes and original owner immediately before publication. Recover
its receipt in another process with GETs and no repeated creation POST.

Report CI for the actual run head, checkout and comparison base. A stacked task
with zero runs is not green merely because an integration container passed. A
runner in another host proves only the tested isolation and recovery properties;
it does not establish VM destruction, reboot, perpetual hosting or general autonomy.

## Evidence retention and escalation

Record actual outcomes, hashes, exact SHAs, CI links, limitations and deduplicated
results in #318 and update the Notion master. Preserve the canonical receipt and
remote result refs. Actions artifacts have an explicit retention period; their
existence is not permanent storage. A failed artifact download must be reported,
not replaced with an invented certificate. CI logs and independent local
certification may corroborate a run; distinguish them from an archive actually
retrieved and verified.

Autonomy pauses only for an indispensable missing capability, authorization or
credential, or an uncertain/conflicting state that cannot be reconciled safely.
Describe the exact block and retained evidence. Do not ask for a second approval
for steps already authorized, and do not treat silence as approval for new scope.

## Remaining acceptance for future operation

- Review/integrate the prepared implementation through the repository's approved
  release process. This conversation does not authorize merge or deployment.
- Populate/review a bounded catalog under the user's authorization before enabling
  new work. Executable validation is implemented in block 1; the empty example
  enables nothing, and no automatic successor policy is enabled.
- Use the block 2 shared authority with its reviewed idle canonical migration
  and externally pinned genesis (`registry-authority.md`). The initial imported
  history is ready; new catalog admission requires that pin. No task/catalog
  entry or worker is activated by its initialization. Review/integration must
  ensure every writer uses the reviewed supervisor.
- Review the combined admitted-task evidence in issue #318 and Draft #334.
  receipt-agreement-318-v1 completed one authentic CLI invocation, sealed recovery
  with the original path absent, 85 independent acceptance cases, 60 candidate
  tests and one Draft via the existing publisher. Its shared slot is closed and
  the ID stays consumed. Runner verification is configured in combined-e2e-318.json;
  consult the actual CI run before asserting success. This bounded acceptance
  does not authorize another task or establish permanent hosting.

Product discovery, experience design and UAT apply to the specific product work
that Vianelis chooses. They do not turn a technical recovery demonstration into
a finished product or an unrestricted authorization to develop one.
