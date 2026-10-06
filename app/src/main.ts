import { deriveKeys, newSalt, b64, unb64, encrypt, decrypt, makeVerifier, checkVerifier, KDF_ITER, Keys } from "../../shared/crypto";
import { generateLogin, generatePassword } from "../../shared/generators";

declare const Telegram: any;
const tgApp = Telegram.WebApp;
tgApp.ready(); tgApp.expand(); tgApp.disableVerticalSwipes?.();
const tgId: number = tgApp.initDataUnsafe?.user?.id;

interface Entry { id: string; service: string; login: string; password: string; notes: string; created: number; updated: number }
let keys: Keys | null = null;
let entries: Entry[] = [];
const clampLen = (n: number) => Math.min(32, Math.max(8, Math.floor(n) || 8));
function loadSet(): any { try { return JSON.parse(localStorage.getItem("pv-set") || "{}"); } catch { return {}; } }
const set0 = loadSet();
let pwLen = clampLen(set0.len);
let idleMin: number = [1, 5, 15].includes(set0.idle) ? set0.idle : 5;
function saveSet() { try { localStorage.setItem("pv-set", JSON.stringify({ len: pwLen, idle: idleMin })); } catch { /* хранилище недоступно */ } }
/** Паддинг пробелами до кратного 256 байт — скрывает точную длину данных (JSON.parse игнорирует хвост). */
function pad(s: string): string { const n = new TextEncoder().encode(s).length; return s + " ".repeat((256 - (n % 256)) % 256); }

const root = document.getElementById("app")!;
function h(tag: string, props: Record<string, any> = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) k.startsWith("on") ? e.addEventListener(k.slice(2), v) : k === "class" ? (e.className = v) : e.setAttribute(k, v);
  e.append(...kids); return e;
}
function show(...nodes: Node[]) { root.replaceChildren(h("div", { class: "wrap" }, ...nodes)); }

async function api(method: string, path: string, body?: unknown, withAuth = true) {
  const headers: Record<string, string> = { authorization: "tma " + tgApp.initData, "content-type": "application/json" };
  if (withAuth && keys) headers["x-vault-auth"] = keys.authToken;
  const r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error ?? "error"), { status: r.status, data });
  return data;
}

// ───────── Блокировка ─────────
let idleTimer: number | undefined, bgTimer: number | undefined;
function lock() { keys = null; entries = []; clearTimeout(idleTimer); clearTimeout(bgTimer); start(); }
function touch() { if (!keys) return; clearTimeout(idleTimer); idleTimer = window.setTimeout(lock, idleMin * 60_000); }
["pointerdown", "keydown", "scroll"].forEach(e => addEventListener(e, touch, { passive: true }));
const onHide = () => { if (keys) bgTimer = window.setTimeout(lock, 60_000); };
const onShow = () => clearTimeout(bgTimer);
document.addEventListener("visibilitychange", () => (document.hidden ? onHide() : onShow()));
tgApp.onEvent?.("deactivated", onHide); tgApp.onEvent?.("activated", onShow);

// ───────── Буфер обмена ─────────
async function copy(text: string, clear = true) {
  try { await navigator.clipboard.writeText(text); tgApp.HapticFeedback?.notificationOccurred("success");
    if (clear) setTimeout(() => navigator.clipboard.writeText("").catch(() => {}), 30_000); } // best-effort
  catch { tgApp.showAlert("Не удалось скопировать"); }
}

// ───────── Экраны ─────────
const KDF_MIN = KDF_ITER; // сервер не должен иметь возможность занизить стойкость
async function start() {
  show(h("p", { class: "muted" }, "Загрузка…"));
  try {
    const st = await api("GET", "/api/state", undefined, false);
    if (st.status === "pending") return registerScreen();
    unlockScreen(st.salt, JSON.parse(st.params));
  } catch { show(h("p", { class: "err" }, "Нет доступа. Запросите инвайт-код у бота.")); }
}

