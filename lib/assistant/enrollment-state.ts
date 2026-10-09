type Enrollment = {
  status: string;
  starts_on: string;
  expires_on: string | null;
};

export function resolveEnrollmentStatus(
  enrollments: Enrollment[],
  today: string,
): "active" | "expired" | "missing" {
  if (
    enrollments.some(
      (item) =>
        item.status === "active" &&
        item.starts_on <= today &&
        (!item.expires_on || item.expires_on >= today),
    )
  )
    return "active";
  if (
    enrollments.some(
      (item) =>
        item.status === "expired" ||
        (item.status === "active" && Boolean(item.expires_on && item.expires_on < today)),
    )
  )
    return "expired";
  return "missing";
}
