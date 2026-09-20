# pi-architecture-watcher

**Static Vertical Slice Architecture monitor for the [Pi coding agent](https://pi.dev).**
No LLM. It parses imports, maps your slices, scores drift and warns like an LSP — while the file is still being written.

```
VSA violation 40/100 (1E 0W 0H) · cross-slice-deep-import
  src/features/billing/charge.ts:1 [error] cross-slice-deep-import
  Slice `billing` reaches into `invoicing` internals via "../invoicing/internal.js".
  → Import `src/features/invoicing/index.ts` instead. Suggested import: `../invoicing/index.js`
```

## Install from GitHub

```bash
pi install git:github.com/mastnacek/pi-architecture-watcher

# pinned to a tag instead
pi install git:github.com/mastnacek/pi-architecture-watcher@v0.1.0

# try without installing
pi -e git:github.com/mastnacek/pi-architecture-watcher
```

Update with `pi update --extensions` (or `pi install git:...@new-tag` to move a pinned ref).
Pi clones git packages to `~/.pi/agent/git/github.com/mastnacek/pi-architecture-watcher`
and installs their runtime dependencies (`typebox`).

## What it detects

Ten rules, weighted into a single **0-100** score that answers *"to what extent does this violate VSA?"*.

| Rule | Severity | Meaning |
|---|---|---|
| `cross-slice-deep-import` | error | A slice imports another slice's internals instead of its public entry. |
| `cross-slice-cycle` | error | `billing → invoicing` and `invoicing → billing`. |
| `shared-depends-on-slice` | error | The shared kernel imports a feature slice (inverted layering). |
| `orphan-domain-file` | warning | Domain logic lives outside every slice, but carries slice naming/vocabulary. |
| `slice-fan-out` | warning | A slice depends on more peer slices than `maxSliceFanOut`. |
| `barrel-leak` | hint | A public entry re-exports internals, widening the slice surface. |
| `shared-abuse` | hint | A file pulls many modules from the shared kernel — a horizontal layer in disguise. |
| `loose-slice-file` | warning | A generic (`utils.ts`) or foreign-domain module sits inside a slice. |
| `slice-missing-entry` | hint | A slice has no `index.ts`, so consumers are forced into deep imports. |
| `file-in-slice-root` | hint | A file was dropped directly into the slices container directory. |

Severity weights: `error` 40, `warning` 15, `hint` 5 (capped at 100).
Verdict: `clean` → `drift` → `violation` → `severe`.

Run `/vsa rules` in Pi for the same catalogue.

## Two modes

| Mode | Behaviour |
|---|---|
| `auto` (default) | The model is told what to fix. Advice is appended to the `write`/`edit` tool result so the agent self-corrects without stopping. |
| `human` | Findings above `notifyFrom` are surfaced to you; at `blockAt` Pi asks for confirmation before the write lands. Declining blocks the tool call and tells the model not to retry verbatim. |
| `off` | Watcher disabled without uninstalling. |

In non-interactive runs (`-p`, `--mode json`, `--mode rpc`) there is no dialog UI, so a `human`-mode block becomes a hard block — **unless** you set `blockAt: "never"`, which is the default.

## Commands

```
/vsa status            watcher state, discovered slices, last report
/vsa check <path>      analyze any file on demand
/vsa mode <auto|human|off>
/vsa rules             rule catalogue
/vsa explain           full last report
/vsa init              write a default .pi/architecture-watcher.json
/vsa rescan            rebuild the slice topology after moving directories
/vsa on | off
```

Also: `Ctrl+Shift+V` re-checks the last edited file, and the `vsa_check` tool lets the agent check a path itself.

## Configuration

`<project>/.pi/architecture-watcher.json` (project) overrides `~/.pi/agent/architecture-watcher.json` (global):

```json
{
  "mode": "auto",
  "blockAt": "never",
  "notifyFrom": "warning",
  "roots": ["src/features", "src/slices"],
  "sharedRoots": ["src/shared"],
  "aliases": { "@app/": "src/" },
  "publicEntries": ["index", "public", "api"],
  "publicEntryMode": "entry-only",
  "maxSliceFanOut": 4,
  "maxSharedImports": 6,
  "ignore": ["**/*.test.*", "**/*.d.ts"],
  "injectFixes": true,
  "statusLine": true
}
```

`/vsa init` writes the full default set.

- **`entry-only`** (default): a slice is reachable only through `index` / `public` / `api` / `<sliceName>` at its root. Everything else is internal.
- **`root-level`**: every file at the slice root is public; `internal/`, `impl/`, `lib/`, `utils/`, `helpers/`, `_` stay private.
- A sub-directory that holds no source files but has children is treated as a **group** (`features/admin/users` → slice `users`).

## How it works

```text
tool_call (write|edit)          tool_result
        │                            ▲
        ▼                            │ advice appended to the result
  ┌───────────┐   ┌──────────┐   ┌──────────┐   ┌─────────┐   ┌─────────┐
  │   scan    │──▶│ topology │──▶│ classify │──▶│ report  │──▶│ enforce │
  │ src→edges │   │ project→ │   │ facts→   │   │ →text   │   │ →action │
  │           │   │ slices   │   │ Report   │   │         │   │         │
  └───────────┘   └──────────┘   └──────────┘   └─────────┘   └─────────┘
```

The file content is computed **before** the write executes (Pi's `edit` semantics are replayed
in memory), so the report describes what is about to land, not what already did.

The plugin is itself written as vertical slices:

- `src/shared/` — kernel: types, config, path/glob/import resolution. Deep modules: `resolveImport` and `loadConfig` hide extension probing, aliases, merge order and validation.
- `src/slices/scan/` — deep module `scanImports(source)`: masks comments/strings/regex/templates, then extracts static, type-only, side-effect, re-export, dynamic and `require` edges.
- `src/slices/topology/` — deep module `buildSliceMap(root, config)` → read-only `SliceLookup`.
- `src/slices/classify/` — a rule is `(facts) => Finding[]`; add one to the `RULES` registry.
- `src/slices/report/` — every rendering path lives here, so `auto` advice stays consistent.
- `src/slices/enforce/` — one decision table maps a report + mode + UI availability to a single action.

Slices never import each other; they depend only on `src/shared`, and `index.ts` is the composition root. `test/self.test.ts` runs the watcher over its own source and asserts zero `error`-level findings.

## Limits

- Import-graph based. It does not resolve `node_modules`, `tsconfig` `paths` outside `aliases`, or non-relative monorepo links.
- Cycle detection is one hop deep (`A → B`, `B → A`) — cheap and covers the common case.
- Regex literals and template interpolation are handled heuristically; a pathological file can hide an import.
- Zero runtime dependencies except `typebox` (tool schema).

## Development

```bash
npm install
npm run check   # tsc --noEmit
npm test        # tsc && node --test dist/test/*.test.js
```

See [`AGENTS.md`](./AGENTS.md) for the build contract.

## License

MIT