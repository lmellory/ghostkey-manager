// E2E-криптография (браузер). Пароль и ключ шифрования на сервер не уходят.
// Уходит только auth-токен — независимая HKDF-ветка (вариант А2).
export const KDF_ITER = 600_000;
const enc = new TextEncoder(), dec = new TextDecoder();
export const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
export const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export interface Keys { aes: CryptoKey; authToken: string }

export async function deriveKeys(password: string, salt: Uint8Array, iterations = KDF_ITER): Promise<Keys> {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const master = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, base, 256);
  const hk = await crypto.subtle.importKey("raw", master, "HKDF", false, ["deriveBits", "deriveKey"]);
  const p = (info: string) => ({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(info) });
  const aes = await crypto.subtle.deriveKey(p("vault-enc-v1"), hk, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const authToken = b64(new Uint8Array(await crypto.subtle.deriveBits(p("vault-auth-v1"), hk, 256)));
  return { aes, authToken };
}

export const newSalt = () => crypto.getRandomValues(new Uint8Array(16));

/** AAD привязывает шифротекст к владельцу и записи (защита от подмены блоков). */
export async function encrypt(key: CryptoKey, plain: string, aad: string) {
  const nonce = crypto.getRandomValues(new Uint8Array(12)); // уникальный на каждую запись
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: enc.encode(aad) }, key, enc.encode(plain));
  return { ciphertext: b64(new Uint8Array(ct)), nonce: b64(nonce) };
}
export async function decrypt(key: CryptoKey, ciphertext: string, nonce: string, aad: string): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(nonce), additionalData: enc.encode(aad) }, key, unb64(ciphertext));
  return dec.decode(pt); // бросает исключение при неверном ключе/изменённых данных
}

const MAGIC = "vault-ok-v1";
export const makeVerifier = async (k: CryptoKey, tgId: number) =>
  JSON.stringify(await encrypt(k, MAGIC, `verifier:${tgId}`));
export async function checkVerifier(k: CryptoKey, tgId: number, blob: string): Promise<boolean> {
  try { const v = JSON.parse(blob); return (await decrypt(k, v.ciphertext, v.nonce, `verifier:${tgId}`)) === MAGIC; }
  catch { return false; }
}
