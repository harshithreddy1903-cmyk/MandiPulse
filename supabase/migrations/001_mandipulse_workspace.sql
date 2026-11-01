-- Safe to apply to an existing MandiPulse Supabase project.
create table if not exists public.procurement_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Untitled buying plan',
  commodity text not null,
  quantity_quintals numeric(18,5) not null check (quantity_quintals > 0),
  budget_inr numeric(14,2) check (budget_inr is null or budget_inr >= 0),
  destination text not null,
  assumptions jsonb not null default '{}'::jsonb,
  recommendation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.procurement_plans enable row level security;
drop policy if exists "Users can read their own plans" on public.procurement_plans;
drop policy if exists "Users can create their own plans" on public.procurement_plans;
drop policy if exists "Users can update their own plans" on public.procurement_plans;
drop policy if exists "Users can delete their own plans" on public.procurement_plans;
create policy "Users can read their own plans" on public.procurement_plans for select using (auth.uid() = user_id);
create policy "Users can create their own plans" on public.procurement_plans for insert with check (auth.uid() = user_id);
create policy "Users can update their own plans" on public.procurement_plans for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their own plans" on public.procurement_plans for delete using (auth.uid() = user_id);
create index if not exists procurement_plans_user_created_idx on public.procurement_plans(user_id, created_at desc);

create table if not exists public.saved_conversations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  messages jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.saved_conversations enable row level security;
drop policy if exists "Users can read their own conversations" on public.saved_conversations;
drop policy if exists "Users can create their own conversations" on public.saved_conversations;
drop policy if exists "Users can update their own conversations" on public.saved_conversations;
drop policy if exists "Users can delete their own conversations" on public.saved_conversations;
create policy "Users can read their own conversations" on public.saved_conversations for select using (auth.uid() = user_id);
create policy "Users can create their own conversations" on public.saved_conversations for insert with check (auth.uid() = user_id);
create policy "Users can update their own conversations" on public.saved_conversations for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their own conversations" on public.saved_conversations for delete using (auth.uid() = user_id);
create index if not exists saved_conversations_user_updated_idx on public.saved_conversations(user_id, updated_at desc);
