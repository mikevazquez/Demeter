export type ProvisionStudioState = {
  status: "idle" | "success" | "error";
  message?: string;
  studioId?: string;
  studioSlug?: string;
  ownerEmail?: string;
  planKey?: string;
  activationRequired?: boolean;
  activationLink?: string | null;
  reusedExistingAccount?: boolean;
};

export const initialProvisionStudioState: ProvisionStudioState = {
  status: "idle",
};
