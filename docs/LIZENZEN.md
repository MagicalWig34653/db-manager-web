# Lizenzen und Abhängigkeiten

Stand: 20.10.2026, Ticket F1. Eigener Projektcode: **AGPL-3.0-only**, vollständiger
Text in [LICENSE](../LICENSE). Keine zusätzliche Ausnahme. Fremdcode behält seine
Lizenz; insbesondere bleiben kopierte shadcn-svelte-Komponenten MIT-lizenziert.

## Framework- und Komponentenherkunft

Offizielle Primärquellen am 20.10.2026 gelesen:
[Svelte-Dokumentation](https://svelte.dev/docs/svelte/overview),
[shadcn-svelte mit Vite](https://www.shadcn-svelte.com/docs/installation/vite),
[Button-Komponente](https://www.shadcn-svelte.com/docs/components/button),
[Vite](https://vite.dev/guide/). Das Projekt verwendet Svelte 5, Vite und Tailwind 4.
Die Registry-Komponenten Button, Badge, Input, Textarea und Dialog wurden mit
`shadcn-svelte@1.7.0` im Stil Nova übernommen, nicht als eigener AGPL-Code umdeklariert.
Der Dialog-Schließen-Text wurde ins Deutsche übersetzt. Der vollständige MIT-Hinweis
mit Copyright von Hunter Johnston, CokaKoala und shadcn steht in
[THIRD-PARTY-NOTICES](../src/third-party-notices.txt).

Alle direkten Abhängigkeiten sind exakt gepinnt; `package-lock.json` enthält den
gesamten aufgelösten Baum, Integritätswerte und Registryherkunft. TypeScript 5.9.3
wurde wegen der deklarierten Peer-Bereiche von openapi-typescript und svelte-check
gewählt; die inkompatiblen Kombinationen mit TypeScript 7 beziehungsweise 6 wurden
nicht durch erzwungene Installation übergangen.

Der Build legt `LICENSE.txt` und `THIRD-PARTY-NOTICES.txt` neben die statischen
Artefakte. Notices erhalten die im Paket enthaltenen Lizenz-/Copyrighttexte sämtlicher als
nicht ausschließlich Entwicklung markierter, installierter Pakete (konservativer
Umfang, einschließlich Compilerteile); Lucides zusätzlicher Feather-MIT-Hinweis ist
enthalten. `is-reference` und `locate-character` liefern nur eine MIT-Erklärung
im README statt einer separaten Lizenzdatei; diese Erklärung und die Autorherkunft
sind erhalten. Ihre Compilerquellen werden nicht im Browserbundle ausgeliefert. Die Quellen von Abhängigkeiten werden nicht als eigener Projektcode
geändert. Registry-Komponentencopies sind im Quellrepository vorhanden.

## Vollständiges Lockfileinventar

Die folgende Tabelle enthält auch transitive und plattformspezifische optionale
Pakete. „Laufzeit/Bündel“ bezeichnet die konservative Lockfileklassifizierung und
ist keine Behauptung, dass jede Datei im Browserbundle landet. MPL-2.0-Pakete sind
Buildwerkzeuge/native Parser-Bindings; sie werden nicht als AGPL-Dateien umgeschrieben.
`svelte-toolbelt@0.10.6` fehlt im Registry-Lizenzfeld; die enthaltene Datei `LICENSE`
weist MIT aus und ist in den Notices erhalten. Namen/Versionen und Quellen können
gegen `package-lock.json` nachvollzogen werden. Releaseprüfung muss dieses Inventar
bei jeder Abhängigkeitsänderung erneuern; hieraus folgt keine pauschale Rechtsfreigabe
für andere Vertriebswege oder künftige Abhängigkeiten.

| Paket | Version | Lizenz | Verwendung |
| --- | --- | --- | --- |
| `@adobe/css-tools` | `4.5.0` | MIT | Entwicklung |
| `@asamuzakjp/css-color` | `7.1.7` | MIT | Entwicklung |
| `@asamuzakjp/dom-selector` | `10.0.4` | MIT | Entwicklung |
| `@babel/code-frame` | `7.29.7` | MIT | Entwicklung |
| `@babel/helper-validator-identifier` | `7.29.7` | MIT | Entwicklung |
| `@babel/runtime` | `7.29.10` | MIT | Entwicklung |
| `@bramus/specificity` | `2.4.3` | MIT | Entwicklung |
| `@codemirror/autocomplete` | `6.20.4` | MIT | Laufzeit/Bündel |
| `@codemirror/commands` | `6.11.1` | MIT | Laufzeit/Bündel |
| `@codemirror/lang-sql` | `6.10.0` | MIT | Laufzeit/Bündel |
| `@codemirror/language` | `6.13.1` | MIT | Laufzeit/Bündel |
| `@codemirror/search` | `6.7.2` | MIT | Laufzeit/Bündel |
| `@codemirror/state` | `6.7.6` | MIT | Laufzeit/Bündel |
| `@codemirror/streamparser` | `6.0.0` | MIT | Laufzeit/Bündel |
| `@codemirror/view` | `6.43.15` | MIT | Laufzeit/Bündel |
| `@csstools/color-helpers` | `6.1.2` | MIT-0 | Entwicklung |
| `@csstools/css-calc` | `3.4.3` | MIT | Entwicklung |
| `@csstools/css-color-parser` | `4.2.6` | MIT | Entwicklung |
| `@csstools/css-parser-algorithms` | `4.0.2` | MIT | Entwicklung |
| `@csstools/css-syntax-patches-for-csstree` | `1.1.15` | MIT-0 | Entwicklung |
| `@csstools/css-tokenizer` | `4.0.2` | MIT | Entwicklung |
| `@exodus/bytes` | `1.16.0` | MIT | Entwicklung |
| `@floating-ui/core` | `1.8.0` | MIT | Laufzeit/Bündel |
| `@floating-ui/dom` | `1.8.0` | MIT | Laufzeit/Bündel |
| `@floating-ui/utils` | `0.2.12` | MIT | Laufzeit/Bündel |
| `@internationalized/date` | `3.12.4` | Apache-2.0 | Laufzeit/Bündel |
| `@jridgewell/gen-mapping` | `0.3.13` | MIT | Laufzeit/Bündel |
| `@jridgewell/remapping` | `2.3.5` | MIT | Laufzeit/Bündel |
| `@jridgewell/resolve-uri` | `3.1.2` | MIT | Laufzeit/Bündel |
| `@jridgewell/sourcemap-codec` | `1.6.0` | MIT | Laufzeit/Bündel |
| `@jridgewell/trace-mapping` | `0.3.31` | MIT | Laufzeit/Bündel |
| `@lezer/common` | `1.5.4` | MIT | Laufzeit/Bündel |
| `@lezer/highlight` | `1.2.5` | MIT | Laufzeit/Bündel |
| `@lezer/lr` | `1.4.11` | MIT | Laufzeit/Bündel |
| `@lucide/svelte` | `1.60.0` | ISC | Laufzeit/Bündel |
| `@marijn/find-cluster-break` | `1.0.4` | MIT | Laufzeit/Bündel |
| `@oxc-project/types` | `0.154.0` | MIT | Entwicklung |
| `@playwright/test` | `1.64.1` | Apache-2.0 | Entwicklung |
| `@redocly/ajv` | `8.11.2` | MIT | Entwicklung |
| `@redocly/config` | `0.22.0` | MIT | Entwicklung |
| `@redocly/openapi-core` | `1.34.21` | MIT | Entwicklung |
| `@rolldown/binding-android-arm-eabi` | `1.2.14` | MIT | Entwicklung |
| `@rolldown/binding-android-arm64` | `1.2.14` | MIT | Entwicklung |
| `@rolldown/binding-darwin-arm64` | `1.2.14` | MIT | Entwicklung |
| `@rolldown/binding-darwin-x64` | `1.2.14` | MIT | Entwicklung |
| `@rolldown/binding-freebsd-x64` | `1.2.14` | MIT | Entwicklung |
| `@rolldown/binding-linux-arm-gnueabihf` | `1.2.14` | MIT | Entwicklung |
| `@rolldown/binding-linux-arm64-gnu` | `1.2.14` | MIT | Entwicklung |
| `@rolldown/binding-linux-arm64-musl` | `1.2.14` | MIT | Entwicklung |
| `@rolldown/binding-linux-ppc64-gnu` | `1.2.14` | MIT | Entwicklung |
| `@rolldown/binding-linux-s390x-gnu` | `1.2.14` | MIT | Entwicklung |
| `@rolldown/binding-linux-x64-gnu` | `1.2.14` | MIT | Entwicklung |
| `@rolldown/binding-linux-x64-musl` | `1.2.14` | MIT | Entwicklung |
| `@rolldown/binding-openharmony-arm64` | `1.2.14` | MIT | Entwicklung |
| `@rolldown/binding-win32-arm64-msvc` | `1.2.14` | MIT | Entwicklung |
| `@rolldown/binding-win32-x64-msvc` | `1.2.14` | MIT | Entwicklung |
| `@rolldown/pluginutils` | `1.0.1` | MIT | Entwicklung |
| `@sveltejs/acorn-typescript` | `1.0.13` | MIT | Laufzeit/Bündel |
| `@sveltejs/load-config` | `0.2.3` | MIT | Entwicklung |
| `@sveltejs/vite-plugin-svelte` | `7.3.1` | MIT | Entwicklung |
| `crelt` | `1.0.7` | MIT | Laufzeit/Bündel |
| `magic-string` | `1.4.3` | MIT | Entwicklung |
| `@swc/helpers` | `0.5.23` | Apache-2.0 | Laufzeit/Bündel |
| `@tailwindcss/node` | `4.3.3` | MIT | Entwicklung |
| `@tailwindcss/oxide` | `4.3.3` | MIT | Entwicklung |
| `@tailwindcss/oxide-android-arm64` | `4.3.3` | MIT | Entwicklung |
| `@tailwindcss/oxide-darwin-arm64` | `4.3.3` | MIT | Entwicklung |
| `@tailwindcss/oxide-darwin-x64` | `4.3.3` | MIT | Entwicklung |
| `@tailwindcss/oxide-freebsd-x64` | `4.3.3` | MIT | Entwicklung |
| `@tailwindcss/oxide-linux-arm-gnueabihf` | `4.3.3` | MIT | Entwicklung |
| `@tailwindcss/oxide-linux-arm64-gnu` | `4.3.3` | MIT | Entwicklung |
| `@tailwindcss/oxide-linux-arm64-musl` | `4.3.3` | MIT | Entwicklung |
| `@tailwindcss/oxide-linux-x64-gnu` | `4.3.3` | MIT | Entwicklung |
| `@tailwindcss/oxide-linux-x64-musl` | `4.3.3` | MIT | Entwicklung |
| `@tailwindcss/oxide-wasm32-wasi` | `4.3.3` | MIT | Entwicklung |
| `@tailwindcss/oxide-win32-arm64-msvc` | `4.3.3` | MIT | Entwicklung |
| `@tailwindcss/oxide-win32-x64-msvc` | `4.3.3` | MIT | Entwicklung |
| `@tailwindcss/vite` | `4.3.3` | MIT | Entwicklung |
| `@testing-library/dom` | `10.4.2` | MIT | Entwicklung |
| `aria-query` | `5.3.0` | Apache-2.0 | Entwicklung |
| `@testing-library/jest-dom` | `7.0.1` | MIT | Entwicklung |
| `dom-accessibility-api` | `0.6.3` | MIT | Entwicklung |
| `@testing-library/svelte` | `5.4.2` | MIT | Entwicklung |
| `@testing-library/svelte-core` | `1.1.3` | MIT | Entwicklung |
| `@types/aria-query` | `5.0.4` | MIT | Entwicklung |
| `@types/chai` | `5.2.3` | MIT | Entwicklung |
| `@types/deep-eql` | `4.0.2` | MIT | Entwicklung |
| `@types/estree` | `1.0.9` | MIT | Laufzeit/Bündel |
| `@types/node` | `26.6.5` | MIT | Entwicklung |
| `@vitest/mocker` | `5.0.5` | MIT | Entwicklung |
| `magic-string` | `1.4.3` | MIT | Entwicklung |
| `@vitest/spy` | `5.0.5` | MIT | Entwicklung |
| `acorn` | `8.19.0` | MIT | Laufzeit/Bündel |
| `agent-base` | `7.1.4` | MIT | Entwicklung |
| `ajv` | `8.20.0` | MIT | Laufzeit/Bündel |
| `ansi-colors` | `4.1.3` | MIT | Entwicklung |
| `ansi-regex` | `5.0.1` | MIT | Entwicklung |
| `ansi-styles` | `5.2.0` | MIT | Entwicklung |
| `argparse` | `2.0.1` | Python-2.0 | Entwicklung |
| `aria-query` | `5.3.1` | Apache-2.0 | Laufzeit/Bündel |
| `assertion-error` | `2.0.1` | MIT | Entwicklung |
| `axobject-query` | `4.1.0` | Apache-2.0 | Laufzeit/Bündel |
| `balanced-match` | `1.0.2` | MIT | Entwicklung |
| `bidi-js` | `1.1.0` | MIT | Entwicklung |
| `bits-ui` | `2.20.0` | MIT | Laufzeit/Bündel |
| `brace-expansion` | `2.1.7` | MIT | Entwicklung |
| `chai` | `6.3.0` | MIT | Entwicklung |
| `change-case` | `5.4.4` | MIT | Entwicklung |
| `chokidar` | `4.0.3` | MIT | Entwicklung |
| `clsx` | `2.1.1` | MIT | Laufzeit/Bündel |
| `colorette` | `1.4.0` | MIT | Entwicklung |
| `css-tree` | `3.2.1` | MIT | Entwicklung |
| `css.escape` | `1.5.1` | MIT | Entwicklung |
| `data-urls` | `8.0.0` | MIT | Entwicklung |
| `debug` | `4.4.3` | MIT | Entwicklung |
| `decimal.js` | `10.6.0` | MIT | Entwicklung |
| `deepmerge` | `4.3.1` | MIT | Entwicklung |
| `dequal` | `2.0.3` | MIT | Laufzeit/Bündel |
| `detect-libc` | `2.1.2` | Apache-2.0 | Entwicklung |
| `devalue` | `5.9.4` | MIT | Laufzeit/Bündel |
| `dom-accessibility-api` | `0.5.16` | MIT | Entwicklung |
| `enhanced-resolve` | `5.26.0` | MIT | Entwicklung |
| `entities` | `8.1.0` | BSD-2-Clause | Entwicklung |
| `es-module-lexer` | `2.3.2` | MIT | Entwicklung |
| `esm-env` | `1.2.2` | MIT | Laufzeit/Bündel |
| `esrap` | `2.4.0` | MIT | Laufzeit/Bündel |
| `estree-walker` | `3.0.3` | MIT | Entwicklung |
| `expect-type` | `1.4.0` | Apache-2.0 | Entwicklung |
| `fast-deep-equal` | `3.1.3` | MIT | Laufzeit/Bündel |
| `fast-uri` | `3.1.9` | BSD-3-Clause | Laufzeit/Bündel |
| `fdir` | `6.5.0` | MIT | Entwicklung |
| `fsevents` | `2.3.3` | MIT | Entwicklung |
| `graceful-fs` | `4.2.11` | ISC | Entwicklung |
| `html-encoding-sniffer` | `7.0.0` | MIT | Entwicklung |
| `https-proxy-agent` | `7.0.6` | MIT | Entwicklung |
| `indent-string` | `4.0.0` | MIT | Entwicklung |
| `index-to-position` | `1.2.0` | MIT | Entwicklung |
| `inline-style-parser` | `0.2.7` | MIT | Laufzeit/Bündel |
| `is-potential-custom-element-name` | `1.0.1` | MIT | Entwicklung |
| `is-reference` | `3.0.3` | MIT | Laufzeit/Bündel |
| `jiti` | `2.7.0` | MIT | Entwicklung |
| `js-levenshtein` | `1.1.6` | MIT | Entwicklung |
| `js-tokens` | `4.0.0` | MIT | Entwicklung |
| `js-yaml` | `4.3.2` | MIT | Entwicklung |
| `jsdom` | `30.1.3` | MIT | Entwicklung |
| `json-schema-traverse` | `1.0.0` | MIT | Laufzeit/Bündel |
| `lightningcss` | `1.32.0` | MPL-2.0 | Entwicklung |
| `lightningcss-android-arm64` | `1.32.0` | MPL-2.0 | Entwicklung |
| `lightningcss-darwin-arm64` | `1.32.0` | MPL-2.0 | Entwicklung |
| `lightningcss-darwin-x64` | `1.32.0` | MPL-2.0 | Entwicklung |
| `lightningcss-freebsd-x64` | `1.32.0` | MPL-2.0 | Entwicklung |
| `lightningcss-linux-arm-gnueabihf` | `1.32.0` | MPL-2.0 | Entwicklung |
| `lightningcss-linux-arm64-gnu` | `1.32.0` | MPL-2.0 | Entwicklung |
| `lightningcss-linux-arm64-musl` | `1.32.0` | MPL-2.0 | Entwicklung |
| `lightningcss-linux-x64-gnu` | `1.32.0` | MPL-2.0 | Entwicklung |
| `lightningcss-linux-x64-musl` | `1.32.0` | MPL-2.0 | Entwicklung |
| `lightningcss-win32-arm64-msvc` | `1.32.0` | MPL-2.0 | Entwicklung |
| `lightningcss-win32-x64-msvc` | `1.32.0` | MPL-2.0 | Entwicklung |
| `locate-character` | `3.0.0` | MIT | Laufzeit/Bündel |
| `lru-cache` | `11.5.3` | BlueOak-1.0.0 | Entwicklung |
| `lz-string` | `1.5.0` | MIT | Laufzeit/Bündel |
| `magic-string` | `0.30.21` | MIT | Laufzeit/Bündel |
| `mdn-data` | `2.27.1` | CC0-1.0 | Entwicklung |
| `min-indent` | `1.0.1` | MIT | Entwicklung |
| `minimatch` | `5.1.9` | ISC | Entwicklung |
| `mri` | `1.2.0` | MIT | Entwicklung |
| `ms` | `2.1.3` | MIT | Entwicklung |
| `nanoid` | `3.3.20` | MIT | Entwicklung |
| `obug` | `2.2.1` | MIT | Entwicklung |
| `openapi-typescript` | `7.13.0` | MIT | Entwicklung |
| `parse-json` | `8.3.0` | MIT | Entwicklung |
| `parse5` | `8.0.1` | MIT | Entwicklung |
| `picocolors` | `1.1.1` | ISC | Entwicklung |
| `picomatch` | `4.0.7` | MIT | Entwicklung |
| `playwright` | `1.64.1` | Apache-2.0 | Entwicklung |
| `playwright-core` | `1.64.1` | Apache-2.0 | Entwicklung |
| `pluralize` | `8.0.0` | MIT | Entwicklung |
| `postcss` | `8.5.31` | MIT | Entwicklung |
| `prettier` | `3.9.10` | MIT | Entwicklung |
| `prettier-plugin-svelte` | `4.1.1` | MIT | Entwicklung |
| `pretty-format` | `27.5.1` | MIT | Entwicklung |
| `punycode` | `2.3.1` | MIT | Entwicklung |
| `react-is` | `17.0.2` | MIT | Entwicklung |
| `readdirp` | `4.1.2` | MIT | Entwicklung |
| `redent` | `3.0.0` | MIT | Entwicklung |
| `require-from-string` | `2.0.2` | MIT | Laufzeit/Bündel |
| `rolldown` | `1.2.14` | MIT | Entwicklung |
| `runed` | `0.35.1` | MIT | Laufzeit/Bündel |
| `sade` | `1.8.1` | MIT | Entwicklung |
| `saxes` | `6.0.0` | ISC | Entwicklung |
| `source-map-js` | `1.2.2` | BSD-3-Clause | Entwicklung |
| `std-env` | `4.3.0` | MIT | Entwicklung |
| `strip-indent` | `3.0.0` | MIT | Entwicklung |
| `style-mod` | `4.1.4` | MIT | Laufzeit/Bündel |
| `style-to-object` | `1.0.14` | MIT | Laufzeit/Bündel |
| `supports-color` | `10.2.2` | MIT | Entwicklung |
| `svelte` | `5.57.2` | MIT | Laufzeit/Bündel |
| `svelte-check` | `4.7.7` | MIT | Entwicklung |
| `svelte-toolbelt` | `0.10.6` | MIT (LICENSE file) | Laufzeit/Bündel |
| `tabbable` | `6.5.0` | MIT | Laufzeit/Bündel |
| `tailwind-merge` | `3.7.0` | MIT | Laufzeit/Bündel |
| `tailwind-variants` | `3.3.1` | MIT | Laufzeit/Bündel |
| `tailwindcss` | `4.3.3` | MIT | Laufzeit/Bündel |
| `tapable` | `2.3.3` | MIT | Entwicklung |
| `tinybench` | `6.2.2` | MIT | Entwicklung |
| `tinyexec` | `1.3.1` | MIT | Entwicklung |
| `tinyglobby` | `0.2.17` | MIT | Entwicklung |
| `tldts` | `7.4.19` | MIT | Entwicklung |
| `tldts-core` | `7.4.19` | MIT | Entwicklung |
| `tough-cookie` | `6.0.2` | BSD-3-Clause | Entwicklung |
| `tr46` | `7.0.0` | MIT | Entwicklung |
| `tslib` | `2.8.1` | 0BSD | Laufzeit/Bündel |
| `type-fest` | `4.41.0` | (MIT OR CC0-1.0) | Entwicklung |
| `typescript` | `5.9.3` | Apache-2.0 | Entwicklung |
| `undici` | `8.12.3` | MIT | Entwicklung |
| `undici-types` | `8.9.0` | MIT | Entwicklung |
| `uri-js-replace` | `1.0.1` | MIT | Entwicklung |
| `vite` | `8.3.4` | MIT | Entwicklung |
| `lightningcss` | `1.33.0` | MPL-2.0 | Entwicklung |
| `lightningcss-android-arm64` | `1.33.0` | MPL-2.0 | Entwicklung |
| `lightningcss-darwin-arm64` | `1.33.0` | MPL-2.0 | Entwicklung |
| `lightningcss-darwin-x64` | `1.33.0` | MPL-2.0 | Entwicklung |
| `lightningcss-freebsd-x64` | `1.33.0` | MPL-2.0 | Entwicklung |
| `lightningcss-linux-arm-gnueabihf` | `1.33.0` | MPL-2.0 | Entwicklung |
| `lightningcss-linux-arm64-gnu` | `1.33.0` | MPL-2.0 | Entwicklung |
| `lightningcss-linux-arm64-musl` | `1.33.0` | MPL-2.0 | Entwicklung |
| `lightningcss-linux-x64-gnu` | `1.33.0` | MPL-2.0 | Entwicklung |
| `lightningcss-linux-x64-musl` | `1.33.0` | MPL-2.0 | Entwicklung |
| `lightningcss-win32-arm64-msvc` | `1.33.0` | MPL-2.0 | Entwicklung |
| `lightningcss-win32-x64-msvc` | `1.33.0` | MPL-2.0 | Entwicklung |
| `vitefu` | `1.1.3` | MIT | Entwicklung |
| `vitest` | `5.0.5` | MIT | Entwicklung |
| `magic-string` | `1.4.3` | MIT | Entwicklung |
| `obug` | `3.0.0` | MIT | Entwicklung |
| `w3c-keyname` | `2.2.8` | MIT | Laufzeit/Bündel |
| `w3c-xmlserializer` | `6.0.0` | MIT | Entwicklung |
| `webidl-conversions` | `8.0.1` | BSD-2-Clause | Entwicklung |
| `whatwg-mimetype` | `5.0.0` | MIT | Entwicklung |
| `whatwg-url` | `17.3.0` | MIT | Entwicklung |
| `why-is-node-running` | `3.2.1` | MIT | Entwicklung |
| `xml-name-validator` | `5.0.0` | Apache-2.0 | Entwicklung |
| `xmlchars` | `2.2.0` | MIT | Entwicklung |
| `yaml-ast-parser` | `0.0.43` | Apache-2.0 | Entwicklung |
| `yargs-parser` | `21.1.1` | ISC | Entwicklung |
| `zimmerframe` | `1.1.5` | MIT | Laufzeit/Bündel |

Inventar: 230 aufgelöste Paketpositionen einschließlich optionaler Plattformvarianten.


## Sichtbare Hinweise F3

Der Quellen-/Lizenzdialog verweist auf die unveränderten Builddateien `LICENSE.txt`
und `THIRD-PARTY-NOTICES.txt`. Der Webquelllink ist an den tatsächlich gebauten
Git-Commit gebunden. Go-Serverprojekt und Buildherkunft sind separat verlinkt;
kein pauschaler Lizenzwechsel der Bibliotheken und keine zusätzliche Abhängigkeit.


F3 ergänzt keine Produkt-/Testabhängigkeit und ändert `package-lock.json` nicht.
Die zusätzliche API0.2.0-Typ-/Standalonegenerierung verwendet dieselben bereits
erfassten Werkzeuge; Ajvs MIT-Helfer bleibt im unveränderten Originalnotice enthalten.
Der echte Go-Testserver wird ausschließlich aus dem gepinnten öffentlichen
[Backendstand](https://github.com/MagicalWig34653/db-manager/tree/427444d7bcb8e30c9563ded2000ec3d5e19646c4)
gebaut; dessen Go-Abhängigkeiten behalten ihr eigenes
[Inventar](https://github.com/MagicalWig34653/db-manager/blob/427444d7bcb8e30c9563ded2000ec3d5e19646c4/docs/LIZENZEN.md).
PostgreSQL18.6 ist eine isolierte Testfixture und kein Teil des Webartefakts.

## F4-Nachtrag

Der Zeileneditor und die zusätzlichen Vertragsvalidatoren führen keine neuen
Abhängigkeiten ein. Lockfile, Original-Lizenztexte und Fremdcodezuordnung bleiben
unverändert; die zusätzlichen eigenen Produkt-/Testdateien sind AGPL-3.0-only.

## F6-Nachtrag

Der lokale Ergebnisexport benötigt keine neuen Abhängigkeiten. Lockfile und
Originallizenzen bleiben unverändert. Eigene Helper/Komponenten/Tests sind
AGPL-3.0-only; keine Änderung kopierter Registry-Lizenztexte.

## F5-Nachtrag

Lesende Strukturkomponente und fünfter Standalonevalidator führen keine neuen
Abhängigkeiten ein. Lockfile und Originaltexte unverändert; eigener Produkt-/Testcode
AGPL-3.0-only. Vorherige Vertragsvalidatoren bleiben bytegleich.

## W-P16-CodeMirror-Nachtrag

Der SQL-Editor verwendet CodeMirror 6 (Entscheidung E8, vorab freigegeben), MIT-lizenziert, Autor Marijn Haverbeke
und Mitwirkende. Direkt eingebunden: `@codemirror/state` 6.7.6, `@codemirror/view` 6.43.15, `@codemirror/language` 6.13.1,
`@codemirror/commands` 6.11.1, `@codemirror/search` 6.7.2, `@codemirror/autocomplete` 6.20.4, `@codemirror/lang-sql` 6.10.0
und `@lezer/highlight` 1.2.5. Transitiv: `@codemirror/streamparser` 6.0.0, `@lezer/common` 1.5.4, `@lezer/lr` 1.4.11,
`@marijn/find-cluster-break` 1.0.4, `crelt` 1.0.7, `style-mod` 4.1.4, `w3c-keyname` 2.2.8 (alle MIT; Lizenztexte bytegleich in
den Distributionshinweisen). Die Pakete werden ausschließlich über einen dynamischen Import als eigener Chunk geladen.
Der SQL-Formatierer ist eigener Code (`src/lib/features/sql-editor/format.ts`), kein `sql-formatter`.
