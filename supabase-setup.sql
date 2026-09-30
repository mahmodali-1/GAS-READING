-- =====================================================================
--  Midal Cables · Furnace Gas Monitor — database setup for Supabase
--  Paste this whole file into Supabase → SQL Editor → New query → Run.
--  Safe to run again: it only creates what is missing and refreshes rules.
--
--  Roles
--    manager    : full access to everything
--    supervisor : can only SEND daily readings and see each furnace's
--                 last reading; cannot read history, reports or exports
--    (no role)  : sees nothing — new logins start here until you assign one
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  role         text check (role in ('manager', 'supervisor')),
  display_name text
);

create table if not exists public.furnaces (
  id     text primary key,
  name   text not null,
  code   text not null default '',
  grp    text not null default '',
  mode   text not null default 'meter' check (mode in ('meter', 'consumption')),
  active boolean not null default true,
  sort   integer not null default 0
);

create table if not exists public.readings (
  furnace_id    text not null references public.furnaces(id) on delete cascade,
  reading_date  date not null,
  value         double precision not null,
  note          text not null default '',
  entered_by    text not null default '',
  entered_by_id uuid,
  entered_at    timestamptz not null default now(),
  primary key (furnace_id, reading_date)
);
create index if not exists readings_date_idx on public.readings (reading_date);
create index if not exists readings_entered_idx on public.readings (entered_by_id, reading_date);

create table if not exists public.settings (
  id          integer primary key default 1 check (id = 1),
  unit        text not null default 'Nm³',
  threshold   numeric not null default 40,
  window_days integer not null default 30
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.requests (
  id           uuid primary key default gen_random_uuid(),
  furnace_id   text not null references public.furnaces(id) on delete cascade,
  reading_date date not null,
  message      text not null,
  status       text not null default 'open' check (status in ('open', 'closed')),
  created_at   timestamptz not null default now(),
  closed_at    timestamptz
);

-- --------------------------------------------------------------- helpers
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'manager' from public.profiles where id = auth.uid()), false)
$$;

-- every new login gets a profile WITHOUT a role (sees nothing)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- profiles for logins created before this script ran
insert into public.profiles (id, display_name)
select id, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

-- ------------------------------------------------------ row level security
alter table public.profiles enable row level security;
alter table public.furnaces enable row level security;
alter table public.readings enable row level security;
alter table public.settings enable row level security;
alter table public.requests enable row level security;

drop policy if exists "profiles: read own or manager" on public.profiles;
create policy "profiles: read own or manager" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_manager());
drop policy if exists "profiles: manager edits" on public.profiles;
create policy "profiles: manager edits" on public.profiles
  for update to authenticated using (public.is_manager()) with check (public.is_manager());

-- furnace list: anyone with a role can read it, only the manager changes it
drop policy if exists "furnaces: read with role" on public.furnaces;
create policy "furnaces: read with role" on public.furnaces
  for select to authenticated using (public.my_role() is not null);
drop policy if exists "furnaces: manager writes" on public.furnaces;
create policy "furnaces: manager writes" on public.furnaces
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- readings: ONLY the manager reads or writes the table directly.
-- The supervisor goes through the functions further down.
drop policy if exists "readings: manager only" on public.readings;
create policy "readings: manager only" on public.readings
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

drop policy if exists "settings: read with role" on public.settings;
create policy "settings: read with role" on public.settings
  for select to authenticated using (public.my_role() is not null);
drop policy if exists "settings: manager writes" on public.settings;
create policy "settings: manager writes" on public.settings
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

drop policy if exists "requests: manager all" on public.requests;
create policy "requests: manager all" on public.requests
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- -------------------------------------------- supervisor-only functions
-- send (or correct) readings for one day.
-- Supervisor rules (enforced here, not in the page):
--   • only today or yesterday (Bahrain time) — older dates only when the
--     manager has an open change request for that furnace and day
--   • never overwrites a reading someone else entered, unless the manager
--     asked for a correction
--   • at most 100 readings per send, values 0 … 1,000,000,000,000
create or replace function public.submit_readings(p_date date, p_items jsonb, p_by text default '')
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_role   text := public.my_role();
  v_today  date := (now() at time zone 'Asia/Bahrain')::date;
  v_items  jsonb := coalesce(p_items, '[]'::jsonb);
  v_name   text;
  v_n      integer := 0;
  v_fid    text;
  v_val    double precision;
  v_open   boolean;
  v_owner  uuid;
  it       jsonb;
