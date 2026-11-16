-- The API no longer keeps a change history, so remove the table and the rows already in it.
DROP TABLE IF EXISTS audit_log;
