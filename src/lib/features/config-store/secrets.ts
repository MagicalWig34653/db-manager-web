// SPDX-License-Identifier: AGPL-3.0-only
// Client-side secret detection at the level of the backend rules (internal/configstore/secrets.go, W-P20): the word
// rules of W-P16 plus structural rules (credential URLs, PEM, JWT, bearer/basic, curl -u, key=value pairs, known token
// formats) and opaque 32+ character runs, scanned on the text and on its folded form (NFKC, invisible characters and
// common homoglyphs removed). Conservative on purpose: a false positive costs one entry, a miss would store plaintext.
const WORD_RULES: RegExp[] = [
  /pass(?:word|wd|phrase)/i,
  /\bidentified\b/i,
  /secret|token|credential|api[_-]?key|bearer|private\s+key/i,
  /\bencryption\s+key|\b(?:hex|re)?key\s*(?:=|['"]|\bx')|\bkey\s+['"]|pragma\s+(?:\w+\s*\.\s*)?(?:hex|re)?key\b|cipher_/i,
  /\$[A-Za-z_\u0080-￿]*\$/,
  /\b(?:user\s+mapping|create\s+server|create\s+subscription|dblink_connect\w*)\b/i,
  /\b(?:uid|user\s*id|pwd)\s*=/i,
];
const STRUCTURAL_RULES: RegExp[] = [
  // Lookbehinds keep the scan linear (JS backtracking would be quadratic on long runs, unlike Go's RE2).
  /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^/\s:@]*:[^/\s@]+@/i,
  /(?<![^\s:@/])[^\s:@/]+:[^\s@/]+@(?:tcp|unix|tcp4|tcp6)\(/i,
  /-----BEGIN[ A-Z]*(?:PRIVATE KEY|ENCRYPTED)/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /\bbasic\s+[A-Za-z0-9+/=]{8,}/i,
  /\b(?:curl|wget|http)\b[^\n]*\s(?:-u|--user|--password|--http-password)[ =]\S*:\S+/i,
  /\b(?:pass(?:word|wd|phrase)?|pwd|secret|token)\s*[=:]\s*[^\s,;'"]{2,}/i,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,})/,
];
const LONG_RUN = /[A-Za-z0-9+/=_-]{32,}/g;
const CONFUSABLES: Record<string, string> = Object.fromEntries(
  [
    'аa вb сc ԁd еe ꜰf һh іi јj кk ӏl мm нh оo рp ԛq ѕs тt υu ѵv ԝw хx уy ᴢz',
    'АA ВB СC ЕE НH ІI ЈJ КK МM ОO РP ЅS ТT ХX ΥY ΖZ',
    'ᴘp ᴀa ꜱs ᴡw ᴏo ʀr ᴅd ᴇe ᴋk ᴛt ɴn ɪi ʟl ᴍm ᴄc ᴜu ᴠv ʏy ɢg ʙb',
    'ոn օo սu',
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
    // Both credential-in-URL/DSN rules need an '@'; skipping them otherwise keeps long inputs linear.
    const hasAt = candidate.includes('@');
    if (STRUCTURAL_RULES.some((rule, i) => (i > 1 || hasAt) && rule.test(candidate))) return true;
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
