import { describe, it, expect } from "vitest";
import { validateInitData } from "../src/auth";

const enc = new TextEncoder();
async function sign(params: Record<string, string>, token: string) {
  const dcs = Object.entries(params).map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const hk = await crypto.subtle.importKey("raw", enc.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sk = await crypto.subtle.importKey("raw", await crypto.subtle.sign("HMAC", hk, enc.encode(token)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const h = [...new Uint8Array(await crypto.subtle.sign("HMAC", sk, enc.encode(dcs)))].map(b => b.toString(16).padStart(2, "0")).join("");
  return new URLSearchParams({ ...params, hash: h }).toString();
}
describe("initData", () => {
  const now = 1_800_000_000_000, t = "123:TOKEN";
  const base = { auth_date: String(now / 1000 - 10), user: JSON.stringify({ id: 42 }) };
  it("валидный", async () => expect((await validateInitData(await sign(base, t), t, 3600, now))?.id).toBe(42));
  it("чужой токен", async () => expect(await validateInitData(await sign(base, "999:X"), t, 3600, now)).toBeNull());
  it("устарел", async () => expect(await validateInitData(await sign({ ...base, auth_date: String(now / 1000 - 7200) }, t), t, 3600, now)).toBeNull());
  it("подмена user", async () => {
    const q = (await sign(base, t)).replace(encodeURIComponent('"id":42'), encodeURIComponent('"id":43'));
    expect(await validateInitData(q, t, 3600, now)).toBeNull();
  });
});
