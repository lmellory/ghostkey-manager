import { validateInitData } from "./auth";
import { runBackup } from "./backup";

export interface Env {
  DB: D1Database; ASSETS: Fetcher;
  BOT_TOKEN: string; ADMIN_ID: string; WEBHOOK_SECRET: string; APP_URL: string;
  BACKUP_KEY: string; GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string; GOOGLE_REFRESH_TOKEN: string; DRIVE_FOLDER_ID: string;
}
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, "0")).join("");

async function tg(env: Env, method: string, body: object) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) console.error("tg", method, r.status); // тело не логируем
}

// ───────── Бот ─────────
async function menu(env: Env, chat: number) {
  await tg(env, "sendMessage", { chat_id: chat, text: "Password Vault", reply_markup: { inline_keyboard: [
    [{ text: "🔐 Открыть сейф", web_app: { url: env.APP_URL } }],
    [{ text: "➕ Добавить запись", web_app: { url: env.APP_URL + "/?new=1" } }],
    [{ text: "ℹ️ Помощь", callback_data: "help" }, { text: "🔒 Выйти", callback_data: "logout" }]] } });
}

async function onMessage(env: Env, m: any) {
  const id: number = m.from.id, chat: number = m.chat.id, text: string = (m.text ?? "").trim();
  const isAdmin = String(id) === env.ADMIN_ID;
  if (isAdmin && text === "/invite") {
    const code = [...crypto.getRandomValues(new Uint8Array(10))].map(b => b.toString(16).padStart(2, "0")).join("");
    await env.DB.prepare("INSERT INTO invites (code_hash, created_by, created_at) VALUES (?,?,?)").bind(await sha256(code), id, Date.now()).run();
    return tg(env, "sendMessage", { chat_id: chat, text: `Код (одноразовый, показан один раз):\n${code}` });
  }
  if (isAdmin && text === "/users") {
    const { results } = await env.DB.prepare("SELECT tg_id, status FROM users").all();
    return tg(env, "sendMessage", { chat_id: chat, text: results.map((u: any) => `${u.tg_id} ${u.status}`).join("\n") || "Пусто" });
  }
  if (isAdmin && text.startsWith("/revoke ")) {
    const target = Number(text.split(/\s+/)[1]);
    if (!Number.isSafeInteger(target)) return tg(env, "sendMessage", { chat_id: chat, text: "Формат: /revoke <id>" });
    await env.DB.batch([
      env.DB.prepare("DELETE FROM entries WHERE tg_id=?").bind(target),
      env.DB.prepare("UPDATE users SET status='revoked', kdf_salt=NULL, kdf_params=NULL, verifier_blob=NULL, auth_hash=NULL WHERE tg_id=?").bind(target)]);
    return tg(env, "sendMessage", { chat_id: chat, text: `Доступ ${target} отозван, данные удалены.` });
  }
  const user: any = await env.DB.prepare("SELECT status FROM users WHERE tg_id=?").bind(id).first();
  if (user && user.status !== "revoked") {
    if (text.startsWith("/start")) return menu(env, chat);
    // Любой обычный текст от пользователя может быть паролем — удаляем сразу.
    await tg(env, "deleteMessage", { chat_id: chat, message_id: m.message_id });
    return tg(env, "sendMessage", { chat_id: chat, text: "⚠️ Не отправляйте пароли в чат. Сообщение удалено. Используйте Mini App." });
  }
  // Неавторизованный: ждём инвайт-код (сообщение с кодом удаляем в любом случае).
  if (text.startsWith("/start")) return tg(env, "sendMessage", { chat_id: chat, text: "Доступ по приглашению. Отправьте инвайт-код." });
  await tg(env, "deleteMessage", { chat_id: chat, message_id: m.message_id });
  if (!/^[0-9a-f]{20}$/.test(text)) return tg(env, "sendMessage", { chat_id: chat, text: "Неверный код." });
  const claim = await env.DB.prepare("UPDATE invites SET used_by=?, used_at=? WHERE code_hash=? AND used_by IS NULL").bind(id, Date.now(), await sha256(text)).run(); // атомарно
  if (!claim.meta.changes) return tg(env, "sendMessage", { chat_id: chat, text: "Код недействителен или уже использован." });
  await env.DB.prepare("INSERT INTO users (tg_id, status, created_at) VALUES (?, 'pending', ?) ON CONFLICT(tg_id) DO UPDATE SET status='pending'").bind(id, Date.now()).run();
  await tg(env, "sendMessage", { chat_id: chat, text: "Код принят. Откройте сейф и создайте мастер-пароль.\n⚠️ Забытый мастер-пароль восстановить невозможно." });
  return menu(env, chat);
}