begin
  if v_role is null then raise exception 'This login has no role yet'; end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) > 100 then
    raise exception 'Send at most 100 readings at a time';
  end if;
  if p_date > v_today or p_date < v_today - 30 then raise exception 'Date must be within the last 30 days'; end if;
  v_name := left(coalesce(nullif(trim(p_by), ''), (select display_name from public.profiles where id = auth.uid()), ''), 60);
  for it in select * from jsonb_array_elements(v_items) loop
    v_fid := it ->> 'furnace_id';
    continue when (it ->> 'value') is null;
    continue when not exists (select 1 from public.furnaces f where f.id = v_fid and f.active);
    v_val := (it ->> 'value')::double precision;
    if v_val <> v_val or v_val < 0 or v_val >= 1e12 then raise exception 'Reading out of range'; end if;
    v_open := exists (select 1 from public.requests q
                      where q.furnace_id = v_fid and q.reading_date = p_date and q.status = 'open');
    if v_role <> 'manager' and p_date < v_today - 1 and not v_open then
      raise exception 'Only today or yesterday can be entered';
    end if;
    select r.entered_by_id into v_owner from public.readings r where r.furnace_id = v_fid and r.reading_date = p_date;
    if found and v_role <> 'manager' and v_owner is distinct from auth.uid() and not v_open then
      continue;   -- keep the value the manager (or an import) entered
    end if;
    insert into public.readings (furnace_id, reading_date, value, note, entered_by, entered_by_id, entered_at)
    values (v_fid, p_date, v_val, left(coalesce(it ->> 'note', ''), 500), v_name, auth.uid(), now())
    on conflict (furnace_id, reading_date) do update
      set value = excluded.value, note = excluded.note, entered_by = excluded.entered_by,
          entered_by_id = excluded.entered_by_id, entered_at = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;

-- last reading before a date for each furnace, plus a rough "typical" daily use,
-- so the entry page can warn about typos without exposing the history
create or replace function public.last_readings(p_date date)
returns table (furnace_id text, prev_date date, prev_value double precision, typical double precision)
language sql stable security definer set search_path = public as $$
  select f.id, l.reading_date, l.value,
         case
           when f.mode = 'consumption' then
             (select avg(r.value) from public.readings r
               where r.furnace_id = f.id and r.reading_date < p_date and r.reading_date >= p_date - 30 and r.value > 0)
           when o.reading_date is not null and l.reading_date > o.reading_date and l.value >= o.value then
             (l.value - o.value) / (l.reading_date - o.reading_date)
         end
  from public.furnaces f
  left join lateral (
    select r.reading_date, r.value from public.readings r
    where r.furnace_id = f.id and r.reading_date < p_date
    order by r.reading_date desc limit 1) l on true
  left join lateral (
    select r.reading_date, r.value from public.readings r
    where r.furnace_id = f.id and r.reading_date <= l.reading_date - 25
    order by r.reading_date desc limit 1) o on true
  where public.my_role() is not null
$$;

