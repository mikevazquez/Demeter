type SelectablePackage = {
  reward_credit_wallet: boolean;
  active_now: boolean;
  unlimited: boolean;
  available_credits: number | null;
};

export function selectPrimaryStudentPackage<T extends SelectablePackage>(
  acquisitions: T[],
): T | null {
  const packages = acquisitions.filter((item) => !item.reward_credit_wallet);
  return (
    packages.find(
      (item) => item.active_now && (item.unlimited || (item.available_credits ?? 0) > 0),
    ) ??
    packages.find((item) => item.active_now) ??
    null
  );
}
