-- DISCIPLINE ARTWORK · optional student-facing image per discipline

alter table public.disciplines
  add column if not exists cover_image_path text;

comment on column public.disciplines.cover_image_path is
  'Optional path in class-artwork storage used as the discipline-level fallback image in the student portal.';
