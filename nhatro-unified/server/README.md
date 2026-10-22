# Nhatro-unified Server

Express API (auth, `/api/state`, tenant/meter endpoints) backed by **PostgreSQL (Neon)**.
All app data lives in the database — nothing is written to local disk, so it runs on Vercel.

## Setup

```
cd server
npm install
cp .env.example .env     # fill in DATABASE_URL, AUTH_SECRET, ENCRYPTION_KEY, ...
npm run migrate          # creates the tables from schema.sql (safe to re-run)
npm start
```

`DATABASE_URL` is the Neon connection string. On Vercel use the **pooled** one (host contains `-pooler`).

## Data model

`schema.sql` defines 14 tables (users, rooms, tenants, readings, invoices, payments, rent_periods,
payment_allocations, rental_contracts, deposits, deposit_transactions, deposit_refunds, settings,
meter_submissions). Column names are camelCase (quoted) so rows match the JS objects field-for-field.

- Every business row has `created_by` (the landlord's user id) and `modified_by`; the API only
  reads/writes rows where `created_by` is the logged-in landlord.
- Deletes are soft (`"isDeleted"`).
- Tenant `cccd`/`phone` and user `phone` are AES-256-GCM encrypted at rest (`ENCRYPTION_KEY`).
  Do not change this key after data exists.
- App-level timestamps (`createdAt`, `paidAt`, ...) are `TEXT`, stored exactly as the browser sent them.

## Migrating from NocoDB

1. Put the old `NOCODB_URL`, `NOCODB_API_KEY` and `NOCODB_PROJECT` (base id; or `NOCODB_TABLE_<NAME>`
   table ids) in `.env` next to `DATABASE_URL`, with the **same `ENCRYPTION_KEY`** as before.
2. `npm run migrate`
3. `npm run import-from-nocodb -- --add-missing`

The import copies rows as-is, skips ids that already exist (safe to re-run) and prints NocoDB vs
Postgres row counts per table. `--add-missing` also keeps columns that exist only in NocoDB (as
TEXT); without it they are skipped and listed. Run with `--add-missing` from the first run — rows
already imported are not updated by a later run.

## Admin CLI

```
node --env-file=.env promote-to-admin.js list
node --env-file=.env promote-to-admin.js promote <email_or_phone>
node --env-file=.env promote-to-admin.js limit <email_or_phone> <n>
```

## Vercel

Set the project root to `server/`; `api/[...all].js` is the serverless entry. Set the variables from
`.env.example` in Project Settings → Environment Variables (at minimum `DATABASE_URL`, `AUTH_SECRET`,
`ENCRYPTION_KEY`; `CORS_ORIGIN` must include the web app's URL).
