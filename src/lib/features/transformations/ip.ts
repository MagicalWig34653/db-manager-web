// SPDX-License-Identifier: AGPL-3.0-only
// IP address helpers for display (W-P22): text <-> bytes, canonical text (RFC 5952 for IPv6). Pure and total: a value
// that is not an address yields null, never an exception.

const V4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function parseIpv4(text: string): Uint8Array | null {
  if (!V4.test(text)) return null;
  return Uint8Array.from(text.split('.'), Number);
}

export function parseIp(text: string): Uint8Array | null {
  const v4 = parseIpv4(text);
  if (v4) return v4;
  if (text.length > 45 || !/^[0-9a-fA-F:.]+$/.test(text) || !text.includes(':')) return null;
  let head = text;
  let tail4: Uint8Array | null = null;
  const lastColon = text.lastIndexOf(':');
  if (text.includes('.')) {
    tail4 = parseIpv4(text.slice(lastColon + 1));
    if (!tail4) return null;
    head = text.slice(0, lastColon + 1) + '0:0'; // placeholder for the two groups the dotted tail provides
  }
  const doubles = head.split('::');
  if (doubles.length > 2) return null;
  const groups = (part: string) => (part === '' ? [] : part.split(':'));
  const left = groups(doubles[0]);
  const right = doubles.length === 2 ? groups(doubles[1]) : [];
  const total = left.length + right.length;
  if (doubles.length === 1 ? total !== 8 : total > 7) return null;
  const all = [...left, ...Array<string>(8 - total).fill('0'), ...right];
  if (doubles.length === 1 && all.length !== 8) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const g = all[i];
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    out[i * 2] = n >> 8;
    out[i * 2 + 1] = n & 255;
  }
  if (tail4) out.set(tail4, 12);
  return out;
}

export function formatIp(bytes: Uint8Array): string | null {
  if (bytes.length === 4) return Array.from(bytes).join('.');
  if (bytes.length !== 16) return null;
  const words: number[] = [];
  for (let i = 0; i < 16; i += 2) words.push((bytes[i] << 8) | bytes[i + 1]);
  // v4-mapped (::ffff:a.b.c.d)
  if (words.slice(0, 5).every((w) => w === 0) && words[5] === 0xffff)
    return '::ffff:' + Array.from(bytes.slice(12)).join('.');
  // longest run of zero words (at least two) is compressed
  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < 8;) {
    if (words[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && words[j] === 0) j++;
    if (j - i > bestLength) ((bestStart = i), (bestLength = j - i));
    i = j;
  }
  if (bestLength < 2) return words.map((w) => w.toString(16)).join(':');
  const left = words.slice(0, bestStart).map((w) => w.toString(16));
  const right = words.slice(bestStart + bestLength).map((w) => w.toString(16));
  return left.join(':') + '::' + right.join(':');
}

export const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function ipv4ToLong(text: string): number | null {
  const bytes = parseIpv4(text);
  return bytes ? ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0 : null;
}
export function longToIpv4(value: number): string | null {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return null;
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}
