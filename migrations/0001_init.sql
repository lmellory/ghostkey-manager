CREATE TABLE users (
  tg_id INTEGER PRIMARY KEY,
  kdf_salt TEXT, kdf_params TEXT, verifier_blob TEXT, auth_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
  created_at INTEGER NOT NULL
);
CREATE TABLE invites (
  code_hash TEXT PRIMARY KEY, created_by INTEGER NOT NULL,
  used_by INTEGER, used_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE entries (
  id TEXT PRIMARY KEY, tg_id INTEGER NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL, nonce TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX idx_entries_user ON entries(tg_id);
CREATE TABLE login_attempts (
  tg_id INTEGER PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0
);
