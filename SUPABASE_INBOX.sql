-- Run this once in your Supabase project's SQL Editor (after SUPABASE_SETUP.sql).
-- Holds bank SMS / payment notifications sent from your phone until you approve them in the app's Inbox tab.

create table if not exists pending_transactions (
  id uuid primary key default gen_random_uuid(),
  raw_text text not null,
  sender text,
  source text default 'sms',
  created_at timestamptz not null default now()
);

alter table pending_transactions enable row level security;

-- The app (anon key) may read and clear the inbox…
create policy "anon can read inbox"   on pending_transactions for select using (true);
create policy "anon can delete inbox" on pending_transactions for delete using (true);
-- …but there is deliberately NO insert policy for anon: only the Netlify function
-- (using the service_role key + your INGEST_KEY secret) can add messages.

create index if not exists pending_transactions_created_idx on pending_transactions (created_at);

-- Optional: lets the Inbox update instantly instead of every 30 seconds.
alter publication supabase_realtime add table pending_transactions;
