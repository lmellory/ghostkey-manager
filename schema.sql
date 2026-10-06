CREATE TABLE IF NOT EXISTS users (
  tg_id INTEGER PRIMARY KEY,
  kdf_salt TEXT NOT NULL,
  kdf_params TEXT NOT NULL,
  verifier_blob TEXT NOT NULL,
  verifier_nonce TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  tg_id INTEGER NOT NULL,
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (tg_id) REFERENCES users(tg_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS invites (
  code_hash TEXT PRIMARY KEY,
  created_by INTEGER NOT NULL,
  used_by INTEGER,
  created_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  tg_id INTEGER PRIMARY KEY,
  attempts INTEGER DEFAULT 0,
  locked_until INTEGER DEFAULT 0
);