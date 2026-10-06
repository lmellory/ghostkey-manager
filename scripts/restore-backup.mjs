// Запуск: BACKUP_KEY=... node scripts/restore-backup.mjs vault-backup-XXXX.bin restore.sql
import { readFileSync, writeFileSync } from "node:fs";
import { createDecipheriv } from "node:crypto";
import { gunzipSync } from "node:zlib";
const [, , inFile, outFile = "restore.sql"] = process.argv;
if (!inFile || !process.env.BACKUP_KEY) { console.error("Использование: BACKUP_KEY=... node restore-backup.mjs <файл.bin> [restore.sql]"); process.exit(1); }
const buf = readFileSync(inFile);
if (buf.subarray(0, 4).toString() !== "PVB1") throw new Error("Неизвестный формат файла");
const nonce = buf.subarray(4, 16), ct = buf.subarray(16, buf.length - 16), tag = buf.subarray(buf.length - 16);
const d = createDecipheriv("aes-256-gcm", Buffer.from(process.env.BACKUP_KEY, "base64"), nonce);
d.setAuthTag(tag);
const data = JSON.parse(gunzipSync(Buffer.concat([d.update(ct), d.final()])).toString("utf8")); // final() бросит ошибку при неверном ключе/порче
const lit = v => v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replaceAll("'", "''")}'`;
const sql = [];
for (const t of ["users", "invites", "entries"]) for (const r of data[t]) {
  const c = Object.keys(r); sql.push(`INSERT INTO ${t} (${c.join(",")}) VALUES (${c.map(k => lit(r[k])).join(",")});`);
}
writeFileSync(outFile, sql.join("\n") + "\n");
console.log(`Бэкап от ${data.at}: users=${data.users.length}, invites=${data.invites.length}, entries=${data.entries.length} → ${outFile}`);
