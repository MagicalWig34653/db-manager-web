// SPDX-License-Identifier: AGPL-3.0-only
// Client-side secret detection at the level of the backend rules (internal/configstore/secrets.go, W-P20): the word
// rules of W-P16 plus structural rules (credential URLs, PEM, JWT, bearer/basic, curl -u, key=value pairs, known token
// formats) and opaque 32+ character runs, scanned on the text and on its folded form (NFKC, invisible characters and
// common homoglyphs removed). Conservative on purpose: a false positive costs one entry, a miss would store plaintext.
const WORD_RULES: RegExp[] = [
  /pass(?:word|wd|phrase)/i,
  /\bidentified\b/i,
  /secret|token|credential|api[_-]?key|bearer|private[\t\n\f\r ]+key/i,
  /\bencryption[\t\n\f\r ]+[k\u212a]ey|\b(?:hex|re)?[k\u212a]ey[\t\n\f\r ]*(?:=|['"]|\bx')|\b[k\u212a]ey[\t\n\f\r ]+['"]|pragma[\t\n\f\r ]+(?:\w+[\t\n\f\r ]*\.[\t\n\f\r ]*)?(?:hex|re)?[k\u212a]ey\b|cipher_/i,
  /\$[A-Za-z_\u0080-￿]*\$/,
  /\b(?:user[\t\n\f\r ]+mapping|create[\t\n\f\r ]+server|create[\t\n\f\r ]+subscription|dblink_connect\w*)\b/i,
  /\b(?:uid|user[\t\n\f\r ]*id|pwd)[\t\n\f\r ]*=/i,
];
const WS = '\t\n\f\r ';
const isWs = (c: string) => WS.includes(c);

/** `scheme://user:password@` (linear scan; a regex here backtracks quadratically). */
function credentialUrl(text: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf('://', from);
    if (at < 0) return false;
    from = at + 3;
    let k = at;
    let letter = false;
    while (k > 0 && /[a-z0-9+.-]/i.test(text[k - 1])) {
      k--;
      if (/[a-z]/i.test(text[k])) letter = true;
    }
    if (!letter) continue;
    let i = from;
    while (i < text.length && !'/:@'.includes(text[i]) && !isWs(text[i])) i++;
    if (text[i] !== ':') continue;
    let j = i + 1;
    while (j < text.length && !'/@'.includes(text[j]) && !isWs(text[j])) j++;
    if (j > i + 1 && text[j] === '@') return true;
  }
}

/** `user:password@tcp(` and friends (Go DSN), linear: scan back from each `@proto(`. */
function goDsn(text: string): boolean {
  const lower = text.toLowerCase();
  for (const proto of ['tcp', 'unix', 'tcp4', 'tcp6']) {
    const needle = `@${proto}(`;
    let from = 0;
    for (;;) {
      const at = lower.indexOf(needle, from);
      if (at < 0) break;
      from = at + 1;
      let start = at;
      while (start > 0 && !'@/'.includes(text[start - 1]) && !isWs(text[start - 1])) start--;
      const run = text.slice(start, at);
      for (let k = 1; k < run.length - 1; k++)
        if (run[k] === ':' && run[k - 1] !== ':') return true;
    }
  }
  return false;
}

const STRUCTURAL_RULES: RegExp[] = [
  /-----BEGIN[ A-Z]*(?:PRIVATE KEY|ENCRYPTED)/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/,
  /\bbearer[\t\n\f\r ]+[A-Za-z0-9._~+/=-]{16,}/i,
  /\bbasic[\t\n\f\r ]+[A-Za-z0-9+/=]{8,}/i,
  /\b(?:curl|wget|http)\b[^\n]*[\t\n\f\r ](?:-u|--user|--password|--http-password)[ =][^\t\n\f\r ]*:[^\t\n\f\r ]+/i,
  /\b(?:pass(?:word|wd|phrase)?|pwd|secret|token)[\t\n\f\r ]*[=:][\t\n\f\r ]*[^\t\n\f\r ,;'"]{2,}/i,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,})/,
];
const LONG_RUN = /[A-Za-z0-9+/=_-]{32,}/g;
const CONFUSABLES: Record<string, string> = Object.fromEntries(
  [
    'аa вb сc ԁd еe ꜰf һh іi јj кk ӏl мm нh оo рp ԛq ѕs тt υu ѵv ԝw хx уy ᴢz',
    'АA ВB СC ЕE НH ІI ЈJ КK МM ОO РP ЅS ТT ХX ΥY ΖZ',
    'ᴘp ᴀa ꜱs ᴡw ᴏo ʀr ᴅd ᴇe ᴋk ᴛt ɴn ɪi ʟl ᴍm ᴄc ᴜu ᴠv ʏy ɢg ʙb',
    'ոn օo սu ᴊj ʜh',
    'αa οo ρp νv ιi κk ϲc ΑA ΒB ΕE ΗH ΙI ΚK ΜM ΝN ΟO ΡP ΤT ΧX',
  ]
    .join(' ')
    .split(' ')
    .map((pair) => [...pair] as [string, string]),
);
const mapConfusables = (text: string) => [...text].map((c) => CONFUSABLES[c] ?? c).join('');

/** NFKC, invisible format characters, combining marks and Hangul fillers removed, homoglyphs mapped to ASCII. */
export function fold(text: string): string {
  const normalized = mapConfusables(text).normalize('NFKC');
  const stripped = normalized.replace(/[\p{Cf}\p{Mn}\p{Me}ᅟᅠㅤﾠ]/gu, '');
  return mapConfusables(stripped);
}

function opaqueRun(run: string): boolean {
  let digit = false;
  let upper = false;
  let lower = false;
  let hexOnly = true;
  for (const r of run) {
    if (r >= '0' && r <= '9') digit = true;
    else if (r >= 'A' && r <= 'Z') {
      upper = true;
      if (r > 'F') hexOnly = false;
    } else if (r >= 'a' && r <= 'z') {
      lower = true;
      if (r > 'f') hexOnly = false;
    } else hexOnly = false;
  }
  return (digit && upper && lower) || (hexOnly && digit && (upper || lower) && run.length >= 32);
}

/** True when the text must not be stored (SQL: all rules; names and identifiers can use mode 'text'). */
export function looksSecret(text: string): boolean {
  const folded = fold(text);
  for (const candidate of folded === text ? [text] : [text, folded]) {
    if (WORD_RULES.some((rule) => rule.test(candidate))) return true;
    if (credentialUrl(candidate) || goDsn(candidate)) return true;
    if (STRUCTURAL_RULES.some((rule) => rule.test(candidate))) return true;
    for (const run of candidate.match(LONG_RUN) ?? []) if (opaqueRun(run)) return true;
  }
  return false;
}

/** Every string anywhere inside a JSON-like value. */
export function anySecret(value: unknown): boolean {
  if (typeof value === 'string') return looksSecret(value);
  if (Array.isArray(value)) return value.some(anySecret);
  if (value && typeof value === 'object') return Object.values(value).some(anySecret);
  return false;
}
