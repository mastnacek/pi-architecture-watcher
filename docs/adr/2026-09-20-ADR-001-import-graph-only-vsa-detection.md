# ADR-001: Import-graph-only VSA detection with a two-mode gate

- **Date:** 2026-09-20
- **Status:** active
- **Component:** pi-architecture-watcher

## Context

Pi extensions can see a tool call *before* it executes (`tool_call`) and the result
*after* it (`tool_result`). We wanted architecture feedback while a file is being
written, without an LLM in the loop, and without depending on `pi-lens` or any
language server being installed.

Three options were on the table:

1. Query the LSP for type/symbol data and infer architecture from it.
2. Bundle the TypeScript compiler and walk the AST.
3. Parse imports with an internal tokenizer and reason over an import graph.

Real-time VSA feedback must never block editing for long, must work in every
project regardless of installed extensions, and must not pull a 30 MB toolchain
into a Pi package that installs with `npm install --omit=dev`.

## Decision

Detect the architecture from the **import graph only** (option 3), with a
self-contained tokenizer (`src/slices/scan`) and a configurable slice topology
(`src/slices/topology`). No LSP, no `typescript` dependency, no network.

Concretely:

- `maskSource` blanks comments, string/template bodies and regex bodies while
  preserving newlines and literal positions; `scanImports` then extracts
  static, type-only, side-effect, re-export, dynamic and `require` edges.
- A slice is public only through `index` / `public` / `api` / `<sliceName>`
  (`publicEntryMode: "entry-only"` is the default). Everything else is internal.
- A directory with no source files but with children is a *group*, so
  `features/admin/users` resolves to the slice `users`.
- Detection is split from reaction: `classify` produces a `Report`, `enforce`
  maps it to a single action. `auto` injects remediation into the tool result so
  the agent self-corrects; `human` confirms at `blockAt`, and becomes a hard
  block when no dialog UI exists (non-interactive runs).
- `blockAt` defaults to `"never"` so an upgrade can never silently break a
  headless pipeline.

## Consequences

**Benefits:** sub-millisecond analysis, zero runtime dependencies besides
`typebox`, works identically in TUI, JSON and RPC modes, trivially testable as a
pure function of file content.

**Accepted limits:** no type information, so we cannot detect
interface-level coupling; `node_modules`, non-relative monorepo links and
`tsconfig` `paths` outside the `aliases` config are unresolved; cycle detection
is intentionally one hop; regex-vs-division and template interpolation are
heuristic, so a pathological file can hide an edge. These are documented in the
README rather than papered over.

**Follow-ups:** if `pi-lens` LSP data becomes available as an extension API,
reuse it to upgrade `cross-slice-cycle` from one hop to full graph reachability
without replacing the import scanner.