function registerScreen() {
  const p1 = h("input", { type: "password", autocomplete: "new-password" }) as HTMLInputElement;
  const p2 = h("input", { type: "password", autocomplete: "new-password" }) as HTMLInputElement;
  const err = h("div", { class: "err" });
  const btn = h("button", { class: "primary" }, "Создать сейф");
  btn.addEventListener("click", async () => {
    if (p1.value.length < 10) return void (err.textContent = "Минимум 10 символов");
    if (p1.value !== p2.value) return void (err.textContent = "Пароли не совпадают");
    btn.setAttribute("disabled", ""); err.textContent = "Вычисляю ключ…";
    const salt = newSalt(); const k = await deriveKeys(p1.value, salt);
    await api("POST", "/api/register", { salt: b64(salt), params: JSON.stringify({ alg: "PBKDF2-SHA256", iter: KDF_ITER }), verifier: await makeVerifier(k.aes, tgId), auth: k.authToken }, false);
    p1.value = p2.value = ""; start();
  });
  show(h("h1", {}, "PASSWORD VAULT"), h("p", { class: "warn" }, "⚠️ Мастер-пароль нельзя восстановить. Забудете — данные будут потеряны навсегда."),
    h("label", {}, "Мастер-пароль (мин. 10)"), p1, h("label", {}, "Повторите"), p2, h("div", { class: "row" }, btn), err);
}

function unlockScreen(saltB64: string, params: { iter: number }) {
  const pw = h("input", { type: "password", autocomplete: "current-password" }) as HTMLInputElement;
  const err = h("div", { class: "err" });
  const btn = h("button", { class: "primary" }, "Открыть");
  btn.addEventListener("click", async () => {
    if (!(params.iter >= KDF_MIN)) return void (err.textContent = "Слабые параметры KDF — отказ");
    btn.setAttribute("disabled", ""); err.textContent = "Проверяю…";
    try {
      const k = await deriveKeys(pw.value, unb64(saltB64), params.iter); keys = k;
      const { verifier } = await api("POST", "/api/unlock", {});
      if (!(await checkVerifier(k.aes, tgId, verifier))) throw new Error("bad");
      pw.value = ""; await loadEntries(); touch(); listScreen();
    } catch (e: any) {
      keys = null; btn.removeAttribute("disabled");
      err.textContent = e.status === 429 ? `Слишком много попыток. Повторите через ${e.data.retry_after} с` : "Неверный мастер-пароль";
    }
  });
  show(h("h1", {}, "PASSWORD VAULT"), h("label", {}, "Мастер-пароль"), pw, h("div", { class: "row" }, btn), err);
}

async function loadEntries() {
  const { entries: rows } = await api("GET", "/api/entries");
  entries = [];
  for (const r of rows) {
    try { entries.push({ ...JSON.parse(await decrypt(keys!.aes, r.ciphertext, r.nonce, `entry:${tgId}:${r.id}`)), id: r.id, created: r.created_at, updated: r.updated_at }); }
    catch { /* запись повреждена/подменена — пропускаем */ }
  }
  entries.sort((a, b) => b.updated - a.updated); // новые сверху
}

function listScreen(q = "") {
  const search = h("input", { placeholder: "Поиск…", value: q }) as HTMLInputElement;
  const list = h("div");
  const draw = () => {
    const s = search.value.toLowerCase();
    list.replaceChildren(...entries.filter(e => e.service.toLowerCase().includes(s) || e.login.toLowerCase().includes(s)).map(e =>
      h("div", { class: "card", onclick: () => cardScreen(e) }, h("b", {}, e.service), h("div", { class: "muted" }, e.login))));
  };
  search.addEventListener("input", draw); draw();
  show(h("h1", {}, "PASSWORD VAULT"), h("div", { class: "row" }, h("button", { class: "primary", onclick: () => formScreen() }, "➕ Добавить"), h("button", { onclick: lock }, "🔒 Блок"), h("button", { onclick: settingsScreen }, "⚙️")), h("div", { class: "card" }, search), list);
  tgApp.BackButton.hide();
}

