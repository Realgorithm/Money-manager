-- Run this in your Supabase project's SQL Editor (same project as
-- Household Goods is fine — this uses its own table, finance_data,
-- so it won't touch anything your household app uses).

create table finance_data (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

-- Enable Row Level Security, then allow the anon key to read/write.
-- This app is gated by its own in-app PIN screen, same trust model
-- as Household Goods: fine for a personal device, not bank-grade auth.
alter table finance_data enable row level security;

create policy "allow anon full access"
  on finance_data
  for all
  using (true)
  with check (true);

-- Enable realtime so multiple open tabs/devices sync instantly.
alter publication supabase_realtime add table finance_data;
