export type StudentDirectoryRelationshipStatus =
  "active" | "expired" | "trial" | "prospect" | "inactive";

export function deriveStudentDirectoryRelationshipStatus(input: {
  lifecycleStatus: string;
  studentType?: string | null;
  trialStatus?: string | null;
  hasCurrentProduct: boolean;
  hasExpiredProduct: boolean;
}): StudentDirectoryRelationshipStatus {
  if (input.lifecycleStatus === "inactive") return "inactive";
  if (input.hasCurrentProduct) return "active";
  if (input.studentType === "trial" && input.trialStatus !== "converted") return "trial";
  if (input.hasExpiredProduct) return "expired";
  return "prospect";
}
