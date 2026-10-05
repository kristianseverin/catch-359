-- Catch 359 — database schema for Supabase (Postgres)
--
-- Run this whole file once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- It is safe to re-run: tables are created only if missing and functions are replaced.
--
-- Security model
--   * The public (anon) role can NOT read or write the registrations table directly.
--     It can only call register_rider(), get_public_stats() and get_start_list().
--   * Organizers are Supabase Auth users listed in public.admins. Row level security
--     lets them read and edit every registration and run the draw.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.event_settings (
  id                 int primary key default 1 check (id = 1),  -- single row
  capacity           int not null default 360 check (capacity between 1 and 360),
  registration_open  boolean not null default true,
  draw_done          boolean not null default false,
  draw_published     boolean not null default false,
  drawn_at           timestamptz
);
insert into public.event_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.registrations (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  first_name          text not null check (char_length(btrim(first_name)) between 1 and 80),
  last_name           text not null check (char_length(btrim(last_name)) between 1 and 80),
  email               text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  country             text not null check (char_length(btrim(country)) between 1 and 80),
  club                text check (club is null or char_length(club) <= 120),
  emergency_name      text not null check (char_length(btrim(emergency_name)) between 1 and 120),
  emergency_phone     text not null check (char_length(btrim(emergency_phone)) between 4 and 40),
  longest_ride_km     int check (longest_ride_km is null or longest_ride_km between 0 and 20000),
  expected_speed_kmh  numeric(4,1) check (expected_speed_kmh is null or expected_speed_kmh between 5 and 60),
  experience          text check (experience is null or char_length(experience) <= 1000),
  status              text not null default 'registered'
                        check (status in ('registered', 'waitlist', 'withdrawn')),
  start_degree        smallint unique check (start_degree is null or start_degree between 0 and 359),
  admin_notes         text,
  -- a withdrawn or waitlisted rider never holds a start spot
  constraint start_spot_only_for_registered check (start_degree is null or status = 'registered')
);

create unique index if not exists registrations_email_unique on public.registrations (lower(email));
create index if not exists registrations_status_created on public.registrations (status, created_at);

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

-- Free a rider's start spot automatically when they leave the start list.
create or replace function public.clear_spot_when_not_registered()
returns trigger language plpgsql as $$
begin
  if new.status <> 'registered' then
    new.start_degree := null;
  end if;
  return new;
end $$;

drop trigger if exists registrations_clear_spot on public.registrations;
create trigger registrations_clear_spot
  before insert or update of status on public.registrations
  for each row execute function public.clear_spot_when_not_registered();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.assert_admin()
returns void
language plpgsql stable security definer set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Only organizers can do this' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Public functions (callable without logging in)
-- ---------------------------------------------------------------------------

-- Sign up. Returns {status: 'registered' | 'waitlist', waitlist_position}.
create or replace function public.register_rider(
  p_first_name         text,
  p_last_name          text,
  p_email              text,
  p_country            text,
  p_club               text,
  p_emergency_name     text,
  p_emergency_phone    text,
  p_longest_ride_km    int,
  p_expected_speed_kmh numeric,
  p_experience         text
) returns json
language plpgsql security definer set search_path = public
as $$
declare
  s          public.event_settings;
  taken      int;
  new_status text;
  wl_pos     int;
begin
  -- Lock the settings row so two simultaneous sign-ups can't both take the last spot.
  select * into s from public.event_settings where id = 1 for update;

  if not s.registration_open then
    raise exception 'Registration is closed' using errcode = 'P0001', hint = 'closed';
  end if;

  if exists (select 1 from public.registrations where lower(email) = lower(btrim(p_email))) then
    raise exception 'This email is already signed up' using errcode = 'P0001', hint = 'duplicate';
  end if;

  select count(*) into taken from public.registrations where status = 'registered';
  new_status := case when taken < s.capacity then 'registered' else 'waitlist' end;

  insert into public.registrations (
    first_name, last_name, email, country, club,
    emergency_name, emergency_phone, longest_ride_km, expected_speed_kmh, experience, status
  ) values (
    btrim(p_first_name), btrim(p_last_name), lower(btrim(p_email)), btrim(p_country),
    nullif(btrim(coalesce(p_club, '')), ''),
    btrim(p_emergency_name), btrim(p_emergency_phone), p_longest_ride_km, p_expected_speed_kmh,
    nullif(btrim(coalesce(p_experience, '')), ''),
    new_status
  );

  if new_status = 'waitlist' then
    select count(*) into wl_pos from public.registrations where status = 'waitlist';
  end if;

  return json_build_object('status', new_status, 'waitlist_position', wl_pos);
end $$;

-- Counts shown on the public page. No personal data.
create or replace function public.get_public_stats()
returns json
language sql stable security definer set search_path = public
as $$
  select json_build_object(
    'capacity',          s.capacity,
    'registered',        (select count(*) from public.registrations where status = 'registered'),
    'waitlist',          (select count(*) from public.registrations where status = 'waitlist'),
    'registration_open', s.registration_open,
    'draw_published',    s.draw_published,
    'countries',         (select count(distinct lower(country)) from public.registrations where status = 'registered')
  )
  from public.event_settings s where s.id = 1;
