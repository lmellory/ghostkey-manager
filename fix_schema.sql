DROP TABLE IF EXISTS rate_limits;
CREATE TABLE rate_limits (
  k TEXT NOT NULL,
  w INTEGER NOT NULL,
  c INTEGER NOT NULL,
  PRIMARY KEY (k, w)
);
DROP TABLE IF EXISTS login_attempts;
CREATE TABLE login_attempts (
  tg_id INTEGER PRIMARY KEY,
  fails INTEGER DEFAULT 0,
  locked_until INTEGER DEFAULT 0
);