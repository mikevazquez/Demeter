create table if not exists public.workshop_studio_policies (
 studio_id uuid primary key references public.studios(id),
 requires_enrollment boolean not null default false,
 overdue_mode text not null default 'keep_and_notify' check (overdue_mode in ('keep_and_notify','release_after_grace')),
 grace_minutes integer not null default 0 check (grace_minutes between 0 and 525600),
 updated_at timestamptz not null default now()
);
create table if not exists public.workshop_offers (
 id uuid primary key default gen_random_uuid(),
 studio_id uuid not null references public.studios(id),
 title text not null,
 discipline_id uuid references public.disciplines(id),
 full_price_minor integer not null check (full_price_minor>=0),
 allow_individual_sessions boolean not null default false,
 requires_enrollment boolean,
 overdue_mode text check (overdue_mode in ('keep_and_notify','release_after_grace')),
 grace_minutes integer check (grace_minutes between 0 and 525600),
 deposit_mode text not null default 'full' check (deposit_mode in ('full','fixed','percent')),
 deposit_value numeric(12,2) check (deposit_value>=0),
 balance_due_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public.workshop_offer_sessions (
 offer_id uuid not null references public.workshop_offers(id),
 session_id uuid not null references public.class_sessions(id),
 individual_price_minor integer check (individual_price_minor>=0),
 primary key (offer_id,session_id)
);
create table if not exists public.workshop_purchases (
 id uuid primary key default gen_random_uuid(),
 studio_id uuid not null references public.studios(id),
 offer_id uuid not null references public.workshop_offers(id),
 student_id uuid not null references public.students(id),
 sale_id uuid references public.sales(id),
 total_minor integer not null check (total_minor>=0),
 paid_minor integer not null default 0 check (paid_minor>=0),
 balance_due_at timestamptz,
 overdue_mode text not null check (overdue_mode in ('keep_and_notify','release_after_grace')),
 grace_minutes integer not null default 0 check (grace_minutes between 0 and 525600),
 status text not null default 'pending_payment' check (status in ('pending_payment','reserved','released','cancelled')),
 released_at timestamptz,
 created_at timestamptz not null default now(),
 idempotency_key uuid not null,
 unique(studio_id,idempotency_key)
);
create table if not exists public.workshop_purchase_sessions (
 purchase_id uuid not null references public.workshop_purchases(id),
 session_id uuid not null references public.class_sessions(id),
 reservation_id uuid references public.reservations(id),
 primary key (purchase_id,session_id)
);
create index if not exists workshop_purchases_due_idx on public.workshop_purchases(balance_due_at) where status='reserved';
alter table public.workshop_studio_policies enable row level security;
alter table public.workshop_offers enable row level security;
alter table public.workshop_offer_sessions enable row level security;
alter table public.workshop_purchases enable row level security;
alter table public.workshop_purchase_sessions enable row level security;
revoke all on public.workshop_studio_policies, public.workshop_offers, public.workshop_offer_sessions, public.workshop_purchases, public.workshop_purchase_sessions from anon, authenticated;
