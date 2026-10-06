// Запуск: node --env-file=.env scripts/set-webhook.mjs
const { BOT_TOKEN, WEBHOOK_SECRET, WORKER_URL } = process.env;
if (!BOT_TOKEN || !WEBHOOK_SECRET || !WORKER_URL) { console.error("Заполните .env"); process.exit(1); }
const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ url: `${WORKER_URL}/webhook`, secret_token: WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"] }),
});
console.log(r.status, (await r.json()).description ?? "ok");
