# Money Manager

Personal finance tracker: accounts, income/expense transactions, budgets,
recurring bills, debts (IOUs), and spending reports. Same stack as
Household Goods — React + Vite + Tailwind + Supabase + Netlify, installable
as a PWA.

## Setup

1. Run `SUPABASE_SETUP.sql` in your Supabase project's SQL Editor.
2. Copy `.env.example` to `.env` and fill in your Supabase URL + anon key.
3. `npm install`
4. `npm run dev` to try it locally, or `npm run build` then deploy the
   `dist/` folder (or connect the repo) to Netlify — same as Household Goods.

## Notes

- Single-user, PIN-gated (not multi-account like Household Goods).
- The PIN only gates the app screen; it isn't strong encryption. Don't
  reuse a sensitive password as your PIN.
