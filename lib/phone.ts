export function normalizeMexicanPhone(value: string) {
  const raw = value.trim();
  if (!raw) return null;

  const digits = raw.replace(/\D/g, "");
  let normalized: string;

  if (raw.startsWith("+") && digits.length >= 8 && digits.length <= 15) {
    normalized = `+${digits}`;
  } else if (digits.length === 10) {
    normalized = `+52${digits}`;
  } else if (digits.length === 12 && digits.startsWith("52")) {
    normalized = `+${digits}`;
  } else {
    return null;
  }

  return /^\+[1-9][0-9]{7,14}$/.test(normalized) ? normalized : null;
}
