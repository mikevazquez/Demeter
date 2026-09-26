export const STUDIO_MODULES = {
  CORE: "core",
  WAITLIST: "waitlist",
  RESOURCES: "resources",
  DOCUMENTS: "documents",
  EVALUATIONS: "evaluations",
  REWARDS: "rewards",
  AUTOMATIONS: "automations",
  INTELLIGENCE: "intelligence",
  NOTIFICATIONS: "notifications",
  INTEGRATIONS: "integrations",
} as const;

export type StudioModule = (typeof STUDIO_MODULES)[keyof typeof STUDIO_MODULES];
