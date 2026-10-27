// SPDX-License-Identifier: AGPL-3.0-only
// Characters that can make SQL read differently from what it does (Trojan Source and look-alike invisibles):
// controls (Cc, except tab/newline/carriage return), format characters incl. bidi and zero-width (Cf),
// space separators other than the plain space (Zs, e.g. NBSP, ideographic space), Default_Ignorable_Code_Point
// (Hangul fillers, variation selectors, tag characters U+E0000..U+E0FFF) and the empty Braille pattern.
export const HIDDEN_CHARACTERS =
  /(?![ \t\n\r])[\p{Cc}\p{Cf}\p{Zs}\p{Default_Ignorable_Code_Point}⠀]/u;
