// SPDX-License-Identifier: AGPL-3.0-only
// Display helpers for read-only admin views. Values stay strings until display so that counters
// above 2^53 keep every digit.
import { formatDate, formatNumber } from '$lib/i18n';

const decimal = /^(-?)([0-9]+)(?:\.([0-9]+))?$/;

/** Groups the integer part of a decimal string by locale; anything unexpected is returned as is. */
export function formatDecimal(value: string): string {
  const match = decimal.exec(value);
  if (!match) return value;
  const [, sign, whole, fraction] = match;
  const grouped = formatNumber(BigInt(whole));
  const point = formatNumber(1.1).charAt(1);
  return `${sign}${grouped}${fraction ? point + fraction : ''}`;
}

/** Locale date and time of an ISO timestamp; the raw text when it cannot be parsed. */
export function formatStamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return formatDate(parsed, { dateStyle: 'short', timeStyle: 'medium' });
}
