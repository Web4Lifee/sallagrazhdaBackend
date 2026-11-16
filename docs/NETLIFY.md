# Free hosting: Netlify + Supabase

The API runs on [Netlify Server](https://docs.netlify.com/build/server/) and stores its data in a [Supabase](https://supabase.com) PostgreSQL database, both in Frankfurt, both on free plans.

```
app ──https──▶ Netlify Server (netlify/server/index.ts) ──TLS──▶ Supabase PostgreSQL (session pooler)
               ▲ wakes it once a day: netlify/functions/wake-up.ts
```

`netlify.toml` holds the Netlify settings. Migrations and admin accounts are run from your own computer, never on Netlify.

## 1. Database (Supabase)

1. Create a project: region **Frankfurt (eu-central-1)**, a generated database password of letters and digits. Turn the **Data API** off if offered (migration `002` locks the tables against it either way).
2. Click **Connect**, open **Session pooler** and copy the URI. Put your password in place of `[YOUR-PASSWORD]`.
3. Create `.env.supabase` next to `package.json` (git ignores it):

   ```
   NODE_ENV=production
   DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
   DATABASE_SSL=require
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

Everything else has a default in `netlify/server/index.ts` (production mode, Europe/Tirane time, TLS, 5 connections). An environment variable with the same name overrides it. Netlify reads variables at deploy time, so redeploy after changing one.

## Updating

- Every push to `main` deploys. On the free plan a production deploy costs 15 of the 300 monthly credits, so push finished work, not every small step.
- New migration? Run `npx tsx --env-file=.env.supabase src/db/migrate.ts` **before** pushing the code that needs it.
- Changed the database password? Update `.env.supabase` and the `DATABASE_URL` variable on Netlify, then redeploy.

## What the free plans mean

- **Netlify:** 300 credits a month, a hard limit: when they run out, the site is paused until the next month. Requests cost 2 credits per 10,000. Netlify Server is free during Early Access; Netlify will charge for it after that.
- **Cold starts:** the server stops after 5 idle minutes, so the first request after a pause waits a few seconds.
- **Supabase:** 500 MB of data. It pauses projects after 7 days without database activity; the daily wake-up function prevents that. **No automatic backups**: save a copy now and then, for example with `GET /v1/sync` or `pg_dump`.

## Logs

Netlify UI → your project → **Logs**: the server's JSON request logs and the daily function's runs. Supabase UI → **Logs** for the database.
