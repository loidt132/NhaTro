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
2. `npm run migrate-to-neon -- --dry-run` reads NocoDB and reports what it would do (changes nothing).
3. `npm run migrate-to-neon` rebuilds Neon from scratch: it reads all of NocoDB first, then in one
   transaction drops the app tables if they exist, recreates them from `neon-schema.sql` and copies every
   row (encrypted values stay encrypted). If anything fails the transaction rolls back and Neon is untouched.
   It finishes by comparing row counts per table.
4. Deploy with `DATABASE_URL` set. NocoDB is never modified, so you can roll back by redeploying the old build.

Details:
- Only columns defined in `neon-schema.sql` are copied (case-insensitive). Extra NocoDB columns such as
  `created_by_1`, `createdby`, `modifiedby` are ignored and listed in the log; no columns are ever added.
- Only rows that are not soft-deleted (`isDeleted` false/empty in NocoDB) are migrated; deleted rows are skipped and counted in the log.
- Rows without `id` or `created_by` can't be used by the app and are skipped (listed in the log).
- Legacy users that only had a plaintext `password` column get a salted hash instead.
- **Safety stop:** if NocoDB has fewer rows than Neon already holds in any table (or a table's
  `NOCODB_TABLE_*` id is not set while Neon has rows), the script stops instead of dropping data — NocoDB may
  have lost data and Neon may be the only copy. Snapshot Neon first (a Neon branch is instant), then add
  `--force` if you really want to overwrite.
- `--schema-only` drops and recreates the empty tables without copying anything.

## How the server code is laid out

- `db.js` — the Postgres (Neon) connection and small helpers (upsert, list owned rows, soft delete).
- `stateStore.js` — backs `/api/state`: the web app sends/receives a user's whole rooms / tenants / readings /
  invoices / payments / ... collections; this module diffs them against the database and upserts or
  soft-deletes rows. It talks to Neon through `db.js` only.
- `index.js` — routes (auth, users, admin, meter submissions) using `db.js` directly.
- `promote-to-admin.js` — CLI to promote/demote users and set room limits (`node promote-to-admin.js list`).
- `encrypt-existing-data.js` — one-off: encrypts CCCD/phone on rows that are still plaintext.

Audit columns on every business table: `created_by`, `updated_by`, `created_at`, `updated_at`. The server always
passes them explicitly: a create sets `created_by/created_at/updated_by/updated_at`; an update sets
`updated_by/updated_at` (`created_*` never change).

## Schema

`neon-schema.sql` (idempotent). Every business table has `created_by` (the owner's user id),
`updated_by` and a soft-delete flag `"isDeleted"`; column names are quoted camelCase to match the
JSON the web app sends. Fields the app sends that are not columns are dropped with a `[db]` warning in the log.

## Endpoints

- `GET/POST /api/state` — the signed-in user's rooms, tenants, readings, invoices, payments, ...
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/tenant/verify-phone`
- `GET/POST/PATCH /api/meter-submissions`
- `GET /api/rooms/records`, `GET /api/config/status`, `GET /health`
- `/api/admin/users...` (admin only)
