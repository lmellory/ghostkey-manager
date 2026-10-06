// Порт генераторов из password_vault.py. Только crypto.getRandomValues.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*?";
const FIRST = ["alex","max","john","mike","anna","kate","nick","sam","leo","dan","ivan","oleg","eva","mia","tom","ben","ron","ian","ella","nina","artem","denis","maria","olga","paul","ruby","adam","luke","sofia","vlad"];
const LAST = ["morgan","smith","brown","wolf","stone","frost","hunt","king","ross","reed","black","white","gray","fox","lane","wood","hill","ford","cole","knight","petrov","ivanov","orlov","volkov","sokol","lee","kane","dean","park","rose"];
const ADJ = ["swift","brave","calm","bright","cool","wild","silent","lucky","sharp","bold","quick","smart","royal","noble","happy","clever","gentle","mighty","fresh","solar"];
const NOUN = ["falcon","tiger","wolf","eagle","raven","panda","fox","otter","comet","pixel","rocket","storm","river","forest","shadow","ranger","pilot","viking","knight","lynx"];

/** Равномерное целое [0, max) без смещения (rejection sampling). */
export function randInt(max: number): number {
  const lim = Math.floor(0x100000000 / max) * max;
  const b = new Uint32Array(1);
  do crypto.getRandomValues(b); while (b[0] >= lim);
  return b[0] % max;
}
const pick = (s: string | string[]): string => s[randInt(s.length)];

export function generatePassword(length = 8): string {
  if (!Number.isInteger(length) || length < 8 || length > 32) throw new RangeError("length 8..32");
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  const pool = UPPER + LOWER + DIGITS + SYMBOLS;
  while (chars.length < length) chars.push(pick(pool));
  for (let i = chars.length - 1; i > 0; i--) { // Fisher–Yates
    const j = randInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export function generateLogin(): string {
  let login = "";
  for (let i = 0; i < 100; i++) {
    const base = randInt(2) ? `${pick(FIRST)}_${pick(LAST)}` : `${pick(ADJ)}_${pick(NOUN)}`;
    login = `${base}${randInt(900) + 10}`;
    if (login.length <= 20) return login;
  }
  return login.slice(0, 20);
}
