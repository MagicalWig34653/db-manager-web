// SPDX-License-Identifier: AGPL-3.0-only
// Minimal keyboard shortcut foundation: declarative bindings, one dispatcher.
export interface Shortcut {
  id: string;
  key: string;
  /** Requires Cmd (macOS) or Ctrl. */
  mod?: boolean;
  /** Evaluated at dispatch time; false skips the binding. */
  when?: () => boolean;
  run: (event: KeyboardEvent) => void;
}

export function matches(event: KeyboardEvent, shortcut: Pick<Shortcut, 'key' | 'mod'>): boolean {
  const mod = event.metaKey || event.ctrlKey;
  return event.key === shortcut.key && mod === Boolean(shortcut.mod) && !event.altKey;
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
