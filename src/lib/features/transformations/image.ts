// SPDX-License-Identifier: AGPL-3.0-only
// Recognizes the few raster image formats shown by the image transformation (W-P22). The type comes from the magic
// bytes of the BLOB, never from a column name or a user-supplied MIME type. SVG and everything else is refused: SVG can
// carry script and external references. Pixel dimensions are read from the header before any decoder runs, so a tiny
// file that claims a huge canvas is not decoded.

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
export const IMAGE_MIMES: readonly ImageMime[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];
export const IMAGE_LIMITS = {
  /** Default and hard upper limit of the encoded size. */
  defaultBytes: 512 * 1024,
  maxBytes: 2 * 1024 * 1024,
  /** Largest accepted decoded size in pixels (width x height). */
  maxPixels: 16_000_000,
  maxSide: 16_384,
} as const;

export interface ImageInfo {
  mime: ImageMime;
  width: number;
  height: number;
}

const ascii = (bytes: Uint8Array, at: number, text: string) =>
  text.length + at <= bytes.length && [...text].every((c, i) => bytes[at + i] === c.charCodeAt(0));
const be16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const be32 = (b: Uint8Array, at: number) =>
  ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const le16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);

function jpegSize(bytes: Uint8Array): [number, number] | null {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const length = be16(bytes, i + 2);
    if (length < 2) return null;
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return [be16(bytes, i + 7), be16(bytes, i + 5)];
    i += 2 + length;
  }
  return null;
}

function webpSize(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 30) return null;
  if (ascii(bytes, 12, 'VP8X'))
    return [
      1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
      1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)),
    ];
  if (ascii(bytes, 12, 'VP8L') && bytes[20] === 0x2f) {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return [1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)];
  }
  if (ascii(bytes, 12, 'VP8 ') && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a)
    return [le16(bytes, 26) & 0x3fff, le16(bytes, 28) & 0x3fff];
  return null;
}

/** Returns the image type and size, or null when the bytes are not an allowed raster image of acceptable size. */
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  let mime: ImageMime;
  let size: [number, number] | null;
  if (
    bytes.length >= 24 &&
    ascii(bytes, 1, 'PNG') &&
    bytes[0] === 0x89 &&
    ascii(bytes, 12, 'IHDR')
  ) {
    mime = 'image/png';
    size = [be32(bytes, 16), be32(bytes, 20)];
  } else if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    mime = 'image/jpeg';
    size = jpegSize(bytes);
  } else if (bytes.length >= 10 && (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a'))) {
    mime = 'image/gif';
    size = [le16(bytes, 6), le16(bytes, 8)];
  } else if (bytes.length >= 30 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) {
    mime = 'image/webp';
    size = webpSize(bytes);
  } else return null;
  if (!size) return null;
  const [width, height] = size;
  if (
    width < 1 ||
    height < 1 ||
    width > IMAGE_LIMITS.maxSide ||
    height > IMAGE_LIMITS.maxSide ||
    width * height > IMAGE_LIMITS.maxPixels
  )
    return null;
  return { mime, width, height };
}

/** Strict standard-alphabet base64 (as sent for binary cells). Returns null for anything else. */
export function decodeBase64(text: string, maxBytes: number): Uint8Array | null {
  if (text.length > Math.ceil((maxBytes * 4) / 3) + 4) return null;
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  try {
    const raw = atob(text);
    if (raw.length > maxBytes) return null;
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
