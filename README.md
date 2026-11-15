# sallagrazhda-backend

API server that stores the **sallagrazhdaApp** data — people, yearly-fee and payment tickets, seasons and settings — in PostgreSQL, so it is safe on a server instead of only on one phone.

- **Stack:** Node.js 24 · TypeScript · Fastify 5 · PostgreSQL 18 · Zod validation · Docker
- **Same rules as the app:** receipt numbers, seasons, automatic unpaid yearly tickets, "deleted yearly tickets stay deleted" — ported from the app's store and covered by tests.
- **Same data shape as the app:** `GET /v1/sync` returns exactly what the app keeps in its local store, and `POST /v1/import` moves the phone's existing data to the server once.

## Quick start (local, with Docker)

Requirements: [Docker Desktop](https://www.docker.com/products/docker-desktop/) and Node.js 22.13+ (24 recommended).

```bash
npm install
docker compose up --build
```

That starts PostgreSQL, applies the migrations and runs the API on **http://localhost:3000**. Check it:

```bash
curl http://localhost:3000/health
```

Create your admin account (in a second terminal; you'll be asked for a password, at least 12 characters):

```bash
docker compose exec -it api node dist/cli/create-admin.js admin --name "Administratori"
```

Log in and call the API:

```bash
curl -X POST http://localhost:3000/v1/auth/login -H "content-type: application/json" -d "{\"username\":\"admin\",\"password\":\"YOUR PASSWORD\"}"
curl http://localhost:3000/v1/sync -H "authorization: Bearer TOKEN_FROM_LOGIN"
```

All endpoints are listed in [docs/API.md](docs/API.md).

### Using it from the app

The local stack already allows the app's web preview (`http://localhost:8081`). To use it from a phone with Expo Go on the same Wi-Fi, expose the API on your network and use `http://<this computer's IP>:3000` as the server address in the app:

```bash
API_BIND=0.0.0.0 docker compose up -d
```

## Developing with hot reload

Run only the database in Docker and the API on your machine:

```bash
docker compose up -d db
cp .env.example .env
npm run migrate:dev
npm run create-admin:dev -- admin
npm run dev
```

## Tests and checks

The tests use a separate `sallagrazhda_test` database (created automatically by the local Docker database) and refuse to run against any database whose name doesn't end in `_test`.

```bash
docker compose up -d db
npm test            # unit + API tests against the real database
npm run check       # typecheck + lint + format check + tests
```

## Project layout

```
src/
  server.ts            entry point: config, HTTP server, background jobs, graceful shutdown
  app.ts               builds the Fastify app (security plugins, routes, error handling)
  config.ts            environment variables, validated at startup
  db/                  connection pool, transactions, migration runner
  domain/types.ts      API data shapes (same as the app's types)
  routes/              HTTP endpoints + input validation
  services/            business rules (payments, seasons, yearly tickets, import, auth)
  repositories/        SQL queries, one file per table
  lib/                 password hashing, tokens, season rules, money, validation helpers
  jobs/scheduler.ts    starts due seasons and removes expired sessions
  cli/create-admin.ts  create an admin or reset a password
migrations/            SQL schema changes, applied in order (never edit an applied one)
test/                  unit and API tests
docs/                  API reference and deployment guide
```

## Security at a glance

- No sign-up and no default accounts: admins are created only from the server's command line.
- Passwords hashed with scrypt (OWASP parameters); sessions are random 256-bit tokens of which only a SHA-256 hash is stored; sessions expire, can be revoked, and changing a password signs out other devices.
- Login is rate-limited (10 attempts / 15 min per IP) on top of a global limit; unknown usernames take as long as wrong passwords.
- Every input is validated (strict schemas reject unknown fields), every query is parameterized, request bodies are size-limited.
- Errors never leak stack traces or SQL; credentials are redacted from logs; responses are `no-store`; security headers via Helmet; CORS closed unless you list origins.
- Every change to people, tickets, settings and seasons is recorded in an `audit_log` table with the user and IP.
- Containers run as a non-root user with a read-only filesystem and no Linux capabilities; the database is on an internal network with no internet access; HTTPS via Caddy with automatic certificates; daily backups.

Going live: follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
