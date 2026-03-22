# Nhatro-unified Server (JSON file)

This server exposes `/api/state` and persists the app state as **`data/state.json`** (no native database drivers).

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

The frontend reads this endpoint on startup and POSTs on every `saveState`.

## Note

- If the server is offline, the frontend still uses IndexedDB.
- Optional layer for syncing across devices on your LAN or host.
- If you previously used `data.db` (SQLite), that file is no longer read; migrate by exporting from the app or copying state into `data/state.json` if you have a JSON backup.

## NocoDB alternative

You can use NocoDB instead of this server. Set env vars in `web/.env`:

```
VITE_NOCODB_URL=https://your-nocodb-host
VITE_NOCODB_PROJECT=your_project_name
VITE_NOCODB_API_KEY=your_api_key (optional)
```

Create a table named `app_state` in NocoDB with columns:

- `id` (Primary key)
- `state` (Text)

The app tries NocoDB first, then `/api/state` + IndexedDB.
