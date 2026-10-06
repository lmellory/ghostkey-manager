import { describe, it, expect } from "vitest";
import { generatePassword, generateLogin } from "../shared/generators";
import { deriveKeys, encrypt, decrypt, makeVerifier, checkVerifier } from "../shared/crypto";

describe("generators", () => {
  it("пароль: длина, все группы, нет похожих символов", () => {
    for (let n = 8; n <= 32; n++) for (let i = 0; i < 50; i++) {
      const p = generatePassword(n);
      expect(p).toHaveLength(n);
      expect(p).toMatch(/[A-Z]/); expect(p).toMatch(/[a-z]/); expect(p).toMatch(/[0-9]/); expect(p).toMatch(/[!@#$%^&*?]/);
      expect(p).not.toMatch(/[O0lI1]/);
    }
  });
  it("пароль: недопустимая длина", () => { expect(() => generatePassword(7)).toThrow(); expect(() => generatePassword(33)).toThrow(); });
  it("логин: формат и ≤20 символов", () => {
    for (let i = 0; i < 500; i++) { const l = generateLogin(); expect(l.length).toBeLessThanOrEqual(20); expect(l).toMatch(/^[a-z]+_[a-z]+\d{2,3}$/); }
  });
});

describe("crypto", () => {
  const salt = new Uint8Array(16).fill(7);
  it("round-trip, неверный пароль, подмена данных/AAD", async () => {
    const k = await deriveKeys("correct horse battery", salt, 1000);
    const e = await encrypt(k.aes, "секрет", "entry:1:a");
    expect(await decrypt(k.aes, e.ciphertext, e.nonce, "entry:1:a")).toBe("секрет");
    const bad = await deriveKeys("wrong password!!", salt, 1000);
    await expect(decrypt(bad.aes, e.ciphertext, e.nonce, "entry:1:a")).rejects.toThrow();
    await expect(decrypt(k.aes, e.ciphertext, e.nonce, "entry:2:a")).rejects.toThrow();
    const t = e.ciphertext.slice(0, -4) + (e.ciphertext.endsWith("AAAA") ? "BBBB" : "AAAA");
    await expect(decrypt(k.aes, t, e.nonce, "entry:1:a")).rejects.toThrow();
  });
  it("verifier и независимость auth-токена", async () => {
    const k = await deriveKeys("correct horse battery", salt, 1000);
    const v = await makeVerifier(k.aes, 1);
    expect(await checkVerifier(k.aes, 1, v)).toBe(true);
    expect(await checkVerifier((await deriveKeys("other password!!", salt, 1000)).aes, 1, v)).toBe(false);
    expect(await checkVerifier(k.aes, 2, v)).toBe(false);
  });
});