async function onCallback(env: Env, q: any) {
  await tg(env, "answerCallbackQuery", { callback_query_id: q.id });
  if (q.data === "help") return tg(env, "sendMessage", { chat_id: q.message.chat.id, text: "Откройте сейф кнопкой. Данные шифруются на вашем устройстве мастер-паролем." });
  if (q.data === "logout") return tg(env, "sendMessage", { chat_id: q.message.chat.id, text: "Закройте Mini App — ключ стирается при закрытии/блокировке." });
}

// ───────── Rate limiting (окно 1 минута, счётчики в D1) ─────────
async function hit(env: Env, key: string, limit: number): Promise<boolean> {
  const w = Math.floor(Date.now() / 60_000);
  const r: any = await env.DB.prepare("INSERT INTO rate_limits (k, w, c) VALUES (?,?,1) ON CONFLICT(k, w) DO UPDATE SET c = c + 1 RETURNING c").bind(key, w).first();
  return r.c <= limit;
}

// ───────── API ─────────
async function api(req: Request, env: Env, url: URL): Promise<Response> {
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  if (!(await hit(env, "ip:" + ip, 120))) return json({ error: "rate limited" }, 429);
  const init = (req.headers.get("authorization") ?? "").replace(/^tma /, "");
  const user = await validateInitData(init, env.BOT_TOKEN);
  if (!user) return json({ error: "unauthorized" }, 401);
  const id = user.id; // владелец — только из проверенного initData
  if (!(await hit(env, "tg:" + id, 60))) return json({ error: "rate limited" }, 429);
  const row: any = await env.DB.prepare("SELECT * FROM users WHERE tg_id=?").bind(id).first();
  if (!row || row.status === "revoked") return json({ error: "forbidden" }, 403);
  const body: any = req.method === "GET" || req.method === "DELETE" ? {} : await req.json().catch(() => ({}));
  const path = url.pathname;

  if (path === "/api/state" && req.method === "GET") // соль/параметры — не секрет
    return json({ status: row.status, salt: row.kdf_salt, params: row.kdf_params });

  if (path === "/api/register" && req.method === "POST") {
    if (row.status !== "pending") return json({ error: "already registered" }, 409);
    const { salt, params, verifier, auth } = body;
    if (![salt, params, verifier, auth].every(v => typeof v === "string" && v.length < 2000)) return json({ error: "bad request" }, 400);
    await env.DB.prepare("UPDATE users SET kdf_salt=?, kdf_params=?, verifier_blob=?, auth_hash=?, status='active' WHERE tg_id=? AND status='pending'")
      .bind(salt, params, verifier, await sha256(auth), id).run();
    return json({ ok: true });
  }

  // Дальше — только активные и с auth-токеном (серверный лимит попыток).
  if (row.status !== "active") return json({ error: "not registered" }, 403);
  const att: any = await env.DB.prepare("SELECT fails, locked_until FROM login_attempts WHERE tg_id=?").bind(id).first();
  const now = Date.now();
  if (att && att.locked_until > now) return json({ error: "locked", retry_after: Math.ceil((att.locked_until - now) / 1000) }, 429);
  const token = req.headers.get("x-vault-auth") ?? "";
  if ((await sha256(token)) !== row.auth_hash) {
    const fails = (att?.fails ?? 0) + 1;
    // 5 свободных попыток, затем 30с·2^n, максимум 15 минут
    const lock = fails >= 5 ? Math.min(30_000 * 2 ** (fails - 5), 900_000) : 0;
    await env.DB.prepare("INSERT INTO login_attempts (tg_id, fails, locked_until) VALUES (?,?,?) ON CONFLICT(tg_id) DO UPDATE SET fails=?, locked_until=?").bind(id, fails, now + lock, fails, now + lock).run();
    return json({ error: "bad auth" }, 401);
  }
  if (att?.fails) await env.DB.prepare("DELETE FROM login_attempts WHERE tg_id=?").bind(id).run();

  if (path === "/api/unlock" && req.method === "POST") return json({ verifier: row.verifier_blob });
  if (path === "/api/entries" && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, ciphertext, nonce, created_at, updated_at FROM entries WHERE tg_id=?").bind(id).all();
    return json({ entries: results });
  }
  if (path === "/api/entries" && req.method === "POST") {
    const { id: eid, ciphertext, nonce } = body; // id создаёт клиент: он нужен в AAD до шифрования
    if (typeof eid !== "string" || !/^[0-9a-f-]{36}$/.test(eid) || typeof ciphertext !== "string" || typeof nonce !== "string" || ciphertext.length > 20000 || nonce.length > 32) return json({ error: "bad request" }, 400);
    await env.DB.prepare("INSERT INTO entries (id, tg_id, ciphertext, nonce, created_at, updated_at) VALUES (?,?,?,?,?,?)").bind(eid, id, ciphertext, nonce, now, now).run();
    return json({ id: eid });
  }
  const m = path.match(/^\/api\/entries\/([0-9a-f-]{36})$/);
  if (m && req.method === "PUT") {
    const { ciphertext, nonce } = body;
    if (typeof ciphertext !== "string" || typeof nonce !== "string" || ciphertext.length > 20000) return json({ error: "bad request" }, 400);
    const r = await env.DB.prepare("UPDATE entries SET ciphertext=?, nonce=?, updated_at=? WHERE id=? AND tg_id=?").bind(ciphertext, nonce, now, m[1], id).run();
    return r.meta.changes ? json({ ok: true }) : json({ error: "not found" }, 404);
  }
  if (m && req.method === "DELETE") {
    const r = await env.DB.prepare("DELETE FROM entries WHERE id=? AND tg_id=?").bind(m[1], id).run();
    return r.meta.changes ? json({ ok: true }) : json({ error: "not found" }, 404);
  }
  return json({ error: "not found" }, 404);
}

const SEC: Record<string, string> = {
  "content-security-policy": "default-src 'none'; script-src 'self' https://telegram.org; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors https://web.telegram.org https://*.telegram.org",
  "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
};
const withSec = (r: Response) => { const o = new Response(r.body, r); for (const k in SEC) o.headers.set(k, SEC[k]); return o; };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/health") return new Response("ok");
      if (url.pathname === "/webhook" && req.method === "POST") {
        if (req.headers.get("x-telegram-bot-api-secret-token") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
        const u: any = await req.json();
        if (u.message?.from && u.message.chat?.type === "private") await onMessage(env, u.message);
        else if (u.callback_query) await onCallback(env, u.callback_query);
        return new Response("ok");
      }
      if (url.pathname.startsWith("/api/")) return withSec(await api(req, env, url));
      return withSec(await env.ASSETS.fetch(req));
    } catch (e) { console.error("error", (e as Error).message); return new Response("error", { status: 500 }); }
  },
  async scheduled(_e: ScheduledController, env: Env, ctx: ExecutionContext) { ctx.waitUntil(Promise.all([runBackup(env), env.DB.prepare("DELETE FROM rate_limits WHERE w < ?").bind(Math.floor(Date.now() / 60_000) - 60).run()])); },
};
