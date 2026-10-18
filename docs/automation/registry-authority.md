# Governance 2.0: shared authority across hosts (block 2)

The existing supervisor/adapter now requires a pinned GitHub registry authority
for new catalog-admitted tasks. The same single slot coordinates separate local
registries. Per-task execution/publication claims, checkpoint/result seals and the
single-Draft publisher remain in place. This adds no service, runner, queue or
second publisher. Legacy consumed pilots and their receipts are not rewritten.

## Authority and atomic transitions

The trusted supervisor supplies `{ ref, genesisSha }` outside the candidate. The
operational reference is `refs/heads/governance2/registry-318-v1`. Neither missing
local files nor a remote 404 initializes it automatically. Initialization is a
separate reviewed migration. A candidate cannot choose its own genesis or policy.

The reference points to a commit containing exactly one registry.json blob. Each
transition has exactly one parent: the previously observed authority head. The
writer uses GitHub's non-forced fast-forward update. Concurrent writers create
sibling commits, so at most one update can succeed. A rejected update or missing
acknowledgement never authorizes acquisition retry or model invocation. Unreachable
blob/tree/commit objects do not acquire a slot.

Readers validate the bounded ancestry to the pinned genesis, exact tree/blob
bytes, sequence, immutable history and permitted acquire/close transitions. New
entries retain the full admitted task, contract digest, logical work fingerprint
and owner nonce. A repeated workKey/ID or identical work renamed to another key
remains consumed after closure. This is exact-contract deduplication, not semantic
comparison of different goals or automatic successor approval.

There is one active task across these admitted-task hosts. There is no TTL,
heartbeat takeover, lock deletion or owner transfer. A dead host, missing local
record, outage, timeout or unknown execution retains the slot. The existing
per-ID execution claim still prevents repeating generation during recovery.
The GitHub writer identity is trusted: an administrator force-resetting/deleting
the authority or running obsolete bypassing code is outside this protocol. Deploy
only the reviewed supervisor; branch protection/credential administration is a
separate release concern, not silently configured here.

## Migration and activation

`inspectCanonicalRegistry` reads an idle original canonical registry, validates
contracts/receipts, verifies historical PR/commit or original terminal/checkpoint
records remotely, and hashes every evidence file. It rejects unresolved tasks,
links, altered receipts, active/mutation locks and verification-only copies. A
historical PR may have advanced, closed or been promoted: its original reviewed
receipt and commit still consume the ID. That rule is only for migration; a new
live closure requires a matching fresh open Draft.

Review and preserve the returned files/history digest outside the candidate.
Freeze old writers and revalidate that exact snapshot before explicit one-time
`initializeRegistryAuthority({ ref, baseSha, history, historySha256 })`. Pin the
returned genesis outside the candidate. Do not initialize from an unreviewed
archive, discard failed IDs, create an empty replacement after loss, or reset a
used reference. Lost initialization acknowledgement requires inspection, not a
new reference. The helper rechecks every imported remote closure; source freeze
and approved snapshot selection are trusted supervisor responsibilities.

The migration review for this block verifies the existing nine historical tasks
and 72 evidence files. The initial canonical authority was created idle from
that exact reviewed snapshot; the original evidence remains unchanged. Its
genesis is pinned in `registry-authority-318.json` for read-only CI inspection,
and outside the candidate in the supervisor handoff. Nine imported tombstones,
zero new entries and no active work were observed at initialization. This is
metadata initialization, not a model launch or application deployment. The external operational pin and approved
catalog are explicit supervisor inputs; their preparation does not start a
worker or publish application code. Empty example catalogs authorize no work.

## Existing adapter integration

Pass the same pinned authority to:

- `reserveApproved(repo, registry, catalog, workKey, { authority })`: validates
  local eligibility under the original mutex, acquires the global slot immediately
  before persisting the local reservation, then records the owner. A crash between
  remote acquisition and local persistence remains consumed remotely.
- `executeOnce(repo, registry, id, { trustedCatalog, authority })`: verifies the
  same local owner/config and remote contract before first execution and again
  after checkpoint immediately before native spawn. An existing executor remains
  inspection/replay only, without needing a live catalog or another invocation.
- `publishDraftOnce(repo, registry, id, metadata, { authority })`: checks the global
  contract, runs the existing independent certificate/owner/parent/bytes guards,
  reuses or creates the sole Draft, persists the original receipt and closes the
  global slot. Closure failure leaves it busy; replay reconciles the same receipt.
- `closeAuthBlocked(repo, registry, id, { authority })`: the existing narrow
  classifier verifies an exact pre-output authentication failure, retains its
  consumed evidence, then settles that terminal task globally. Other failures do
  not automatically release a slot.

The low-level `settleRegistryTask` is trusted-supervisor-only. It checks a fresh
remote receipt, sealed task/parent/path/file bytes for admitted published work,
or original terminal/checkpoint/owner evidence. Independent certification and
single-publication authorization remain the existing publisher's responsibility;
this helper cannot grant publication or invoke checks/model code. A repeated
identical closure is GET-only, even while another task owns the slot; a different
receipt fails. Recovery inspections are `readRegistryAuthority` and
`verifyRegistryTask`: neither adopts ownership, mutates local state nor authorizes
generation. Lost local ownership requires reconciliation, not a new owner.

Capacity is deliberately finite: 100 imported records, 100 newly admitted tasks,
201 authority commits and 1 MiB per registry blob. Exceeding it fails closed;
reviewed migration must preserve consumed history instead of pruning silently.

## Acceptance and limits

Unit tests use disposable Git/files and an explicit REST fixture. They cover slot
exclusion, CAS conflicts, lost acquisition/closure responses, integrity/ancestry,
consumption, owner/config guards, historical migration and terminal closure.
They do not call a model or mutate the canonical registry.

The real transport proof uses a separate `coordination-proof-318-...` reference,
two processes/checkouts/local registries, real GitHub non-forced updates and a
controlled loss of the winning acknowledgement. Another pair of processes reads
the same result; duplicate admissions perform only GETs. The proof namespace is
not an operational authority and must never be supplied as an operational pin.
Its consumed active proof entry is preserved, not cleared to retry. A controlled
client-side loss after actual acknowledgement is identified as injected, not
claimed as an unobserved network outage. Separate processes on one host are not
proof of two VMs, host destruction/reboot or permanent hosting.

CI also reads the same pinned proof and the canonical imported history from the
existing Actions runner with a
GET-only wrapper and read-only repository permissions. It reports the authority
head and zero writes/model calls; it never restores an operational registry or
acquires work. The report is retained with the existing recovery artifact.

Block 3 completed its separately delimited authentic admitted-task E2E in #334;
the canonical slot closed without recycling its ID. The existing runner then
verified that exact closed receipt with GET-only access. See the acceptance ledger
and remaining integration gate in `governance2-operation.md`. The block 4 review
does not merge, deploy, activate a worker or authorize another model task.
