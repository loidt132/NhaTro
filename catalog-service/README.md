# catalog-service

A small standalone REST API for a priced catalog of **dịch vụ** (services —
ăn uống, giặt là...) and **phụ thu** (surcharges), each tagged with a `kind`.
It started as part of the homestay prototype but has no homestay-specific
logic in it — it's just "categories + priced items" — so it is kept in its
own repo and can be run independently and pointed at by more than one app.

Originally this was two separate services (service-catalog + surcharge-
service); they were merged because surcharges are, functionally, just
another kind of priced catalog item.

## Why a separate repo

- **nhà trọ** (long-term room rental) and **homestay** (hourly/overnight
  booking) are two different apps/repos. Both need "an itemized, priced
  list of extra charges" — nhà trọ's `invoices.other` field is currently a
  single lump sum with no line items; this service is what a future
  itemized version of that could read from instead of re-implementing its
  own catalog.
- Keeping it out of `homestay-app` means it isn't tied to that app's
  release cycle, and either app (or both, pointed at the same running
  instance) can consume it over HTTP without a shared codebase.

## Running it

```bash
npm install
npm run dev   # listens on PORT (default 4100)
```

Data persists to `data/db.json` (gitignored), seeded from `data/seed.json`
on first run.

## Consuming it from another app

Point your app's own env var at wherever this is running, e.g.:

```
# homestay-app/server/.env
SERVICE_CATALOG_URL=http://localhost:4100

# a future nhà trọ integration would do the same, e.g.
VITE_CATALOG_API=http://localhost:4100
```

Each consuming app can run its own instance of this service (separate
`data/db.json`, separate price lists), or multiple apps can point at one
shared running instance if you want nhà trọ and homestay to share the same
price list — nothing in the API assumes a single caller.

### Auth model

Reads (`GET`) are public — no secret, since any app listing/displaying the
catalog needs that without a login of its own. Writes (`POST`/`PUT`/`DELETE`)
require an `x-api-key` header matching `CATALOG_ADMIN_KEY`.

This service has no concept of users or roles — it only knows "did this
request carry the key". Whoever calls it with the key is trusted completely,
so **the browser must never hold this key**. The pattern each consuming app
follows: its own backend authenticates the person (login + role check,
e.g. homestay-server's JWT + `requireAdmin`), and only that backend —
never the browser directly — forwards the write here with the key attached.
See homestay-server's `/api/admin/catalog/*` routes for a working example of
that proxy.

## API

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/categories` | — | List categories (service items only; surcharges don't need one) |
| POST | `/api/categories` | key | `{ name }` |
| PUT | `/api/categories/:id` | key | `{ name }` |
| DELETE | `/api/categories/:id` | key | 409 if any item still references it |
| GET | `/api/items` | — | Optional `?kind=service\|surcharge` and/or `?categoryId=` filters |
| GET | `/api/items/:id` | — | |
| POST | `/api/items` | key | `{ name, price, kind?, unit?, categoryId? }` — `categoryId` required when `kind` is `service` (default) |
| PUT | `/api/items/:id` | key | Partial update, e.g. `{ price }` |
| DELETE | `/api/items/:id` | key | |

An item looks like:

```json
{ "id": "...", "kind": "service", "categoryId": "cat-food", "name": "Nước suối", "unit": "chai", "price": 15000 }
```

Surcharge items use `"kind": "surcharge"` and `"categoryId": null`.

## Database (PostgreSQL)

Storage is PostgreSQL (Neon free tier works). Set `DATABASE_URL` (see `.env.example`; use the *pooled* connection string on Vercel), then:

```
npm install
npm run migrate            # creates the tables from schema.sql (safe to re-run)
npm run seed -- <homestayId>   # optional starter price list
npm run dev
```

On Vercel, add `DATABASE_URL` and `CATALOG_ADMIN_KEY` as environment variables.

## Đơn nhiều dịch vụ

`POST /api/orders` nhận thêm `items: [{ itemId, itemName, unit, price, quantity }]`
để tạo một đơn nhiều dịch vụ: mỗi dịch vụ là một dòng `orders` cùng
`orderGroupId`, trả về mảng các dòng. Có thể gửi kèm `status`, `settlement`
(`paid` | `room`) và `stayId`. Gửi `itemName`/`price` đơn lẻ như cũ vẫn tạo đơn
một dịch vụ. `PUT` / `DELETE /api/orders/group/:groupId` đổi trạng thái hoặc xoá
cả đơn; `GET /api/orders?groupId=` lấy các dòng của một đơn. Cần chạy lại
`schema.sql` (có thêm các cột `orderGroupId`, `settlement`, `stayId`).
