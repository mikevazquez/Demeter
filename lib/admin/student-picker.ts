type SelectableStudentCandidate = {
  eligible: boolean;
  detail: string;
};

export function normalizeStudentSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function canSearchStudents(value: string) {
  return normalizeStudentSearch(value).length >= 2;
}

export function canSelectStudentCandidate(candidate: SelectableStudentCandidate) {
  return candidate.eligible;
}

export function hasSelectedStudent(studentId: string) {
  return studentId.trim().length > 0;
}
