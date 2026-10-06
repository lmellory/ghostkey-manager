// Валидация Telegram initData (HMAC-SHA256 по токену бота).
const enc = new TextEncoder();
const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map(h => parseInt(h, 16)));

export interface TgUser { id: number; first_name?: string }

export async function validateInitData(initData: string, botToken: string, maxAgeSec = 3600, now = Date.now()): Promise<TgUser | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete("hash");
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const hk = await crypto.subtle.importKey("raw", enc.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const secret = await crypto.subtle.sign("HMAC", hk, enc.encode(botToken));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  // verify() сравнивает подпись за постоянное время
  if (!(await crypto.subtle.verify("HMAC", key, hex(hash), enc.encode(dcs)))) return null;
  const age = now / 1000 - Number(params.get("auth_date"));
  if (!(age >= 0 && age <= maxAgeSec)) return null;
  try { const u = JSON.parse(params.get("user") ?? ""); return typeof u.id === "number" ? u : null; } catch { return null; }
}
