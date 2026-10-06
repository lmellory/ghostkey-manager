# Бэкап в Google Drive (OAuth личного аккаунта)

## Настройка (один раз)
1. console.cloud.google.com → создайте проект → «APIs & Services» → включите **Google Drive API**.
2. «OAuth consent screen»: тип External, добавьте себя в Test users. **Важно:** пока приложение в статусе *Testing*, refresh token, насколько известно, истекает через 7 дней, и бэкапы тихо перестанут работать. Переведите приложение в *In production* (для личного использования проверка Google не нужна, будет предупреждение «unverified app»).
3. «Credentials» → Create OAuth client ID → тип **Desktop app**. Скопируйте Client ID и Client secret.
4. В cmd: `set GOOGLE_CLIENT_ID=ваш_id`, затем `set GOOGLE_CLIENT_SECRET=ваш_секрет`, затем `node scripts/get-refresh-token.mjs`.
   В PowerShell: `$env:GOOGLE_CLIENT_ID="ваш_id"`, `$env:GOOGLE_CLIENT_SECRET="ваш_секрет"`, затем та же команда node. — откройте ссылку, разрешите доступ. Скрипт выведет `GOOGLE_REFRESH_TOKEN` и `DRIVE_FOLDER_ID` (папка «PasswordVault-Backups» создаётся в вашем Диске).
5. Ключ шифрования архива: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` (в cmd и PowerShell работает как есть).
   **Сохраните его отдельно (менеджер паролей вне этого сервиса)** — без него бэкапы не открыть.
6. Секреты: `npx wrangler secret put` для BACKUP_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, DRIVE_FOLDER_ID. Затем `npm run deploy` (cron 03:00 UTC уже в wrangler.toml).

## Проверка
Cloudflare Dashboard → Workers → password-vault → Triggers → Cron → запустить вручную (или `npx wrangler dev --test-scheduled`). Админу придёт сообщение ✅ или ❌.

## Восстановление в чистую БД
1. Скачайте нужный `vault-backup-*.bin` из папки на Диске.
2. В cmd: `set BACKUP_KEY=<ключ>`, затем `node scripts/restore-backup.mjs vault-backup-XXXX.bin restore.sql`. В PowerShell: `$env:BACKUP_KEY="<ключ>"`, затем та же команда node.
3. Новая БД: `npx wrangler d1 create vault` (id → wrangler.toml), `npm run migrate`.
4. `npx wrangler d1 execute vault --remote --file restore.sql`
5. Проверьте: /users у бота, вход пользователя. Файл restore.sql содержит шифротекст — после проверки удалите.
Данные внутри всё равно зашифрованы мастер-паролями пользователей.
