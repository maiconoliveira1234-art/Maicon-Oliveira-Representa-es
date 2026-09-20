create table public.google_calendar_connection (
 id boolean primary key default true check(id),
 refresh_token text, calendar_id text, google_sub text,
 last_sync_date date, last_sync_at timestamptz, last_count integer,
 last_error text, lock_until timestamptz not null default '1970-01-01',
 cron_secret text not null default (gen_random_uuid()::text || gen_random_uuid()::text)
);
insert into public.google_calendar_connection(id) values(true);
create table public.google_calendar_states (
 state text primary key, verifier text not null, expires_at timestamptz not null
);
alter table public.google_calendar_connection enable row level security;
alter table public.google_calendar_states enable row level security;
revoke all on public.google_calendar_connection, public.google_calendar_states from public, anon, authenticated;
grant all on public.google_calendar_connection, public.google_calendar_states to service_role;
