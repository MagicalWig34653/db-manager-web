// SPDX-License-Identifier: AGPL-3.0-only
// CodeMirror 6 setup for the SQL editor. This module is only ever loaded through a dynamic import, so the
// whole editor (about a few hundred KiB) lives in its own chunk and the shell starts without it.
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightSpecialChars,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
  type KeyBinding,
} from '@codemirror/view';
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  isolateHistory,
  indentMore,
} from '@codemirror/commands';
import {
  closeBrackets,
  closeBracketsKeymap,
  autocompletion,
  completionKeymap,
} from '@codemirror/autocomplete';
import {
  closeSearchPanel,
  highlightSelectionMatches,
  openSearchPanel,
  searchPanelOpen,
  search,
  searchKeymap,
} from '@codemirror/search';
import { sql, MariaSQL, PostgreSQL, SQLite, type SQLDialect } from '@codemirror/lang-sql';
import { tags } from '@lezer/highlight';
import type { Driver } from '$lib/workbench';
import type { SchemaTree } from './catalog-hints.svelte';
import { tokenize } from './lexer';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';

export const MAX_DOCUMENT = 1_000_000;
export type ColumnIndex = Record<string, string[]>;

const NOT_ALIAS = new Set([
  'where',
  'join',
  'inner',
  'left',
  'right',
  'full',
  'cross',
  'natural',
  'on',
  'using',
  'group',
  'order',
  'limit',
  'offset',
  'having',
  'union',
  'intersect',
  'except',
  'set',
  'values',
  'select',
  'returning',
  'window',
  'for',
  'fetch',
  'with',
  'if',
  'not',
  'exists',
]);
const TABLE_WORDS = new Set(['from', 'join', 'update', 'into', 'table']);
/** Names of tables that the statement mentions after FROM/JOIN/UPDATE/INTO (unqualified, lower case). */
export function mentionedTables(doc: string, driver: Driver): string[] {
  const tokens = tokenize(doc, driver)?.filter((token) => token.kind !== 'space');
  if (!tokens) return [];
  const names: string[] = [];
  tokens.forEach((token, index) => {
    if (token.kind !== 'word' || !TABLE_WORDS.has(token.text.toLowerCase())) return;
    let at = index + 1;
    // Accept "schema.table" and quoted names; list members after commas follow the same rule.
    for (let guard = 0; guard < 16 && at < tokens.length; guard++) {
      let name = tokens[at];
      while (tokens[at + 1]?.text === '.' && tokens[at + 2]) {
        at += 2;
        name = tokens[at];
      }
      if (name.kind !== 'word' && name.kind !== 'quoted-identifier') break;
      names.push(name.text.replace(/^["`\[]|["`\]]$/g, '').toLowerCase());
      // Skip an alias, then continue only after a comma.
      at++;
      if (tokens[at]?.text.toLowerCase() === 'as') at++;
      if (tokens[at]?.kind === 'word' && !NOT_ALIAS.has(tokens[at].text.toLowerCase())) at++;
      if (tokens[at]?.text !== ',') break;
      at++;
    }
  });
  return names;
}

function columnSource(getDriver: () => Driver, getIndex: () => ColumnIndex) {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[A-Za-z0-9_$\u0080-\uffff]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    // After a dot lang-sql completes the members of that table; do not mix in unrelated columns.
    if (word.from > 0 && context.state.sliceDoc(word.from - 1, word.from) === '.') return null;
    const index = getIndex();
    const seen = new Set<string>();
    const options: { label: string; type: string; detail: string }[] = [];
    for (const table of mentionedTables(context.state.doc.toString(), getDriver()))
      for (const column of index[table] ?? [])
        if (!seen.has(column)) {
          seen.add(column);
          options.push({ label: column, type: 'property', detail: table });
        }
    return options.length ? { from: word.from, options, validFor: /^[A-Za-z0-9_$]*$/ } : null;
  };
}

export interface Texts {
  label: string;
  /** Id of the key hint paragraph that lives inside the editor's shadow root. */
  describedBy: string;
  hint: string;
  placeholder: string;
  /** CodeMirror UI phrases (search panel, completion messages) keyed by their English source text. */
  phrases: Record<string, string>;
}
export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  driver: Driver;
  schema: SchemaTree;
  columns: ColumnIndex;
  texts: Texts;
  readOnly: boolean;
  onChange: (doc: string) => void;
  onTabMode: (focusMode: boolean) => void;
}
export interface EditorHandle {
  setDoc: (doc: string) => void;
  replaceDoc: (doc: string) => void;
  getDoc: () => string;
  setLanguage: (driver: Driver, schema: SchemaTree, columns: ColumnIndex) => void;
  setTexts: (texts: Texts) => void;
  setReadOnly: (readOnly: boolean) => void;
  focus: () => void;
  openSearch: () => void;
  destroy: () => void;
}

export function dialectFor(driver: Driver): SQLDialect {
  // The backend driver "mysql" covers MySQL and MariaDB; the MariaDB dialect is a superset for highlighting.
  if (driver === 'mysql') return MariaSQL;
  return driver === 'postgresql' ? PostgreSQL : SQLite;
}

// Colors come from CSS variables (src/app.css) so light, dark and contrast stay defined in one place.
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: 'var(--sql-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--sql-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--sql-number)' },
  { tag: [tags.lineComment, tags.blockComment], color: 'var(--sql-comment)', fontStyle: 'italic' },
  { tag: [tags.typeName, tags.standard(tags.typeName)], color: 'var(--sql-type)' },
  {
    tag: [tags.function(tags.variableName), tags.standard(tags.name)],
    color: 'var(--sql-function)',
  },
  { tag: [tags.operator, tags.punctuation], color: 'var(--sql-operator)' },
]);

const theme = EditorView.theme({
  '&': {
    flex: '1 1 auto',
    minWidth: '0',
    color: 'var(--foreground)',
    backgroundColor: 'transparent',
    fontSize: '12px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
    lineHeight: '21px',
    overflow: 'auto',
  },
  '.cm-content': { padding: '20px 0', caretColor: 'var(--foreground)' },
  '.cm-line': { padding: '0 18px 0 12px' },
  '.cm-gutters': {
    backgroundColor: 'var(--surface)',
    color: 'var(--muted-foreground)',
    borderRight: '1px solid var(--border)',
    fontSize: '11px',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 18px', minWidth: '47px' },
  '.cm-activeLine': { backgroundColor: 'var(--editor-active-line)' },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--editor-active-line)',
    color: 'var(--foreground)',
  },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    { backgroundColor: 'var(--editor-selection)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--editor-match)' },
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--editor-match)',
    outline: '1px solid var(--border)',
  },
  '&.cm-focused .cm-nonmatchingBracket': {
    backgroundColor: 'transparent',
    outline: '2px solid var(--destructive)',
  },
  '.cm-placeholder': { color: 'var(--muted-foreground)', fontStyle: 'italic' },
  '.cm-panels': {
    backgroundColor: 'var(--surface)',
    color: 'var(--foreground)',
    borderColor: 'var(--border)',
    fontSize: '12px',
  },
  '.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panel.cm-search': { padding: '8px 34px 8px 12px' },
  '.cm-panel.cm-search label': { color: 'var(--foreground)' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': {
    color: 'var(--foreground)',
    backgroundColor: 'var(--background)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    backgroundImage: 'none',
    minHeight: '28px',
  },
  '.cm-panel.cm-search input[type=checkbox]': { minHeight: 'auto' },
  '.cm-panel.cm-search [name=close]': {
    color: 'var(--foreground)',
    border: '0',
    backgroundColor: 'transparent',
    fontSize: '18px',
  },
  '.cm-searchMatch': { backgroundColor: 'var(--editor-match)', outline: '1px solid var(--border)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--editor-selection)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--surface)',
    color: 'var(--foreground)',
    border: '1px solid var(--border)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    // No scroll container without focusable content (axe scrollable-region-focusable); the keyboard scrolls it.
    overflow: 'hidden',
    fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
    maxWidth: 'min(420px, 90vw)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--primary)',
    color: 'var(--on-primary)',
  },
  '.cm-specialChar': { color: 'var(--destructive)', outline: '1px solid var(--destructive)' },
  '.cm-completionDetail': { color: 'inherit', opacity: '0.85' },
});

function insertIndent(view: EditorView): boolean {
  view.dispatch(view.state.replaceSelection(view.state.facet(indentUnit)), {
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
}

/** Tab inserts indentation; after Escape the next Tab leaves the editor (WCAG 2.1.2, no keyboard trap). */
function tabBindings(
  state: { focusMode: boolean },
  notify: (focusMode: boolean) => void,
): KeyBinding[] {
  const set = (value: boolean) => {
    if (state.focusMode !== value) {
      state.focusMode = value;
      notify(value);
    }
  };
  return [
    {
      key: 'Escape',
      run: (view) => {
        if (searchPanelOpen(view.state)) return closeSearchPanel(view);
        set(true);
        return true;
      },
    },
    {
      key: 'Ctrl-m',
      run: () => {
        set(!state.focusMode);
        return true;
      },
    },
    {
      key: 'Tab',
      run: (view) => {
        if (state.focusMode) return false;
        return view.state.selection.ranges.some((range) => !range.empty)
          ? indentMore(view)
          : insertIndent(view);
      },
      shift: (view) => (state.focusMode ? false : indentLess(view)),
    },
  ];
}

export function createEditor(options: EditorOptions): EditorHandle {
  const language = new Compartment();
  const texts = new Compartment();
  const editable = new Compartment();
  const tabState = { focusMode: false };

  let currentDriver = options.driver;
  let currentColumns = options.columns;
  // One stable source object: a new one per call would restart the active completion on every keystroke.
  const columns = {
    autocomplete: columnSource(
      () => currentDriver,
      () => currentColumns,
    ),
  };
  const languageExtension = (driver: Driver, schema: SchemaTree): Extension => [
    sql({ dialect: dialectFor(driver), schema, upperCaseKeywords: true }),
    EditorState.languageData.of(() => [columns]),
  ];
  const textExtension = (value: Texts): Extension => [
    EditorState.phrases.of(value.phrases),
    EditorView.contentAttributes.of({
      id: 'sql-editor',
      'aria-label': value.label,
      'aria-describedby': value.describedBy,
      tabindex: '0',
      spellcheck: 'false',
      autocapitalize: 'off',
      autocorrect: 'off',
    }),
    placeholder(value.placeholder),
  ];
  const editableExtension = (readOnly: boolean): Extension => [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
  ];

  // Ctrl/Cmd+Enter belongs to the shell (run query); Ctrl+K belongs to the shell as well (focus editor).
  const reserved = new Set(['Mod-Enter', 'Ctrl-k', 'Mod-k']);
  const commandKeys = defaultKeymap.filter(
    (binding) =>
      ![binding.key, binding.mac, binding.win, binding.linux].some(
        (key) => key !== undefined && reserved.has(key),
      ),
  );

  // CodeMirror injects its style rules as a <style> element when it mounts into the document, which the
  // production CSP (style-src 'self') blocks. Inside a shadow root it uses a constructed stylesheet instead,
  // which the CSP allows. CSS variables of the app theme still inherit into the shadow tree.
  const shadow = options.parent.attachShadow({ mode: 'open' });
  const hintSheet = new CSSStyleSheet();
  hintSheet.replaceSync(
    ':host{display:flex;flex-direction:column;flex:1;min-width:0}' +
      '.cm-editor{min-width:0;min-height:var(--editor-min,235px);max-height:400px}' +
      '.hint{margin:0;padding:6px 18px;font:11px system-ui,sans-serif;color:var(--muted-foreground);' +
      'background:var(--surface);border-top:1px solid var(--border)}',
  );
  shadow.adoptedStyleSheets = [hintSheet];
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.id = options.texts.describedBy;
  hint.textContent = options.texts.hint;
  const view = new EditorView({
    parent: shadow,
    root: shadow,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        // Marks control, zero-width and bidi characters visibly (Trojan Source).
        highlightSpecialChars({
          addSpecialChars: /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/,
        }),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion({ icons: false }),
        highlightSelectionMatches(),
        search({ top: true }),
        syntaxHighlighting(highlight),
        theme,
        Prec.high(keymap.of(tabBindings(tabState, options.onTabMode))),
        keymap.of([
          ...closeBracketsKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...commandKeys,
        ]),
        EditorState.transactionFilter.of((transaction) =>
          transaction.newDoc.length > MAX_DOCUMENT ? [] : transaction,
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange(update.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          keydown: (event) => {
            if (!['Tab', 'Escape', 'Shift', 'Control', 'Meta', 'Alt'].includes(event.key)) {
              if (tabState.focusMode) {
                tabState.focusMode = false;
                options.onTabMode(false);
              }
            }
            return false;
          },
          blur: () => {
            if (tabState.focusMode) {
              tabState.focusMode = false;
              options.onTabMode(false);
            }
            return false;
          },
        }),
        language.of(languageExtension(options.driver, options.schema)),
        texts.of(textExtension(options.texts)),
        editable.of(editableExtension(options.readOnly)),
      ],
    }),
  });

  shadow.append(hint);
  const replace = (doc: string) => {
    if (doc === view.state.doc.toString()) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: doc },
      selection: { anchor: Math.min(view.state.selection.main.anchor, doc.length) },
      // Own undo step, so one Ctrl+Z restores the text from before the replacement.
      annotations: isolateHistory.of('full'),
      userEvent: 'input.replace',
    });
  };
  return {
    // External replacement (restore, reset): not part of the undo history of typing.
    setDoc: replace,
    replaceDoc: replace,
    getDoc: () => view.state.doc.toString(),
    setLanguage: (driver, schema, columns) => {
      currentDriver = driver;
      currentColumns = columns;
      view.dispatch({ effects: language.reconfigure(languageExtension(driver, schema)) });
    },
    setTexts: (value) => {
      hint.textContent = value.hint;
      view.dispatch({ effects: texts.reconfigure(textExtension(value)) });
    },
    setReadOnly: (readOnly) =>
      view.dispatch({ effects: editable.reconfigure(editableExtension(readOnly)) }),
    focus: () => view.focus(),
    openSearch: () => {
      view.focus();
      openSearchPanel(view);
    },
    destroy: () => view.destroy(),
  };
}
