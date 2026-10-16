export const RESERVATION_PATTERN =
  "refs/heads/evidence/sf-gov-broker-reservations/*";
export function verifyReservationRuleset(ruleset) {
  const deny = () => {
    throw new Error("Reservation namespace protection not verified");
  };
  if (
    ruleset?.target !== "branch" ||
    ruleset.enforcement !== "active" ||
    !Array.isArray(ruleset.bypass_actors) ||
    ruleset.bypass_actors.length !== 0
  )
    deny();
  const refs = ruleset.conditions?.ref_name;
  if (
    !Array.isArray(refs?.include) ||
    refs.include.length !== 1 ||
    refs.include[0] !== RESERVATION_PATTERN ||
    !Array.isArray(refs.exclude) ||
    refs.exclude.length !== 0
  )
    deny();
  if (!Array.isArray(ruleset.rules) || ruleset.rules.length !== 3) deny();
  const types = ruleset.rules.map((r) => r.type).sort();
  if (
    types.join(",") !== "deletion,non_fast_forward,update" ||
    ruleset.rules.some(
      (r) => r.parameters?.update_allows_fetch_and_merge === true,
    )
  )
    deny();
  return true;
}
