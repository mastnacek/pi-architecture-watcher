# pi-architecture-watcher — build guide

Static **VSA** (Vertical Slice Architecture) monitor for the Pi coding agent.
No LLM. It tokenizes TS/JS imports, maps slices, scores drift, and warns like an LSP.

## Layout (this plugin is itself VSA)
- `index.ts`             composition root — Pi adapter only, no logic
- `src/shared/`          kernel: `types.ts`, `config.ts`, `paths.ts` (no slice imports)
- `src/slices/scan/`     `source -> ImportEdge[]`
- `src/slices/topology/` `project -> SliceLookup`
- `src/slices/classify/` `facts -> Report` (rules + score)
- `src/slices/report/`   `Report -> markdown / status / injection`
- `src/slices/enforce/`  `Report + mode -> GateDecision` (auto | human)
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
- `src/**` imports use explicit `.js` extensions (NodeNext). Tests import `../index.js`.
- Pure functions. No global mutable state outside `index.ts`. Never touch network or an LLM.
- New detection rule = one function in `classify/rules.ts` + one test in `test/classify.test.ts`.
- New config knob = field in `WatcherConfig` (`shared/types.ts`) + default in `shared/config.ts`.

## Conventions
- Severity `hint < warning < error`; `score` 0-100 answers *"to what extent"*.
- Mode `auto` injects fix advice into the tool result; `human` confirms before the write lands.
- Every `Finding` carries `rule, severity, file, line, detail, suggestion` and optional `fix`.
- Never block on `hint`. Block only per `config.blockAt`.

## Before commit
```bash
npm run check && npm test
```
