// Host-owned GitHub REST transport holds the credential; this module never loads
// one. Each UUID is an atomic create-only ref. Protect the namespace against
// update/deletion before activation. No deletion, force update or retry exists.
import { verifyReservationRuleset } from "./metadata-broker-rules.mjs";
const REPO = "/repos/mikevazquez/Demeter";
export const RESERVATION_PREFIX = "evidence/sf-gov-broker-reservations/";
export const REHEARSAL_PREFIX = "evidence/sf-gov-broker-reservation-rehearsal/";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const deny = () => {
  throw new Error("Broker reservation denied");
};
export function githubReservationStore({
  api,
  controllerSha,
  baseTreeSha,
  rehearsal = false,
  rulesetId,
}) {
  if (
    typeof api !== "function" ||
    (!rehearsal && (!Number.isSafeInteger(rulesetId) || rulesetId <= 0)) ||
    !SHA.test(controllerSha ?? "") ||
    !SHA.test(baseTreeSha ?? "")
  )
    deny();
  const prefix = rehearsal ? REHEARSAL_PREFIX : RESERVATION_PREFIX;
  return async (requestId, binding) => {
    try {
      if (
        typeof requestId !== "string" ||
        !UUID.test(requestId) ||
        typeof binding !== "string" ||
        !HASH.test(binding)
      )
        deny();
      if (!rehearsal) {
        const protection = await api("GET", REPO + "/rulesets/" + rulesetId);
        if (protection.status !== 200) deny();
        verifyReservationRuleset(protection.body);
      }
      const branch = prefix + requestId;
      const current = await api("GET", REPO + "/git/ref/heads/" + branch);
      if (current.status === 200) return false;
      if (current.status !== 404) deny();
      const record = {
        version: 1,
        source: "sf-gov-broker-reservation",
        rehearsal,
        request_id: requestId,
        binding,
        controller_sha: controllerSha,
      };
      const tree = await api("POST", REPO + "/git/trees", {
        base_tree: baseTreeSha,
        tree: [
          {
            path: "evidence/broker-reservation.json",
            mode: "100644",
            type: "blob",
            content: JSON.stringify(record) + "\n",
          },
        ],
      });
      if (tree.status !== 201 || !SHA.test(tree.body?.sha ?? "")) deny();
      const commit = await api("POST", REPO + "/git/commits", {
        message: "Record metadata broker reservation " + requestId,
        parents: [controllerSha],
        tree: tree.body.sha,
      });
      if (commit.status !== 201 || !SHA.test(commit.body?.sha ?? "")) deny();
      const ref = await api("POST", REPO + "/git/refs", {
        ref: "refs/heads/" + branch,
        sha: commit.body.sha,
      });
      // GitHub's create-ref endpoint is atomic. A competing creator receives
      // 422; do not use update-ref or adopt a reservation created by another run.
      if (ref.status === 422) return false;
      if (
        ref.status !== 201 ||
        ref.body?.ref !== "refs/heads/" + branch ||
        ref.body?.object?.sha !== commit.body.sha
      )
        deny();
      return true;
    } catch {
      deny();
    }
  };
}