function cardScreen(e: Entry) {
  let visible = false;
  const pwEl = h("div", {}, "••••••••");
  const tog = h("button", { onclick: () => { visible = !visible; pwEl.textContent = visible ? e.password : "••••••••"; tog.textContent = visible ? "Скрыть" : "Показать"; } }, "Показать");
  const del = async () => tgApp.showPopup({ message: `Удалить «${e.service}»?`, buttons: [{ id: "y", type: "destructive", text: "Удалить" }, { type: "cancel" }] },
    async (id: string) => { if (id === "y") { await api("DELETE", `/api/entries/${e.id}`); await loadEntries(); listScreen(); } });
  show(h("h1", {}, e.service), h("label", {}, "Логин"), h("div", {}, e.login), h("label", {}, "Пароль"), pwEl,
    h("div", { class: "row" }, tog, h("button", { onclick: () => copy(e.password) }, "Копировать")),
    e.notes ? h("div", {}, h("label", {}, "Примечания"), h("div", {}, e.notes)) : h("span"),
    h("div", { class: "row" }, h("button", { onclick: () => formScreen(e) }, "✏️ Изменить"), h("button", { onclick: del }, "🗑 Удалить")));
  tgApp.BackButton.show(); tgApp.BackButton.onClick(() => listScreen());
}

const ask = (message: string, buttons: any[]) => new Promise<string>(res => tgApp.showPopup({ message, buttons }, (id: string) => res(id ?? "cancel")));

function formScreen(edit?: Entry) {
  const service = h("input", { maxlength: "100", value: edit?.service ?? "" }) as HTMLInputElement;
  const login = h("input", { value: edit?.login ?? "", autocapitalize: "off" }) as HTMLInputElement;
  const pass = h("input", { type: "password", value: edit?.password ?? "" }) as HTMLInputElement;
  const len = h("input", { type: "number", min: "8", max: "32", value: String(pwLen) }) as HTMLInputElement;
  const notes = h("textarea", { rows: "3" }) as HTMLTextAreaElement; notes.value = edit?.notes ?? "";
  const err = h("div", { class: "err" });
  const save = async () => {
    const s = service.value.trim();
    if (!s) return void (err.textContent = "Заполните «Для чего пароль»");
    if (/[\x00-\x1f]/.test(s)) return void (err.textContent = "Недопустимые символы в названии");
    if (!login.value.trim()) return void (err.textContent = "Введите логин");
    if (!pass.value) return void (err.textContent = "Введите пароль");
    let name = s, target = edit?.id;
    const dup = entries.find(e => e.service.toLowerCase() === s.toLowerCase() && e.id !== edit?.id);
    if (dup) {
      const a = await ask(`«${s}» уже существует.`, [{ id: "replace", type: "default", text: "Заменить" }, { id: "copy", type: "default", text: "Сохранить как новую (2)" }, { type: "cancel" }]);
      if (a === "cancel") return;
      if (a === "replace") target = dup.id; else { let n = 2; while (entries.some(e => e.service === `${s} (${n})`)) n++; name = `${s} (${n})`; target = undefined; }
    }
    const id = target ?? crypto.randomUUID();
    const { ciphertext, nonce } = await encrypt(keys!.aes, pad(JSON.stringify({ service: name, login: login.value.trim(), password: pass.value, notes: notes.value.trim() })), `entry:${tgId}:${id}`);
    await (target ? api("PUT", `/api/entries/${id}`, { ciphertext, nonce }) : api("POST", "/api/entries", { id, ciphertext, nonce }));
    await loadEntries(); listScreen();
  };
  show(h("h1", {}, edit ? "Изменить запись" : "Новая запись"),
    h("label", {}, "1. Для чего пароль"), service,
    h("label", {}, "2. Логин"), login, h("div", { class: "row" }, h("button", { onclick: () => { login.value = generateLogin(); } }, "Сгенерировать логин")),
    h("label", {}, "3. Пароль"), pass,
    h("div", { class: "row" }, h("button", { class: "primary", onclick: () => { pwLen = Math.min(32, Math.max(8, Number(len.value) || 8)); pass.value = generatePassword(pwLen); } }, "НАЧАТЬ"),
      h("button", { onclick: () => { pass.type = pass.type === "password" ? "text" : "password"; } }, "Показать/скрыть"), h("button", { onclick: () => copy(pass.value) }, "Копировать")),
    h("label", {}, "Длина пароля (8–32)"), len, h("label", {}, "4. Примечания"), notes,
    h("div", { class: "row" }, h("button", { class: "primary", onclick: save }, "ГОТОВО")), err);
  tgApp.BackButton.show(); tgApp.BackButton.onClick(() => listScreen());
}

