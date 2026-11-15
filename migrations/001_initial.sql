-- Initial schema for the sallagrazhdaApp backend.
-- Money is stored as integer cents; the API speaks euros.
-- Never edit this file once it has been applied anywhere: add 002_*.sql instead.

-- Admin accounts --------------------------------------------------------------

CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username            text NOT NULL CHECK (username ~ '^[A-Za-z0-9._-]{3,50}$'),
  display_name        text NOT NULL DEFAULT '' CHECK (char_length(display_name) <= 100),
  password_hash       text NOT NULL,
  is_active           boolean NOT NULL DEFAULT true,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_key ON users (lower(username));

-- Login sessions. Only a SHA-256 hash of each token is stored, so a database leak
-- does not reveal usable tokens.
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,
  user_agent   text CHECK (char_length(user_agent) <= 300),
  ip           text CHECK (char_length(ip) <= 64),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- App settings (exactly one row) -------------------------------------------------

CREATE TABLE settings (
  id                 smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  admin_name         text NOT NULL CHECK (char_length(admin_name) BETWEEN 1 AND 100),
  organization       text NOT NULL CHECK (char_length(organization) BETWEEN 1 AND 150),
  goal_cents         bigint NOT NULL CHECK (goal_cents BETWEEN 0 AND 100000000000),
  annual_fee_cents   bigint NOT NULL CHECK (annual_fee_cents BETWEEN 0 AND 100000000000),
  season_start_month smallint NOT NULL CHECK (season_start_month BETWEEN 0 AND 11),
  season_start_year  integer NOT NULL CHECK (season_start_year BETWEEN 2000 AND 2200),
  reasons            text[] NOT NULL DEFAULT '{}',
  paper_width        smallint NOT NULL CHECK (paper_width IN (58, 80)),
  -- Next receipt number. Incremented under a row lock, so numbers are never reused.
  next_ticket_number integer NOT NULL DEFAULT 1 CHECK (next_ticket_number >= 1),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Same defaults as the app (DEFAULT_SETTINGS in src/store/useStore.ts).
INSERT INTO settings (admin_name, organization, goal_cents, annual_fee_cents, season_start_month,
                      season_start_year, reasons, paper_width)
VALUES ('Administratori', 'Mirëmbajtja e Oborrit', 250000, 3500, 9, 2027,
        ARRAY['Mirëmbajtja e oborrit', 'Kositja e barit', 'Pastrimi'], 58);

-- People, seasons and tickets ---------------------------------------------------

-- IDs are text so data imported from the app keeps its existing IDs.
CREATE TABLE people (
  id          text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  first_name  text NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 80),
  father_name text NOT NULL CHECK (char_length(father_name) BETWEEN 1 AND 80),
  last_name   text NOT NULL CHECK (char_length(last_name) BETWEEN 1 AND 80),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX people_created_at_idx ON people (created_at);

-- Seasons that have been started. year 2027 = season 2027/28.
CREATE TABLE seasons (
  year       integer PRIMARY KEY CHECK (year BETWEEN 2000 AND 2200),
  month      smallint NOT NULL CHECK (month BETWEEN 0 AND 11),
  started_at timestamptz NOT NULL
);

CREATE TABLE tickets (
  id           text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  number       integer NOT NULL UNIQUE CHECK (number >= 1),
  person_id    text NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('annual', 'payment')),
  season       integer NOT NULL CHECK (season BETWEEN 2000 AND 2200),
  amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 0 AND 100000000000),
  due_cents    bigint CHECK (due_cents BETWEEN 0 AND 100000000000),
  reasons      text[] NOT NULL DEFAULT '{}',
  status       text NOT NULL CHECK (status IN ('paid', 'unpaid')),
  note         text CHECK (char_length(note) <= 500),
  created_at   timestamptz NOT NULL DEFAULT now(),
  paid_at      timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tickets_paid_at_matches_status CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);
CREATE INDEX tickets_person_id_idx ON tickets (person_id);
CREATE INDEX tickets_season_idx ON tickets (season);
-- A person has at most one yearly-fee ticket per season.
CREATE UNIQUE INDEX tickets_one_annual_per_season ON tickets (person_id, season) WHERE kind = 'annual';

-- Yearly tickets the admin deleted on purpose, so they are not generated again.
CREATE TABLE annual_dismissals (
  person_id  text NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  season     integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, season)
);

-- Audit trail -----------------------------------------------------------------

-- Who changed what and when. Kept even when the changed row is deleted.
CREATE TABLE audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text,
  details    jsonb,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_at_idx ON audit_log (created_at);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);
