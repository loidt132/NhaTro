# Nhatro-unified Server

Express API (auth, `/api/state`, meter submissions, admin) backed by **PostgreSQL (Neon)**.
It runs locally with `npm start` and on Vercel as `api/[...all].js`.

## Setup

```
cd server
npm install
cp .env.example .env     # fill in DATABASE_URL, AUTH_SECRET, ENCRYPTION_KEY, ...
npm run migrate-to-neon -- --schema-only   # create the tables on an empty database
npm start
```

Required env vars (also set them in the Vercel project, root dir = `nhatro-unified/server`):

```
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require   # Neon; pooled string on Vercel
AUTH_SECRET=change-this-secret
ENCRYPTION_KEY=<64 hex chars>     # encrypts tenant CCCD / phone — keep the same key as before
```

The browser never talks to the database: the web app only calls this API.

## Moving existing data from NocoDB to Neon

1. Put `DATABASE_URL` plus the old `NOCODB_URL`, `NOCODB_API_KEY` and `NOCODB_TABLE_*` ids in `.env`
   (see `.env.example`), with the **same `ENCRYPTION_KEY`** the app already uses.
2. `npm run migrate-to-neon -- --dry-run` reads NocoDB and reports what it would copy (writes nothing).
3. `npm run migrate-to-neon` creates the tables from `neon-schema.sql`, copies every row as-is
   (encrypted values stay encrypted), then compares row counts per table.
4. Deploy with `DATABASE_URL` set. NocoDB is never modified, so you can roll back by redeploying the old build.

The script is safe to re-run: rows whose `id` already exists in Postgres are skipped.
Rows without `id` or `created_by` can't be used by the app and are skipped (they are listed in the log).
Columns that exist in NocoDB but not in `neon-schema.sql` are added to Postgres automatically.
Legacy users that only had a plaintext `password` column get a salted hash instead.

## Schema

`neon-schema.sql` (idempotent). Every business table has `created_by` (the owner's user id),
`modified_by` and a soft-delete flag `"isDeleted"`; column names are quoted camelCase to match the
JSON the web app sends. Fields the app sends that are not columns are dropped with a `[db]` warning in the log.

## Endpoints

- `GET/POST /api/state` — the signed-in user's rooms, tenants, readings, invoices, payments, ...
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/tenant/verify-phone`
- `GET/POST/PATCH /api/meter-submissions`
- `GET /api/rooms/records`, `GET /api/config/status`, `GET /health`
- `/api/admin/users...` (admin only)
