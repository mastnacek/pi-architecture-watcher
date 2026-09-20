# pi-architecture-watcher — build guide

Static **VSA** (Vertical Slice Architecture) monitor for the Pi coding agent.
No LLM. It tokenizes imports (TS/JS, Python, Rust, Java, Kotlin, Go), maps slices, scores drift, and warns like an LSP.

## Layout (this plugin is itself VSA)
- `index.ts`             composition root — Pi adapter only, no logic
- `src/shared/`          kernel: `types.ts`, `config.ts`, `languages.ts`, `paths.ts` (no slice imports)
- `src/slices/scan/`     `source + language -> ImportEdge[]` (per-language scanners + dispatch)
- `src/slices/topology/` `project -> SliceLookup`
- `src/slices/classify/` `facts -> Report` (rules + score)
- `src/slices/report/`   `Report -> markdown / status / injection`
- `src/slices/enforce/`  `Report + mode -> GateDecision` (auto | human)
- `src/slices/settings/` `WatcherConfig -> validated knobs + /vsa completions`
- `test/`                `node:test` suites

**Rule: slices never import each other.** They depend on `src/shared` only; `index.ts` wires them.

## Commands
```bash
npm install
npm run check   # tsc --noEmit — must pass
npm run build   # tsc -> dist/ (tests run from dist)
npm test        # tsc && node --test dist/test/*.test.js
```

## Hard rules
- Node built-ins only, plus `typebox` for tool schemas. No other runtime deps.
- `src/**` imports use explicit `.js` extensions (NodeNext); tests import `../src/**.js` the same way.
- Pure functions. No global mutable state outside `index.ts`. Never touch network or an LLM.
- New detection rule = one function in `classify/rules.ts` + one test in `test/classify.test.ts`.
- New language = one scanner in `scan/<lang>.ts` + a `languageOf` entry in `shared/languages.ts` + a resolver branch in `shared/paths.ts` + tests in `test/languages.test.ts`.
- New config knob = field in `WatcherConfig` (`shared/types.ts`) + default in `shared/config.ts`.

## Conventions
- Severity `hint < warning < error`; `score` 0-100 answers *"to what extent"*.
- Mode `auto` injects fix advice into the tool result; `human` confirms before the write lands.
- Every `Finding` carries `rule, severity, file, line, detail, suggestion` and optional `fix`.
- Never block on `hint`. Block only per `config.blockAt`.

## UX: lazy menus + Czech help
- **Lazy menus** = `/vsa` argument completions. Live in `src/slices/settings/complete.ts`; wired via `getArgumentCompletions` in `index.ts`. The catalogue (`SETTING_SPECS` in `catalogue.ts`) is the single source — new knob automatically gets key/value completions.
- **Completion contract (critical):** `getArgumentCompletions(prefix)` receives the *entire* argument text after `/vsa `, and `item.value` replaces that whole prefix. So `value` must be the full argument string (`mode human`, `config set mode human`), while `label` stays the leaf token shown in the dropdown (`human`). Never return the leaf alone as `value`. Append a trailing space to `value` for non-terminal completions (subcommands/actions/keys that take a further argument) so Tab-completing one token lets the next parameter's completion re-trigger; terminal values get no trailing space.
- **Czech help** = all user-facing strings are Czech (notifications, `description`, `valueHelp`, catalogue prose). Code and identifiers stay English.
- Adding a subcommand: entry in `VSA_SUBCOMMANDS` + a `case` in the `/vsa` handler + a test in `test/settings.test.ts` (assert full `value` and leaf `label`).

## Before commit
```bash
npm run check && npm test
```
