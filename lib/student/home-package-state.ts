type HomePackage = {
  unlimited: boolean;
  available_credits: number | null;
};

export function getStudentHomePackageState(activePackage: HomePackage | null) {
  const credits =
    !activePackage || activePackage.unlimited ? null : (activePackage.available_credits ?? 0);
  const noCredits = Boolean(activePackage && !activePackage.unlimited && credits === 0);
  const canReserve = Boolean(activePackage && (activePackage.unlimited || (credits ?? 0) > 0));

  return { credits, noCredits, canReserve };
}
