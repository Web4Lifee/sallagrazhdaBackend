# Deploying to a real server

This sets up the API with HTTPS, a private database and daily backups on a single Linux server using Docker Compose (`docker-compose.prod.yml`).

```
internet ──443──▶ Caddy (HTTPS, certificates) ──▶ API ──▶ PostgreSQL
                  network "web"                   both    network "internal" (no internet access)
                                                          └─ backup (daily pg_dump → ./backups)
```

## 1. What you need

- A Linux server (Ubuntu 24.04 LTS or similar), 1 GB RAM minimum, 2 GB recommended.
- A domain or subdomain (e.g. `api.example.com`) with a DNS **A** record (and AAAA for IPv6) pointing at the server.
- SSH access with a key (not a password).

## 2. Prepare the server (once)

```bash
# Updates, and automatic security updates
sudo apt update && sudo apt upgrade -y
sudo apt install -y unattended-upgrades ufw git
sudo dpkg-reconfigure --priority=low unattended-upgrades

# Firewall: only SSH and web traffic
sudo ufw default deny incoming
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable

# Docker Engine + Compose plugin (official script; see docs.docker.com/engine/install)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # log out and back in afterwards
```

In `/etc/ssh/sshd_config` set `PasswordAuthentication no` and `PermitRootLogin no`, then `sudo systemctl restart ssh`.

> Docker publishes ports past `ufw` rules. That's fine here because only Caddy publishes ports (80/443); the API and database publish none.

## 3. Get the code and configure it

```bash
git clone <your repository URL> sallagrazhda-backend
cd sallagrazhda-backend
cp .env.production.example .env
openssl rand -hex 32          # use the output as POSTGRES_PASSWORD
nano .env                     # set DOMAIN, ACME_EMAIL, POSTGRES_PASSWORD (and TZ if not Europe/Tirane)
chmod 600 .env
```

The API refuses to start if the password is still `CHANGE_ME`.

## 4. Start everything

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

Order is automatic: database → migrations → API → Caddy. Caddy fetches the HTTPS certificate on first start (DNS must already point to the server).

Check it from your own computer:

```bash
curl https://api.example.com/health
```

## 5. Create the admin account

```bash
docker compose -f docker-compose.prod.yml exec -it api node dist/cli/create-admin.js admin --name "Administratori"
```

Use a long, unique password and keep it in a password manager. Forgot it?

```bash
docker compose -f docker-compose.prod.yml exec -it api node dist/cli/create-admin.js admin --reset
```

## 6. Move the phone's data to the server (once)

Send the app's saved data to `POST /v1/import` (see [API.md](API.md#sync)). It only works while the server is empty, so it can't overwrite anything. Afterwards, `GET /v1/sync` returns the same data.

## Updating

```bash
cd sallagrazhda-backend
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

New migrations run automatically before the new API starts. If a migration fails, the old data stays untouched and the API doesn't start; check `docker compose -f docker-compose.prod.yml logs migrate`.

Keep base images patched: run `docker compose -f docker-compose.prod.yml pull` before the `up` command now and then (Caddy, PostgreSQL), and rebuild the API regularly so it picks up Node.js security updates.

## Backups

The `backup` service writes a compressed dump to `./backups/` every 24 hours and keeps `BACKUP_KEEP_DAYS` (default 14) days.

**Backups on the same server don't protect you if the server dies.** Copy them somewhere else regularly, for example from your own computer:

```bash
rsync -av user@server:sallagrazhda-backend/backups/ ./sallagrazhda-backups/
```

or with a nightly cron job on the server using `rclone` to cloud storage. The dumps contain personal data: store them encrypted or in private storage.

Make a backup right now (e.g. before an update):

```bash
docker compose -f docker-compose.prod.yml exec backup sh -c 'pg_dump --format=custom --no-owner --file=/backups/manual-$(date -u +%Y%m%d-%H%M%S).dump'
```

### Restore

```bash
# Stop the API so nothing writes while you restore
docker compose -f docker-compose.prod.yml stop api
docker compose -f docker-compose.prod.yml exec -T db sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backups/sallagrazhda-YYYYMMDD-HHMMSS.dump
docker compose -f docker-compose.prod.yml start api
```

Test a restore once on a spare machine so you know it works before you need it.

## Logs and monitoring

```bash
docker compose -f docker-compose.prod.yml logs -f api      # JSON logs; each request has an id
docker compose -f docker-compose.prod.yml logs -f caddy
```

Logs rotate automatically (5 × 10 MB per service). Point a free uptime monitor (e.g. UptimeRobot, Better Stack) at `https://api.example.com/ready`, which returns `503` when the database is unreachable.

## Using a managed database instead

Remove the `db` and `backup` services from `docker-compose.prod.yml` and set `DATABASE_URL` for `api` and `migrate` to the provider's URL, with `DATABASE_SSL=verify-full`. If the provider signs its certificates with its own CA, add it with `DATABASE_SSL_CA` (`supabase` for Supabase's bundled root, or the provider's PEM certificate). Use `require` only if the certificate can't be verified at all. Use the provider's backups.

## Go-live checklist

- [ ] DNS points to the server; `https://DOMAIN/health` answers with a valid certificate
- [ ] `.env` has a generated `POSTGRES_PASSWORD`, is `chmod 600`, and is not in git
- [ ] Firewall allows only 22, 80, 443; SSH is key-only
- [ ] Admin account created with a strong password stored in a password manager
- [ ] A backup exists in `./backups` and a copy is stored off the server
- [ ] A restore was tested once
- [ ] Uptime monitor on `/ready`
- [ ] Automatic OS security updates enabled
