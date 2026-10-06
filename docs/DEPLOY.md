# Развёртывание для новичка

**Важно:** копируйте в терминал только сами команды из блоков кода, без пояснений после них. Инструкция рассчитана на Windows (cmd или PowerShell).

Нужно: аккаунт Telegram, бесплатный аккаунт Cloudflare, Node.js 20+ (nodejs.org), включённая 2FA в Cloudflare и Telegram.

## 1. Бот
1. В Telegram откройте @BotFather → `/newbot` → задайте имя и username → сохраните **BOT_TOKEN** (это пароль от бота, никому не показывайте).
2. Узнайте свой числовой Telegram ID (например, бот @userinfobot) — это **ADMIN_ID**.

## 2. Проект
```
cd password-vault
npm install
npm test
```
`npm install` создаст файл package-lock.json — не удаляйте его, он фиксирует версии. `npm test`: все тесты должны пройти.

## 3. Cloudflare и база
```
npx wrangler login
npx wrangler d1 create vault
```
Команда выведет `database_id` — вставьте его в `wrangler.toml` вместо ЗАМЕНИТЕ_ПОСЛЕ_wrangler_d1_create. Затем:
```
npm run migrate
```
Команда применит migrations/0001 и 0002 к удалённой БД.

## 4. Секреты
Каждая команда спросит значение и сохранит его в Cloudflare (в файлы не пишется):
```
npx wrangler secret put BOT_TOKEN
npx wrangler secret put ADMIN_ID
npx wrangler secret put WEBHOOK_SECRET
```
WEBHOOK_SECRET — случайная строка из букв A-Z a-z, цифр, _ и -, 32+ символа.
Секреты бэкапа (BACKUP_KEY, GOOGLE_*, DRIVE_FOLDER_ID) — по `docs/BACKUP.md`. Без них ежедневный бэкап будет присылать вам сообщение об ошибке, остальное работает.

## 5. Деплой
```
npm run deploy
```
Wrangler напечатает адрес вида `https://password-vault.<имя>.workers.dev`. Впишите его в `wrangler.toml` в `APP_URL` и выполните `npm run deploy` ещё раз. Проверьте, что `https://<адрес>/health` отвечает `ok`.

## 6. Webhook
Скопируйте `.env.example` в `.env`, заполните BOT_TOKEN, WEBHOOK_SECRET (то же значение, что в п.4) и WORKER_URL. Затем:
```
node --env-file=.env scripts/set-webhook.mjs
```
Должно появиться `200 ok`. Файл `.env` не коммитьте (он в `.gitignore`).

## 7. Mini App в BotFather
@BotFather → `/newapp` → выберите бота → укажите Web App URL = ваш `APP_URL`. Либо `/mybots` → бот → Bot Settings → Menu Button → тот же URL.

## 8. Первый запуск
1. Напишите боту `/start` с вашего ADMIN_ID, затем `/invite` — придёт одноразовый код.
2. Чтобы зарегистрироваться самому, отправьте этот код боту (он удалит ваше сообщение), нажмите «Открыть сейф», придумайте мастер-пароль (≥10 символов). Для друзей: `/invite` на каждого, отдавайте код лично.
3. Добавьте запись, заблокируйте и разблокируйте сейф. Затем пройдите ручной чек-лист в `docs/CHECKLIST.md`.

## Если что-то не работает
- Бот молчит: `npx wrangler tail` (логи без чувствительных данных) и проверьте `getWebhookInfo` (`https://api.telegram.org/bot<TOKEN>/getWebhookInfo`).
- Mini App показывает «Нет доступа»: вы ещё не ввели инвайт-код или открыли приложение не из чата с ботом.
