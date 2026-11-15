-- Runs once when the local Docker database is first created.
-- A separate database for automated tests, so `npm test` never touches your dev data.
CREATE DATABASE sallagrazhda_test OWNER sallagrazhda;
