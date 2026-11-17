# Free hosting: Netlify + Supabase

The API runs as a [Netlify Function](https://docs.netlify.com/build/functions/overview/) and stores its data in a [Supabase](https://supabase.com) PostgreSQL database, both on free plans.

```
app ──https──▶ Netlify Function netlify/functions/api.ts  ──verified TLS──▶ Supabase PostgreSQL (session pooler)
               Netlify Function netlify/functions/auth.ts ──┤
               Netlify Function netlify/functions/housekeeping.ts (hourly) ──┘
```

- `api.ts` hands every request (except the files in `public/`) to the same Fastify app the Docker setup runs.
- `auth.ts` does the same for `/v1/auth/login` and `/v1/auth/change-password`, so they can have a stricter rate limit.
- `housekeeping.ts` runs every hour: it starts seasons whose date has arrived and removes expired sessions. Functions can't run timers in the background.
- `src/netlify.ts` holds the Netlify-specific setup and defaults; `netlify.toml` the build settings.
- Migrations and admin accounts are run from your own computer, never on Netlify.

## 1. Database (Supabase)

1. Create a project with a generated database password of letters and digits. Turn the **Data API** off if offered (migration `002` locks the tables against it either way).
2. Click **Connect**, open **Session pooler** and copy the URI. Put your password in place of `[YOUR-PASSWORD]`.
3. Create `.env.supabase` next to `package.json` (git ignores it):

   ```
   NODE_ENV=production
   DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
   DATABASE_SSL=verify-full
   DATABASE_SSL_CA=supabase
   DATABASE_POOL_MAX=3
   TZ=Europe/Tirane
   ```

4. Create the tables, then an admin account (it asks for the password):

   ```bash
   npx tsx --env-file=.env.supabase src/db/migrate.ts
   npx tsx --env-file=.env.supabase src/cli/create-admin.ts admin --name "Administratori"
   ```

## 2. API (Netlify)

1. **Add new project → Import an existing project → GitHub** and pick this repository. Keep the build settings that `netlify.toml` fills in.
2. **Project configuration → Environment variables**: add `DATABASE_URL` with the same value as in `.env.supabase`, tick **Contains secret values**, keep all scopes.
3. Deploy, then open `https://<project>.netlify.app/ready`: `{"status":"ok"}` means the API reaches the database.
4. In the app, use `https://<project>.netlify.app` as the server address (`EXPO_PUBLIC_API_URL`).

Everything else has a default in `src/netlify.ts` (production mode, Europe/Tirane time, TLS verified against Supabase's root CA, 2 connections per instance). An environment variable with the same name overrides it. Netlify reads variables at deploy time, so redeploy after changing one.

## Updating

- Every push to `main` deploys.
- New migration? Run `npx tsx --env-file=.env.supabase src/db/migrate.ts` **before** pushing the code that needs it.
- Changed the database password? Update `.env.supabase` and the `DATABASE_URL` variable on Netlify, then redeploy.

## How it behaves

- **Region:** on free plans Netlify runs functions in US East (Ohio). Every database query travels to the Supabase region and back, so a Supabase project in US East (Ohio) answers fastest; one in Europe adds about 0.1 s per query.
- **Cold starts:** a function instance that hasn't run for a while takes a moment to start. After a minute without requests the API also opens a fresh database connection, because Netlify freezes idle instances and their connections can be cut meanwhile.
- **Dependencies are not bundled:** Netlify copies `node_modules` into each function as they are, and its function runtime can't `require()` ES modules. That's why `package.json` `overrides` keeps `light-my-request` (used by Fastify's `inject`) on the CommonJS `cookie` 1.x. Check the same thing before adding a dependency that is ES-module-only.
- **Rate limits:** Netlify enforces two rules per IP before a function runs (the most the free plan allows): 10 requests per 3 minutes to the login and password routes (`auth.ts`) and 300 per minute to everything else (`api.ts`). Blocked requests get `429` and use no function time. Fastify's own limits still apply inside, but only per function instance.

## Free plan limits

- **Netlify (legacy Free plan):** 125,000 function requests per site per month, plus bandwidth and build minutes. Netlify emails when a site reaches 50% of a limit. Netlify Server (`netlify/server/`) would need a credit-based plan.
- **Supabase:** 500 MB of data. It pauses projects after 7 days without database activity; the hourly housekeeping prevents that. **No automatic backups**: save a copy now and then, for example with `GET /v1/sync` or `pg_dump`.

## Security checklist

- **Secrets** live only in Netlify's `DATABASE_URL` (marked _Contains secret values_) and in your git-ignored `.env.supabase`. Nothing secret is in the repository.
- **Netlify → Project configuration → Environment variables → DATABASE_URL:** limit it to the **Production** deploy context. Deploy Previews and branch deploys then can't reach the real database, so code from a pull request never runs against it.
- **Netlify → Project configuration → Build & deploy → Sensitive variable policy:** keep **Require approval** for deploy previews from forks (the repository is public).
- **Database:** the tables are locked against Supabase's public Data API (migration `002`); the API connects over TLS verified against the bundled Supabase root CA (`src/db/supabase-ca.ts`, valid until 2031-04-26).
- **Rotate** the database password if it was ever pasted somewhere: Supabase → Project Settings → Database → Reset database password, then update `.env.supabase` and Netlify's `DATABASE_URL` and redeploy.

## Logs

Netlify UI → your project → **Logs → Functions**: `api` shows each request as a JSON line, `housekeeping` its hourly runs. Supabase UI → **Logs** for the database.
