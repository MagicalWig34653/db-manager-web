// SPDX-License-Identifier: AGPL-3.0-only
import { t } from '$lib/i18n';
export function reasonText(code: string) {
  return code
    ? t(`maintenance.reasons.${code}`) === `maintenance.reasons.${code}`
      ? t('maintenance.failed', { code })
      : t(`maintenance.reasons.${code}`)
    : '';
}
