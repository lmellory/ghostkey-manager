// Запуск: GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/get-refresh-token.mjs
// Получает refresh token (scope drive.file) и создаёт папку для бэкапов.
import http from "node:http";
import { randomBytes } from "node:crypto";
const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) { console.error("Задайте GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET"); process.exit(1); }
const redirect = "http://127.0.0.1:8085", state = randomBytes(16).toString("hex");
const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id: id, redirect_uri: redirect, response_type: "code", access_type: "offline", prompt: "consent",
  scope: "https://www.googleapis.com/auth/drive.file", state });
console.log("Откройте в браузере и разрешите доступ:\n" + url);
const code = await new Promise(res => {
  const srv = http.createServer((req, rsp) => {
    const u = new URL(req.url, redirect);
    if (u.searchParams.get("state") !== state || !u.searchParams.get("code")) { rsp.end("ошибка"); return; }
    rsp.end("Готово, вернитесь в терминал."); srv.close(); res(u.searchParams.get("code"));
  }).listen(8085, "127.0.0.1");
});
const tr = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: "authorization_code" }) });
const t = await tr.json();
if (!t.refresh_token) { console.error("refresh_token не получен:", t.error ?? t); process.exit(1); }
const fr = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", { method: "POST",
  headers: { authorization: `Bearer ${t.access_token}`, "content-type": "application/json" },
  body: JSON.stringify({ name: "PasswordVault-Backups", mimeType: "application/vnd.google-apps.folder" }) });
const f = await fr.json();
console.log("\nGOOGLE_REFRESH_TOKEN=" + t.refresh_token + "\nDRIVE_FOLDER_ID=" + f.id + "\n(Сохраните как секреты Cloudflare, нигде больше не светите.)");
