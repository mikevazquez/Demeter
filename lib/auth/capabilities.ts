export const CAPABILITIES = {
  ADMIN_PORTAL: "admin.portal",
  STUDENTS_READ: "students.read",
  STUDENTS_WRITE: "students.write",
  STUDENTS_ARCHIVE: "students.archive",
  INSTRUCTORS_READ: "instructors.read",
  INSTRUCTORS_WRITE: "instructors.write",
  SCHEDULE_READ: "schedule.read",
  SCHEDULE_WRITE: "schedule.write",
  ATTENDANCE_WRITE: "attendance.write",
  PRODUCTS_READ: "products.read",
  PRODUCTS_WRITE: "products.write",
  SALES_READ: "sales.read",
  SALES_WRITE: "sales.write",
  REPORTS_READ: "reports.read",
  REQUIRED_ACTIONS_READ: "required_actions.read",
  REQUIRED_ACTIONS_MANAGE: "required_actions.manage",
  AUTOMATIONS_READ: "automations.read",
  AUTOMATIONS_MANAGE: "automations.manage",
  REWARDS_READ: "rewards.read",
  REWARDS_MANAGE: "rewards.manage",
  SETTINGS_WRITE: "settings.write",
  STUDENT_PORTAL: "student.portal",
  STUDENT_PROFILE_SELF: "student.profile.self",
  STUDENT_BOOKING_SELF: "student.booking.self",
  INSTRUCTOR_PORTAL: "instructor.portal",
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

export type CanonicalStudioRole = "owner" | "admin" | "reception" | "instructor" | "student";