function settingsScreen() {
  const len = h("input", { type: "number", min: "8", max: "32", value: String(pwLen) }) as HTMLInputElement;
  const idle = h("select", {}, ...[1, 5, 15].map(m => h("option", { value: String(m) }, `${m} мин`))) as HTMLSelectElement;
  idle.value = String(idleMin);
  const msg = h("div", { class: "muted" });
  const ta = h("textarea", { rows: "4", placeholder: "Вставьте сюда экспорт для импорта" }) as HTMLTextAreaElement;
  const savebtn = h("button", { class: "primary", onclick: () => { pwLen = clampLen(Number(len.value)); idleMin = Number(idle.value); saveSet(); touch(); msg.textContent = "Сохранено"; } }, "Сохранить настройки");
  const exp = async () => {
    try {
      const st = await api("GET", "/api/state", undefined, false);
      const { verifier } = await api("POST", "/api/unlock", {});
      const { entries: rows } = await api("GET", "/api/entries");
      const pack = JSON.stringify({ v: 1, tg: tgId, salt: st.salt, params: st.params, verifier, entries: rows.map((r: any) => ({ id: r.id, ciphertext: r.ciphertext, nonce: r.nonce })) });
      await copy(pack, false); // экспорт НЕ стираем из буфера автоматически
      msg.textContent = `Экспорт (${rows.length} зап.) скопирован. Это шифротекст — сохраните его в надёжное место и очистите буфер.`;
    } catch { msg.textContent = "Ошибка экспорта"; }
  };
  const imp = async () => {
    try {
      const d = JSON.parse(ta.value);
      const st = await api("GET", "/api/state", undefined, false);
      if (d.v !== 1 || d.tg !== tgId || d.salt !== st.salt || !Array.isArray(d.entries)) throw new Error("файл от другого аккаунта или с другим мастер-паролем");
      const have = new Set(entries.map(e => e.id)); let n = 0, skip = 0;
      for (const r of d.entries) {
        if (have.has(r.id)) { skip++; continue; }
        await decrypt(keys!.aes, r.ciphertext, r.nonce, `entry:${tgId}:${r.id}`); // бросит при порче/подмене
        await api("POST", "/api/entries", { id: r.id, ciphertext: r.ciphertext, nonce: r.nonce }); n++;
      }
      await loadEntries(); ta.value = ""; msg.textContent = `Импортировано: ${n}, пропущено (уже есть): ${skip}`;
    } catch (e: any) { msg.textContent = "Ошибка импорта: " + (e.message || "неверный формат"); }
  };
  show(h("h1", {}, "Настройки"),
    h("label", {}, "Длина пароля по умолчанию (8–32)"), len,
    h("label", {}, "Автоблокировка при бездействии"), idle,
    h("div", { class: "row" }, savebtn),
    h("label", {}, "Экспорт (шифротекст)"), h("div", { class: "row" }, h("button", { onclick: exp }, "Скопировать экспорт")),
    h("label", {}, "Импорт"), ta, h("div", { class: "row" }, h("button", { onclick: imp }, "Импортировать")),
    msg, h("p", { class: "muted" }, "Экспорт открывается только в этом же аккаунте Telegram и с тем же мастер-паролем."));
  tgApp.BackButton.show(); tgApp.BackButton.onClick(() => listScreen());
}

start();
