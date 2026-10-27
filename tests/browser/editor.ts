// SPDX-License-Identifier: AGPL-3.0-only
import type { Locator } from '@playwright/test';

/** Text of the SQL editor (CodeMirror lines without the placeholder widget, or the textarea fallback). */
export function editorText(editor: Locator): Promise<string> {
  return editor.evaluate((element) => {
    if (element instanceof HTMLTextAreaElement) return element.value;
    return [...element.querySelectorAll('.cm-line')]
      .map((line) => {
        const copy = line.cloneNode(true) as Element;
        copy.querySelectorAll('.cm-placeholder').forEach((node) => node.remove());
        return copy.textContent ?? '';
      })
      .join('\n');
  });
}
