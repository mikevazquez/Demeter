// The phone remains the student-facing login identifier, not an operational primary key.
// Supabase Auth receives only this deterministic, non-routable technical email alias.
export function studentAuthEmailFromPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) return null;

  return `student.${digits}@auth.studioflow.invalid`;
}
