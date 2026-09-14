-- Phone is the required operational contact for students and the future login identifier.
-- Store phone numbers in E.164 and keep them unique within each studio.

update public.students
set phone = null
where phone is not null and btrim(phone) = '';

alter table public.students
  add constraint students_phone_e164_chk
  check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$') not valid;

-- No students exist yet in the clean environment, so this is safe to enforce now.
alter table public.students
  alter column phone set not null;

alter table public.students
  validate constraint students_phone_e164_chk;

create unique index students_studio_phone_unique_idx
  on public.students (studio_id, phone);
