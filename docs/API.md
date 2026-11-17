# API reference

Base URL: `http://localhost:3000` locally, `https://YOUR_DOMAIN` in production.

- Request and response bodies are JSON. Money is in **euros** (e.g. `35`, `12.5`, at most two decimals). Dates are ISO 8601 strings.
- Data shapes match the app's types (`Person`, `Ticket`, `SeasonRecord`, `Settings` in the app's `src/lib/types.ts`). Optional fields (`due`, `note`, `paidAt`) are left out when empty, as in the app.
- Every `/v1` endpoint except login needs `Authorization: Bearer <token>`.
- Unknown fields in a body are rejected with `400`.

## Errors

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request",
    "details": [{ "path": "amount", "message": "..." }]
  }
}
```

| Status | `code`                                                 | Meaning                                                                           |
| ------ | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 400    | `BAD_REQUEST`, `INVALID_PASSWORD`                      | Invalid input (`details` lists each problem)                                      |
| 401    | `UNAUTHORIZED`                                         | Missing, wrong, expired or revoked token → log in again                           |
| 404    | `NOT_FOUND`                                            | No such record or route                                                           |
| 409    | `CONFLICT`, `ANNUAL_TICKET_EXISTS`, `SERVER_NOT_EMPTY` | Conflicts with existing data                                                      |
| 413    | `PAYLOAD_TOO_LARGE`                                    | Body over 1 MB (10 MB for import)                                                 |
| 429    | `RATE_LIMITED`                                         | Too many requests; see the `retry-after` header                                   |
| 500    | `INTERNAL`                                             | Server problem (details only in the server logs; quote the `x-request-id` header) |

## Health (no login)

| Method | Path      | Response                                               |
| ------ | --------- | ------------------------------------------------------ |
| GET    | `/health` | `{ "status": "ok" }` while the process runs            |
| GET    | `/ready`  | `{ "status": "ok" }`, or `503` if the database is down |

## Auth

| Method | Path                       | Body                               | Response                        |
| ------ | -------------------------- | ---------------------------------- | ------------------------------- |
| POST   | `/v1/auth/login`           | `{ username, password }`           | `{ token, expiresAt, user }`    |
| GET    | `/v1/auth/me`              | –                                  | `{ user }`                      |
| POST   | `/v1/auth/logout`          | –                                  | `204`                           |
| POST   | `/v1/auth/change-password` | `{ currentPassword, newPassword }` | `204`, other devices signed out |

Store the token securely on the phone (e.g. `expo-secure-store`), never in plain AsyncStorage. A session stays valid while it is used: every use moves its end `SESSION_TTL_DAYS` (default 365) ahead, so the phone stays signed in until it logs out, the password changes, or it goes unused that long. A `401` means the session ended → show the login screen. `expiresAt` in the login response is only the first end date.

## Sync

| Method | Path         | Body                     | Response                                                                                |
| ------ | ------------ | ------------------------ | --------------------------------------------------------------------------------------- |
| GET    | `/v1/sync`   | –                        | `{ people, tickets, settings, seasons, nextTicketNumber, dismissedAnnual, serverTime }` |
| POST   | `/v1/import` | same shape as `/v1/sync` | `201 { people, tickets, seasons, dismissedAnnual }` (counts)                            |

`/v1/sync` is one consistent read of everything, in the same shape as the app's persisted store.

`/v1/import` moves the data saved on the phone to the server **once**: send the `state` object the app keeps under the AsyncStorage key `babi-app-store`. It keeps all IDs, receipt numbers and dates, and only works while the server has no people, tickets or seasons (`409 SERVER_NOT_EMPTY` otherwise), so it can never overwrite live data. If anything is inconsistent (duplicate IDs or numbers, tickets of unknown people…) nothing is imported and `details` lists the problems.

## People

| Method | Path             | Body                                  | Response                                   |
| ------ | ---------------- | ------------------------------------- | ------------------------------------------ |
| GET    | `/v1/people`     | –                                     | `Person[]` (oldest first)                  |
| GET    | `/v1/people/:id` | –                                     | `Person`                                   |
| POST   | `/v1/people`     | `{ firstName, fatherName, lastName }` | `201 { person, createdTickets: Ticket[] }` |
| PUT    | `/v1/people/:id` | `{ firstName, fatherName, lastName }` | `Person`                                   |
| DELETE | `/v1/people/:id` | –                                     | `204` (their tickets are deleted too)      |

Names are trimmed and capitalised like in the app. Adding a person during a started season creates their unpaid yearly ticket (`createdTickets`).

## Tickets and payments

| Method | Path                    | Body / query                                                       | Response             |
| ------ | ----------------------- | ------------------------------------------------------------------ | -------------------- |
| GET    | `/v1/tickets`           | query (all optional): `personId`, `season`, `status`, `kind`       | `Ticket[]` by number |
| GET    | `/v1/tickets/:id`       | –                                                                  | `Ticket`             |
| POST   | `/v1/payments`          | `{ personId, amount, reasons, note?, settleTicketId?, asAnnual? }` | `201 Ticket`         |
| POST   | `/v1/tickets/:id/pay`   | optional `{ amount }`                                              | `Ticket`             |
| POST   | `/v1/tickets/:id/unpay` | –                                                                  | `Ticket`             |
| DELETE | `/v1/tickets/:id`       | –                                                                  | `204`                |

`POST /v1/payments` works like the app's payment screen:

- `settleTicketId`: pay that person's open yearly ticket (`409` if it's already paid).
- `asAnnual: true`: record the payment as the yearly fee for the active season (`409 ANNUAL_TICKET_EXISTS` if the person already has one; `details.ticketId` names it).
- neither: an extra payment/donation with the next receipt number.

`amount` must be more than 0. Receipt numbers are unique and never skip, even with several phones paying at once.

Deleting a yearly ticket remembers it (`dismissedAnnual`), so it is not generated again.

## Seasons

| Method | Path                | Response                                   |
| ------ | ------------------- | ------------------------------------------ |
| GET    | `/v1/seasons`       | `SeasonRecord[]` (oldest first)            |
| POST   | `/v1/seasons/start` | `201 { season, createdTickets }` (a count) |

The server also starts seasons on its own when their date arrives (1st of `seasonStartMonth`, server time zone `TZ`) and creates the unpaid yearly tickets, so they appear even if nobody opens the app. Turn this off with `AUTO_START_SEASONS=false`.

## Settings

| Method | Path           | Body                     | Response   |
| ------ | -------------- | ------------------------ | ---------- |
| GET    | `/v1/settings` | –                        | `Settings` |
| PATCH  | `/v1/settings` | any subset of `Settings` | `Settings` |

`paperWidth` is `58` or `80`; `seasonStartMonth` is `0`–`11` (0 = January). Reasons are trimmed and de-duplicated. Changing `annualFee` affects only yearly tickets created afterwards.
