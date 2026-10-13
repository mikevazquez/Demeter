export function canActivateStudioAccount(roles: readonly string[]) {
  return roles.some((role) => ["owner", "admin", "instructor"].includes(role));
}
