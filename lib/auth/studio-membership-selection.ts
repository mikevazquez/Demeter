/**
 * Choose a studio only from memberships already authorized for the user.
 * The caller must filter active memberships before this selection.
 */
export function selectAuthorizedStudioMembership<T extends { studio_id: string }>(
  memberships: readonly T[],
  selectedStudioId?: string | null,
): T | null {
  const selectedMembership = selectedStudioId
    ? memberships.find((membership) => membership.studio_id === selectedStudioId)
    : undefined;

  return selectedMembership ?? (memberships.length === 1 ? memberships[0] : null);
}