$$;

-- The public start list: only after the organizers publish the draw.
-- Exposes name, country, club and start degree — never email, phone or emergency contact.
create or replace function public.get_start_list()
returns table (start_degree smallint, rider_name text, country text, club text)
language sql stable security definer set search_path = public
as $$
  select r.start_degree, r.first_name || ' ' || r.last_name, r.country, r.club
  from public.registrations r, public.event_settings s
  where s.id = 1 and s.draw_published
    and r.status = 'registered' and r.start_degree is not null
  order by r.start_degree;
$$;

-- ---------------------------------------------------------------------------
-- Organizer functions
-- ---------------------------------------------------------------------------

-- Random draw: closes registration and gives every registered rider a start degree.
-- With 360 riders every degree 0–359 is used (1° apart). With fewer riders the
-- spots are spread as evenly as possible around the circle, in random order.
create or replace function public.run_draw()
returns json
language plpgsql security definer set search_path = public, auth
as $$
declare
  n int;
begin
  perform public.assert_admin();
  perform 1 from public.event_settings where id = 1 for update;

  select count(*) into n from public.registrations where status = 'registered';
  if n = 0 then
    raise exception 'There are no registered riders to draw';
  end if;

  update public.registrations set start_degree = null where start_degree is not null;

  with shuffled as (
    select id, row_number() over (order by random()) - 1 as k
    from public.registrations where status = 'registered'
  )
  update public.registrations r
     set start_degree = floor(sh.k * 360.0 / n)::smallint
    from shuffled sh
   where r.id = sh.id;

  update public.event_settings
     set registration_open = false, draw_done = true, draw_published = false, drawn_at = now()
   where id = 1;

  return json_build_object('riders', n);
end $$;

-- Show or hide the start list on the public page.
create or replace function public.set_draw_published(p_published boolean)
returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  perform public.assert_admin();
  if p_published and not (select draw_done from public.event_settings where id = 1) then
    raise exception 'Run the draw before publishing it';
  end if;
  update public.event_settings set draw_published = p_published where id = 1;
end $$;

-- Open or close registration.
create or replace function public.set_registration_open(p_open boolean)
returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  perform public.assert_admin();
  update public.event_settings set registration_open = p_open where id = 1;
end $$;

-- Move a rider from the waitlist onto the start list. If the draw has happened,
-- they get a random free start degree (for example the one a withdrawn rider left).
create or replace function public.promote_rider(p_id uuid)
returns json
language plpgsql security definer set search_path = public, auth
as $$
declare
  s     public.event_settings;
  taken int;
  deg   smallint;
begin
  perform public.assert_admin();
  select * into s from public.event_settings where id = 1 for update;

  select count(*) into taken from public.registrations where status = 'registered';
  if taken >= s.capacity then
    raise exception 'The start list is full (% riders). Withdraw someone first.', s.capacity;
  end if;

  update public.registrations set status = 'registered' where id = p_id and status <> 'registered';
  if not found then
    raise exception 'Rider not found or already on the start list';
  end if;

  if s.draw_done then
    select d into deg
      from generate_series(0, 359) d
     where d not in (select start_degree from public.registrations where start_degree is not null)
     order by random() limit 1;
    update public.registrations set start_degree = deg where id = p_id;
  end if;

  return json_build_object('start_degree', deg);
end $$;

-- ---------------------------------------------------------------------------
-- Row level security and grants
-- ---------------------------------------------------------------------------

alter table public.registrations  enable row level security;
alter table public.event_settings enable row level security;
alter table public.admins         enable row level security;

drop policy if exists "organizers read registrations"   on public.registrations;
drop policy if exists "organizers update registrations" on public.registrations;
drop policy if exists "organizers delete registrations" on public.registrations;
create policy "organizers read registrations"   on public.registrations for select to authenticated using (public.is_admin());
create policy "organizers update registrations" on public.registrations for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "organizers delete registrations" on public.registrations for delete to authenticated using (public.is_admin());

drop policy if exists "organizers read settings" on public.event_settings;
create policy "organizers read settings" on public.event_settings for select to authenticated using (public.is_admin());

drop policy if exists "organizers see themselves" on public.admins;
create policy "organizers see themselves" on public.admins for select to authenticated using (user_id = auth.uid());

revoke all on public.registrations, public.event_settings, public.admins from anon, authenticated;
grant select, update, delete on public.registrations to authenticated;
grant select on public.event_settings, public.admins to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.register_rider(text, text, text, text, text, text, text, int, numeric, text) to anon, authenticated;
grant execute on function public.get_public_stats() to anon, authenticated;
grant execute on function public.get_start_list()   to anon, authenticated;
grant execute on function public.is_admin()          to authenticated;
grant execute on function public.run_draw()          to authenticated;
grant execute on function public.set_draw_published(boolean) to authenticated;
grant execute on function public.set_registration_open(boolean) to authenticated;
grant execute on function public.promote_rider(uuid) to authenticated;
