# ghostkey-manager
A secure, autonomous, serverless credentials manager built as a Telegram Mini App powered by Cloudflare Workers + D1 and client-side Zero-Knowledge Encryption.

✨ Features
Zero-Knowledge Architecture: Master password and derived encryption keys never leave the client device or touch persistent browser storage. All encryption and decryption take place strictly in local memory.

Robust Cryptography: Key derivation via PBKDF2-SHA256 (600,000 iterations) with individual salts; record encryption using AES-256-GCM with unique initialization vectors (nonce) per entry.

Built-in Generators: Cryptographically secure password generator (WebCrypto API) excluding ambiguous characters (0/O, 1/l/I), plus a pronounceable login generator.

Access Control: Single-use invitation codes managed by the administrator, Telegram initData HMAC-SHA256 verification on all endpoints, and strict IDOR prevention.

Automated Backups: Daily database snapshot via Cloudflare Cron Triggers (03:00 UTC), gzipped and encrypted with a secondary key, uploaded directly to Google Drive via Drive API v3 (OAuth 2.0).

🛠 Tech Stack
Backend / Platform: Cloudflare Workers (TypeScript)

Database: Cloudflare D1 (SQLite)

Frontend Mini App: Vanilla TypeScript, Vite, WebCrypto API, Telegram WebApp SDK

Backups: Google Drive API v3

🚀 Deployment
1. Clone & Install
Bash
git clone [https://github.com/](https://github.com/)<your-username>/aegis-vault.git
cd aegis-vault
npm install
2. Cloudflare D1 Setup
Bash
npx wrangler d1 create vault
# Paste the returned database_id into wrangler.toml
npx wrangler d1 execute DB --remote --file=./schema.sql
3. Configure Secrets
Bash
npx wrangler secret put BOT_TOKEN

npx wrangler secret put ADMIN_ID

npx wrangler secret put WEBHOOK_SECRET

npx wrangler secret put BACKUP_KEY

npx wrangler secret put GOOGLE_CLIENT_ID

npx wrangler secret put GOOGLE_CLIENT_SECRET

npx wrangler secret put GOOGLE_REFRESH_TOKEN

npx wrangler secret put DRIVE_FOLDER_ID

4. Build & Deploy
Bash
npm run build
npx wrangler deploy

📄 License

Distributed under the MIT License.
