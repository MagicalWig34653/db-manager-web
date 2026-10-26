// SPDX-License-Identifier: AGPL-3.0-only
// Minimal keyboard shortcut foundation: declarative bindings, one dispatcher.
export interface Shortcut {
  id: string;
  key: string;
  titleKey?: string;
  scopeKey?: string;
  /** true: requires Cmd (macOS) or Ctrl; false: forbids them; undefined: ignored (e.g. Escape). */
  mod?: boolean;
  /** Evaluated at dispatch time; false skips the binding. */
  when?: () => boolean;
  run: (event: KeyboardEvent) => void;
}

export function matches(event: KeyboardEvent, shortcut: Pick<Shortcut, 'key' | 'mod'>): boolean {
  const mod = event.metaKey || event.ctrlKey;
  if (event.key !== shortcut.key || event.altKey) return false;
  return shortcut.mod === undefined || mod === shortcut.mod;
}

/** Runs the first matching binding and prevents the default action. Returns its id. */
export function dispatch(event: KeyboardEvent, shortcuts: Shortcut[]): string | undefined {
  for (const shortcut of shortcuts) {
    if (matches(event, shortcut) && (shortcut.when?.() ?? true)) {
      event.preventDefault();
      shortcut.run(event);
      return shortcut.id;
    }
  }
  return undefined;
}

/** True while any modal dialog (shell or feature dialog) is in the DOM; shortcuts must not fire then. */
export function anyModalOpen(root: ParentNode = document): boolean {
  return root.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}
