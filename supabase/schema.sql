create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  discord_id text not null unique,
  username text not null,
  global_name text,
  avatar text,
  first_device_hash text,
  first_browser_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.giveaways (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  pix_prize text not null,
  status text not null default 'open' check (status in ('open', 'closed', 'drawn')),
  winner_participant_id uuid,
  created_at timestamptz not null default now(),
  drawn_at timestamptz
);

create table if not exists public.giveaway_participants (
  id uuid primary key default gen_random_uuid(),
  giveaway_id uuid not null references public.giveaways(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  discord_id text not null,
  username text not null,
  device_hash text not null,
  browser_id text not null,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (giveaway_id, discord_id),
  unique (giveaway_id, device_hash),
  unique (giveaway_id, browser_id)
);

alter table public.giveaways
  drop constraint if exists giveaways_winner_participant_id_fkey;

alter table public.giveaways
  add constraint giveaways_winner_participant_id_fkey
  foreign key (winner_participant_id)
  references public.giveaway_participants(id)
  on delete set null;

create index if not exists giveaway_participants_giveaway_idx
  on public.giveaway_participants(giveaway_id, created_at);

create table if not exists public.rate_limits (
  key text primary key,
  count integer not null default 1,
  window_start timestamptz not null default now()
);

create index if not exists rate_limits_window_start_idx
  on public.rate_limits(window_start);

insert into public.giveaways (title, pix_prize, status)
select 'Sorteio PIX', 'PIX especial', 'open'
where not exists (select 1 from public.giveaways);
