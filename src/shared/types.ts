/**
 * Shared kernel — pure data contracts for every slice.
 *
 * Deep module: this file hides nothing and decides nothing. It is the only
 * vocabulary shared between slices, which is what lets `src/slices/*` stay
 * mutually independent.
 */

/** Violation weight. `hint` never blocks, `error` can. */
export type Severity = "hint" | "warning" | "error";

/** How the watcher reacts. `auto` = advise the model, `human` = ask the user. */
export type Mode = "auto" | "human" | "off";

/** Coarse verdict derived from the strongest finding and the score. */
export type Verdict = "clean" | "drift" | "violation" | "severe";

/** Where a slice is allowed to expose its surface. */
export type PublicEntryMode = "entry-only" | "root-level";

export type ImportKind =
  | "static"
  | "side-effect"
  | "type"
  | "export"
  | "dynamic"
  | "require";

/** One dependency edge found in a source file. */
export interface ImportEdge {
  specifier: string;
  kind: ImportKind;
  line: number;
  column: number;
}

/** A file plus its prospective content (i.e. the content that is about to land). */
export interface SourceFile {
  /** absolute path */
  path: string;
  /** POSIX path relative to the project root */
  rel: string;
  /** content after the pending edit */
  content: string;
}

export interface SliceRef {
  /** stable id, e.g. "billing" or "billing/invoices" */
  id: string;
  /** absolute directory of the slice */
  dir: string;
  /** absolute slice root this slice was discovered under */
  root: string;
  /** whether a public entry file already exists */
  hasPublicEntry: boolean;
}

/**
 * Read-only view of the project's slice topology.
 *
 * Deep module: callers ask plain questions (`sliceOf`, `isPublicEntry`) and
 * never learn how roots, globs, or caches are handled inside.
 */
export interface SliceLookup {
  root: string;
  sliceOf(absPath: string): SliceRef | null;
  sharedOf(absPath: string): string | null;
  isPublicEntry(absPath: string, slice: SliceRef): boolean;
  publicEntryPath(slice: SliceRef): string | null;
  slices(): SliceRef[];
  sharedRoots(): string[];
}

/** Everything a rule may look at. Assembled by the composition root. */
export interface FileFacts {
  file: SourceFile;
  imports: ImportEdge[];
  slice: SliceRef | null;
  shared: string | null;
  lookup: SliceLookup;
  config: WatcherConfig;
  /** absolute project root */
  projectRoot: string;
  /** resolve one import edge to an existing absolute file, or `null` */
  resolve(edge: ImportEdge): string | null;
}

export interface Finding {
  /** stable rule id, e.g. "cross-slice-deep-import" */
  rule: string;
  severity: Severity;
  /** POSIX path relative to the project root */
  file: string;
  line?: number;
  title: string;
  detail: string;
  /** human-readable remediation */
  suggestion: string;
  /** optional concrete rewrite, e.g. the corrected import statement */
  fix?: string;
}

export interface Report {
  /** POSIX path relative to the project root */
  file: string;
  /** absolute path */
  abs: string;
  slice: string | null;
  shared: string | null;
  verdict: Verdict;
  /** 0-100 — "to what extent" the file violates VSA */
  score: number;
  findings: Finding[];
  counts: Record<Severity, number>;
  generatedBy: string;
  timestamp: number;
}

export type GateAction = "pass" | "advise" | "notify" | "confirm" | "block";

export interface GateDecision {
  action: GateAction;
  severity: Severity | "clean";
  reason: string;
  /** model-facing text appended to the tool result */
  injection?: string;
}

export interface WatcherConfig {
  enabled: boolean;
  mode: Mode;
  /** directories (relative to project root) that contain one dir per slice */
  roots: string[];
  /** directories that form the shared kernel — may not depend on slices */
  sharedRoots: string[];
  /** simple path aliases, e.g. { "@app/": "src/" } */
  aliases: Record<string, string>;
  sourceExtensions: string[];
  /** basenames (without extension) that count as a slice's public surface */
  publicEntries: string[];
  publicEntryMode: PublicEntryMode;
  /** directory names inside a slice that are always internals */
  internalsDirNames: string[];
  /** slice may import at most this many distinct other slices */
  maxSliceFanOut: number;
  /** a file may pull at most this many modules from the shared kernel */
  maxSharedImports: number;
  /** severity at which a write is blocked; "never" disables blocking */
  blockAt: Severity | "never";
  /** minimum severity that produces a user-visible notification */
  notifyFrom: Severity;
  /** built-in tools the watcher hooks */
  watchTools: string[];
  /** extra (custom) tool names whose `path` input should be watched */
  watchToolPatterns: string[];
  /** glob-lite patterns, relative to project root */
  ignore: string[];
  /** append remediation advice to the tool result */
  injectFixes: boolean;
  /** additionally rewrite offending import statements in the file */
  autoFixImports: boolean;
  /** keep an LSP-like status entry up to date */
  statusLine: boolean;
}
