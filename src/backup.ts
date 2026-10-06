// Ежедневный бэкап: дамп D1 → gzip → AES-GCM(BACKUP_KEY) → Google Drive (OAuth) → ротация 30 копий.
import type { Env } from "./index";

const KEEP = 30;
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const w = cs.writable.getWriter(); w.write(data); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

/** Формат файла: "PVB1" | nonce(12) | AES-GCM(gzip(json)) (тег GCM — последние 16 байт). */
async function seal(env: Env, plain: Uint8Array): Promise<Uint8Array> {
  const raw = unb64(env.BACKUP_KEY);
  if (raw.length !== 32) throw new Error("BACKUP_KEY должен быть 32 байта в base64");
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plain));
  const out = new Uint8Array(4 + 12 + ct.length);
  out.set(new TextEncoder().encode("PVB1")); out.set(nonce, 4); out.set(ct, 16);
  return out;
}

async function dump(env: Env): Promise<Uint8Array> {
  const q = async (t: string) => (await env.DB.prepare(`SELECT * FROM ${t}`).all()).results;
  const data = { v: 1, at: new Date().toISOString(), users: await q("users"), invites: await q("invites"), entries: await q("entries") };
  return new TextEncoder().encode(JSON.stringify(data));
}

async function accessToken(env: Env): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token" }),
  });
  const j: any = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`OAuth: ${r.status} ${j.error ?? ""} ${j.error_description ?? ""}`);
  return j.access_token;
}

async function upload(tok: string, folder: string, name: string, bytes: Uint8Array) {
  const b = "pvboundary" + crypto.randomUUID().replace(/-/g, "");
  const enc = new TextEncoder();
  const head = enc.encode(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder] })}\r\n--${b}\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const tail = enc.encode(`\r\n--${b}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": `multipart/related; boundary=${b}` }, body,
  });
  if (!r.ok) throw new Error(`Drive upload: ${r.status} ${(await r.text()).slice(0, 300)}`);
}

async function rotate(tok: string, folder: string): Promise<number> {
  const qs = new URLSearchParams({ q: `'${folder}' in parents and trashed=false and name contains 'vault-backup-'`, orderBy: "createdTime desc", pageSize: "200", fields: "files(id)" });
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?${qs}`, { headers: { authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new Error(`Drive list: ${r.status}`);
  const files: { id: string }[] = ((await r.json()) as any).files;
  let deleted = 0;
  for (const f of files.slice(KEEP)) {
    const d = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, { method: "DELETE", headers: { authorization: `Bearer ${tok}` } });
    if (d.ok) deleted++;
  }
  return deleted;
}

const notify = (env: Env, text: string) =>
  fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: env.ADMIN_ID, text }) }).catch(() => {});

export async function runBackup(env: Env): Promise<void> {
  try {
    const sealed = await seal(env, await gzip(await dump(env)));
    const name = `vault-backup-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-")}.bin`;
    const tok = await accessToken(env);
    await upload(tok, env.DRIVE_FOLDER_ID, name, sealed);
    const del = await rotate(tok, env.DRIVE_FOLDER_ID);
    await notify(env, `✅ Бэкап ${name} (${Math.round(sealed.length / 1024)} КБ), удалено старых: ${del}`);
  } catch (e) {
    console.error("backup failed", (e as Error).message);
    await notify(env, `❌ Бэкап не удался:\n${(e as Error).message}\nЕсли ошибка invalid_grant — перевыпустите refresh token (docs/BACKUP.md).`);
  }
}