-- the supervisor's own recent submissions (dates and counts only)
create or replace function public.my_submissions()
returns table (reading_date date, furnaces integer, sent_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.reading_date, count(*)::integer, max(r.entered_at)
  from public.readings r
  where r.entered_by_id = auth.uid() and r.reading_date >= (now() at time zone 'Asia/Bahrain')::date - 30
  group by r.reading_date
  order by r.reading_date desc
$$;

-- the values the supervisor himself sent for one day (so he can correct them)
create or replace function public.my_day(p_date date)
returns table (furnace_id text, value double precision, note text, entered_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.furnace_id, r.value, r.note, r.entered_at
  from public.readings r
  where r.entered_by_id = auth.uid() and r.reading_date = p_date
$$;

-- open change requests from the manager, with "already corrected?" flag
create or replace function public.my_requests()
returns table (id uuid, furnace_id text, reading_date date, message text, created_at timestamptz, answered boolean)
language sql stable security definer set search_path = public as $$
  select q.id, q.furnace_id, q.reading_date, q.message, q.created_at,
         exists (select 1 from public.readings r
                 where r.furnace_id = q.furnace_id and r.reading_date = q.reading_date
                   and r.entered_at > q.created_at)
  from public.requests q
  where q.status = 'open' and public.my_role() is not null
  order by q.reading_date
$$;

-- only signed-in users may call the functions
revoke all on function public.submit_readings(date, jsonb, text) from public, anon;
revoke all on function public.last_readings(date) from public, anon;
revoke all on function public.my_submissions() from public, anon;
revoke all on function public.my_day(date) from public, anon;
revoke all on function public.my_requests() from public, anon;
grant execute on function public.submit_readings(date, jsonb, text) to authenticated;
grant execute on function public.last_readings(date) to authenticated;
grant execute on function public.my_submissions() to authenticated;
grant execute on function public.my_day(date) to authenticated;
grant execute on function public.my_requests() to authenticated;


-- ------------------------------------------------------------ hardening
-- data limits (reject nonsense even from the manager's own screen)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'readings_value_range') then
    alter table public.readings add constraint readings_value_range check (value >= 0 and value < 1e12);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'readings_note_len') then
    alter table public.readings add constraint readings_note_len check (char_length(note) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'requests_msg_len') then
    alter table public.requests add constraint requests_msg_len check (char_length(message) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'furnaces_name_len') then
    alter table public.furnaces add constraint furnaces_name_len check (char_length(name) between 1 and 40);
  end if;
end $$;

-- audit trail: every added, changed or deleted reading, who did it and when.
-- Only the manager can read it; nobody can edit or delete it through the API.
create table if not exists public.readings_log (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  actor        uuid,
  action       text not null,
  furnace_id   text not null,
  reading_date date not null,
  old_value    double precision,
  new_value    double precision,
  old_note     text,
  new_note     text
);
alter table public.readings_log enable row level security;
drop policy if exists "log: manager reads" on public.readings_log;
create policy "log: manager reads" on public.readings_log
  for select to authenticated using (public.is_manager());

create or replace function public.log_reading_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into public.readings_log (actor, action, furnace_id, reading_date, old_value, old_note)
    values (auth.uid(), 'delete', old.furnace_id, old.reading_date, old.value, old.note);
    return old;
  elsif tg_op = 'UPDATE' then
    if old.value is distinct from new.value or old.note is distinct from new.note then
      insert into public.readings_log (actor, action, furnace_id, reading_date, old_value, new_value, old_note, new_note)
      values (auth.uid(), 'update', new.furnace_id, new.reading_date, old.value, new.value, old.note, new.note);
    end if;
    return new;
  else
    insert into public.readings_log (actor, action, furnace_id, reading_date, new_value, new_note)
    values (auth.uid(), 'insert', new.furnace_id, new.reading_date, new.value, new.note);
    return new;
  end if;
end
$$;
drop trigger if exists readings_audit on public.readings;
create trigger readings_audit
  after insert or update or delete on public.readings
  for each row execute function public.log_reading_change();

-- logged-out visitors get no table access at all (row security already
-- returns nothing; this removes the privilege itself as a second wall)
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
revoke all on public.readings_log from authenticated;
grant select on public.readings_log to authenticated;
-- signed-in users only get what the row rules above cover: no TRUNCATE
-- (it ignores row security), no triggers, no creating/deleting profiles
revoke truncate, trigger, references on all tables in schema public from authenticated;
alter default privileges in schema public revoke truncate, trigger, references on tables from authenticated;
revoke insert, delete on public.profiles from authenticated;
alter default privileges in schema public revoke execute on functions from anon, public;

revoke all on function public.my_role() from public, anon;
revoke all on function public.is_manager() from public, anon;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.log_reading_change() from public, anon, authenticated;
grant execute on function public.my_role() to authenticated;
grant execute on function public.is_manager() to authenticated;

-- =====================================================================
--  AFTER creating the two logins (Authentication → Users → Add user),
--  run these two lines in a NEW query, with the emails you used:
--
--  update public.profiles set role = 'manager',    display_name = 'Manager'    where id = (select id from auth.users where email = 'manager@example.com');
--  update public.profiles set role = 'supervisor', display_name = 'Supervisor' where id = (select id from auth.users where email = 'supervisor@example.com');
-- =====================================================================
