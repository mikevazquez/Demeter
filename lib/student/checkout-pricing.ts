export type EnrollmentCheckoutRequirement = {
  missing?: boolean;
  price_minor?: number;
};

export function calculateSingleClassCheckout(
  dropInPriceMinor: number,
  enrollment: EnrollmentCheckoutRequirement | null,
) {
  const enrollmentExtraMinor =
    enrollment?.missing && Number.isInteger(enrollment.price_minor)
      ? (enrollment.price_minor ?? 0)
      : 0;

  return {
    dropInPriceMinor,
    enrollmentExtraMinor,
    totalMinor: dropInPriceMinor + enrollmentExtraMinor,
  };
}
