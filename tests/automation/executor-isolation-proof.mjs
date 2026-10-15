// AUTONOMY-ISOLATION-V1
// These are expected boundaries, not self-certified runtime evidence.
// The coordinator independently verifies runtime isolation with trusted checks.
export const executionBoundary = Object.freeze({
  network: 'denied',
  publicationCredentials: 'absent',
});
