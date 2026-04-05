# Nhatro-unified Server (JSON file)

This server exposes auth + `/api/state` and persists fallback state as per-user JSON files under **`data/states/`** when NocoDB is not used.

## Setup

```
cd server
npm install
npm start
```

On start, the console prints the absolute path to the state file.

## Endpoints

- GET /api/state  -> { state: { ... } }
- POST /api/state -> { state: {...} }
- POST /api/auth/register
- POST /api/auth/login
- GET /api/auth/me

The frontend reads this endpoint on startup and POSTs on every `saveState`. All three endpoints require login except register/login.

## Note

- If the server is offline, the frontend still uses IndexedDB.
- Optional layer for syncing across devices on your LAN or host.
- If you previously used `data.db` (SQLite), that file is no longer read; migrate by exporting from the app or copying state into `data/state.json` if you have a JSON backup.

## NocoDB alternative

You can use NocoDB for multi-user app data and user accounts.

Frontend env vars in `web/.env`:

```
VITE_NOCODB_URL=https://your-nocodb-host
VITE_NOCODB_API_KEY=your_api_key
VITE_TABLE_ROOMS=...
VITE_TABLE_TENANTS=...
VITE_TABLE_READINGS=...
VITE_TABLE_INVOICES=...
VITE_TABLE_PAYMENTS=...
VITE_TABLE_SETTINGS=...
```

Server env vars:

```
NOCODB_URL=https://your-nocodb-host
NOCODB_API_KEY=your_api_key
NOCODB_TABLE_USERS=...
AUTH_SECRET=change-this-secret
```

The server now also auto-loads `.env` from `server/`, repo root, and `web/`.
It accepts fallback variable names `VITE_NOCODB_URL`, `VITE_NOCODB_API_KEY`, and `VITE_TABLE_USERS` for the auth users table.

Use the schema in `server/nocodb-schema.sql`. Important rule: every business table must have `created_by` and `modified_by`, and the frontend only reads/writes rows where `created_by` equals the logged-in user's `id`.

For the `users` table, passwords are not stored as plain text.
The server stores:

- `password_hash`
- `password_salt`

If you do not see these fields in NocoDB, your `users` table schema does not match the server auth schema yet.
The backend also accepts the variants `passwordhash` / `passwordsalt` and `createdat` for existing NocoDB tables.

The app tries NocoDB first, then `/api/state` + IndexedDB.
