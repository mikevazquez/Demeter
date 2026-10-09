import { newProspect, type CrmState } from "./demi-state";
export type Validity = {
  id: string;
  status: string;
  starts_on: string | null;
  expires_on: string | null;
  refunded_at: string | null;
};
export function projectContact(input: {
  today: string;
  studentType?: string | null;
  studentCreatedOn?: string | null;
  inactivityDays?: number;
  trialStatus?: string | null;
  reservation?: { id: string; status: string; commercial_status: string } | null;
  paymentStatus?: string | null;
  enrollments: Validity[];
  packages: Validity[];
  followup?: {
    prospect_stage: string;
    qualification: string;
    qualification_reason: string | null;
    human_reason: string | null;
    human_summary: string | null;
  } | null;
}): CrmState {
  const state = newProspect();
  const current = (v: Validity) =>
    !v.refunded_at &&
    v.status === "active" &&
    (!v.starts_on || v.starts_on <= input.today) &&
    (!v.expires_on || v.expires_on >= input.today);
  const enrollment = input.enrollments.find(current);
  const expiredEnrollment = input.enrollments.find(
    (v) =>
      !v.refunded_at &&
      (v.status === "expired" ||
        (v.status === "active" && !!v.expires_on && v.expires_on < input.today)),
  );
  const hasActivePackage = input.packages.some(current);
  const lastPackageDate = input.packages
    .filter(
      (v) =>
        !v.refunded_at && v.status !== "cancelled" && (!v.starts_on || v.starts_on <= input.today),
    )
    .map((v) => v.expires_on || v.starts_on)
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1);
  const lastEnrollmentDate = input.enrollments
    .filter((v) => !v.refunded_at && v.status !== "cancelled")
    .map((v) => v.starts_on || v.expires_on)
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1);
  const inactiveSince =
    lastPackageDate || lastEnrollmentDate || input.studentCreatedOn?.slice(0, 10);
  const inactiveDays = inactiveSince
    ? Math.floor((Date.parse(input.today) - Date.parse(inactiveSince)) / 86_400_000)
    : 0;
  const becameExStudent =
    input.studentType === "regular" &&
    !hasActivePackage &&
    inactiveDays >= (input.inactivityDays ?? 15);
  if (becameExStudent) {
    state.personType = "former_student";
    state.stage = "enrollment_expired";
  } else if (enrollment) {
    state.personType = "student";
    state.stage = "enrollment_current";
    state.enrollmentId = enrollment.id;
  } else if (expiredEnrollment && input.studentType !== "regular") {
    state.personType = "former_student";
    state.stage = "enrollment_expired";
    state.enrollmentId = expiredEnrollment.id;
  } else if (input.studentType === "regular") {
    state.personType = "student";
    state.stage = "enrollment_current";
    state.enrollmentId = null;
  } else if (
    input.studentType === "trial" &&
    (input.reservation || ["attended", "no_show"].includes(input.trialStatus || ""))
  ) {
    state.personType = "trial";
    state.reservationId = input.reservation?.id || null;
    const attendance = ["attended", "no_show"].includes(input.trialStatus || "")
      ? input.trialStatus
      : input.reservation?.status;
    state.stage =
      attendance === "attended"
        ? "attended"
        : attendance === "no_show"
          ? "not_attended"
          : "scheduled";
  }
  state.package = hasActivePackage
    ? "active"
    : input.packages.some((v) => !v.refunded_at && !!v.expires_on && v.expires_on < input.today)
      ? "expired"
      : "none";
  const payment = input.paymentStatus;
  state.payment =
    payment === "approved"
      ? "validated"
      : payment === "rejected"
        ? "rejected"
        : payment === "cash_due"
          ? "cash_due"
          : payment === "receipt_required"
            ? "awaiting_receipt"
            : payment === "human_review" || payment === "online_pending"
              ? "under_review"
              : "none";
  if (
    state.personType === "trial" &&
    (payment === "rejected" || input.reservation?.commercial_status === "payment_rejected")
  )
    state.stage = "payment_rejected";
  const f = input.followup;
  if (f) {
    state.qualification = f.qualification as CrmState["qualification"];
    state.qualificationReason = f.qualification === "not_qualified" ? f.qualification_reason : null;
    if (state.personType === "prospect")
      state.stage =
        state.qualification === "not_qualified"
          ? "not_qualified"
          : (f.prospect_stage as CrmState["stage"]);
    if (f.human_reason)
      state.human = {
        reason: f.human_reason as NonNullable<CrmState["human"]>["reason"],
        summary: f.human_summary ?? "",
      };
  }
  return state;
}
