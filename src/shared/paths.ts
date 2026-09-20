/**
 * Path + filesystem kernel.
 *
 * Deep module: callers ask `resolveImport(...)` or `matchesAny(...)` and never
 * deal with extension probing, alias expansion, glob translation or POSIX
 * normalisation themselves.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { LANGUAGE_EXTENSIONS, type SourceLanguage } from "./languages.js";
import type { ImportEdge, WatcherConfig } from "./types.js";

/** Convert a platform path to POSIX separators. */
export function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/** Path of `child` relative to `parent`, POSIX-normalised. */
export function relPosix(parent: string, child: string): string {
  return toPosix(relative(parent, child));
}

/** True when `child` is `parent` or lives underneath it. */
export function isSubPath(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Convert one glob-lite pattern into a RegExp (supports `**`, `*`, `?`, `{a,b}`). */
export function globToRegExp(glob: string): RegExp {
  const pattern = toPosix(glob);
  let out = "^";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` absorbs any number of directories, `**` absorbs anything
        if (pattern[i + 2] === "/") {
          out += "(?:[^/]+/)*";
          i += 3;
        } else {
          out += ".*";
          i += 2;
        }
      } else {
        out += "[^/]*";
        i += 1;
      }
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }
    if (ch === "{") {
      const end = pattern.indexOf("}", i);
      if (end > -1) {
        const alts = pattern
          .slice(i + 1, end)
          .split(",")
          .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        out += `(?:${alts.join("|")})`;
        i = end + 1;
        continue;
      }
    }
    out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    i += 1;
  }
  return new RegExp(out + "$");
}

/** True when `relPath` matches at least one of the glob patterns. */
export function matchesAny(relPath: string, globs: readonly string[]): boolean {
  const target = toPosix(relPath);
  return globs.some((g) => globToRegExp(g).test(target));
}

export function isDirectory(absPath: string): boolean {
  try {
    return statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(absPath: string): boolean {
  try {
    return statSync(absPath).isFile();
  } catch {
    return false;
  }
}

/** Read a file, returning `null` instead of throwing. */
export function readTextSafe(absPath: string): string | null {
  try {
    return readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

/** Immediate sub-directory names (non-recursive), sorted. */
export function listDirs(absPath: string): string[] {
  try {
    return readdirSync(absPath, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Immediate file names (non-recursive), sorted. */
export function listFiles(absPath: string): string[] {
  try {
    return readdirSync(absPath, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Strip the last extension from a basename. */
export function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** True when `name` ends with one of the configured source extensions. */
export function hasSourceExtension(name: string, extensions: readonly string[]): boolean {
  return extensions.some((ext) => name.endsWith(ext));
}

/** Last path segment of a relative POSIX path. */
export function baseName(relOrAbs: string): string {
  const posix = toPosix(relOrAbs);
  const idx = posix.lastIndexOf("/");
  return idx === -1 ? posix : posix.slice(idx + 1);
}

/** All directories from `projectRoot` down to `absPath` (exclusive of root). */
export function pathSegments(projectRoot: string, absPath: string): string[] {
  const rel = relPosix(projectRoot, absPath);
  return rel === "" ? [] : rel.split("/");
}

/** Candidate file paths for an extension-less module path. */
function probeCandidates(base: string, extensions: readonly string[]): string[] {
  const out: string[] = [base];
  const dot = base.lastIndexOf("/");
  const filePart = base.slice(dot + 1);
  const currentExt = extensions.find((ext) => filePart.endsWith(ext));

  // TypeScript emits/consumes `.js` specifiers that point at `.ts` sources.
  const jsToTs: Record<string, string[]> = {
    ".js": [".ts", ".tsx"],
    ".jsx": [".tsx", ".ts"],
    ".mjs": [".mts", ".ts"],
    ".cjs": [".cts", ".ts"],
  };
  for (const [jsExt, tsExts] of Object.entries(jsToTs)) {
    if (!filePart.endsWith(jsExt)) continue;
    const stem = base.slice(0, -jsExt.length);
    for (const tsExt of tsExts) out.push(`${stem}${tsExt}`);
  }

  if (currentExt === undefined) {
    for (const ext of extensions) out.push(`${base}${ext}`);
  }
  for (const ext of extensions) out.push(join(base, `index${ext}`));
  return out;
}

/**
 * Resolve an import specifier to an existing absolute file.
 *
 * Handles relative specifiers, configured aliases and extension probing. Bare
 * package specifiers (node_modules) return `null` — they are never slices.
 * `language` selects the module syntax: dotted `a.b.C` for Python/JVM,
 * `crate::`/`self::`/`super::` for Rust and module dirs for Go.
 */
export function resolveImport(
  edge: ImportEdge,
  fromFileAbs: string,
  projectRoot: string,
  config: WatcherConfig,
  language: SourceLanguage = "typescript",
): string | null {
  const spec = edge.specifier;
  if (!spec) return null;
  if (spec.startsWith("node:")) return null;

  if (language === "python" && spec.startsWith(".")) {
    return resolvePythonRelative(spec, fromFileAbs, projectRoot);
  }
  if (language === "rust" && /^(crate|self|super)(::|$)/.test(spec)) {
    return resolveRustModule(spec, fromFileAbs, projectRoot);
  }
  if (language === "java" || language === "kotlin") {
    return resolveJvmModule(spec, projectRoot, config, language);
  }
  if (language === "python") {
    return resolveDottedModule(spec, [projectRoot, join(projectRoot, "src")], [".py", ".pyi"], ["__init__"], 2);
  }
  if (language === "go") {
    return resolveGoModule(spec, projectRoot);
  }

  let base: string | null = null;

  if (spec.startsWith(".")) {
    base = resolve(dirname(fromFileAbs), spec);
  } else {
    for (const [prefix, target] of Object.entries(config.aliases)) {
      if (spec === prefix || spec.startsWith(prefix)) {
        const rest = spec.slice(prefix.length).replace(/^\//, "");
        base = resolve(projectRoot, target, rest);
        break;
      }
    }
    // tsconfig-style "@/" and "~/" conveniences
    if (base === null && (spec.startsWith("@/") || spec.startsWith("~/"))) {
      base = resolve(projectRoot, "src", spec.slice(2));
    }
  }

  if (base === null) return null;
  if (!isSubPath(projectRoot, base)) return null;

  for (const candidate of probeCandidates(base, config.sourceExtensions)) {
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/** Probe `base` and its directory index files for `language`. */
function probeLanguage(
  base: string,
  extensions: readonly string[],
  indexNames: readonly string[],
  dropTrailing = 0,
): string | null {
  const segments = base.split("/");
  for (let drop = 0; drop <= dropTrailing && drop < segments.length; drop += 1) {
    const trimmed = segments.slice(0, segments.length - drop).join("/");
    if (trimmed.length === 0) continue;
    for (const ext of extensions) {
      if (isFile(`${trimmed}${ext}`)) return `${trimmed}${ext}`;
    }
    for (const ext of extensions) {
      for (const name of indexNames) {
        const candidate = join(trimmed, `${name}${ext}`);
        if (isFile(candidate)) return candidate;
      }
    }
  }
  return null;
}

/** `from .pkg.mod import x` -> `./pkg/mod` relative to the importing file. */
function resolvePythonRelative(spec: string, fromFileAbs: string, projectRoot: string): string | null {
  const base = resolve(dirname(fromFileAbs), spec);
  if (!isSubPath(projectRoot, base)) return null;
  return probeLanguage(toPosix(base), LANGUAGE_EXTENSIONS.python, ["__init__"], 1);
}

/** Dotted module (`a.b.c`) under one of `roots`, trying trailing drops. */
function resolveDottedModule(
  spec: string,
  roots: readonly string[],
  extensions: readonly string[],
  indexNames: readonly string[],
  dropTrailing: number,
): string | null {
  if (spec.startsWith(".") || spec.includes(":")) return null;
  const parts = spec.split(".");
  if (parts.length === 0) return null;
  for (const root of roots) {
    const base = join(root, ...parts);
    const found = probeLanguage(toPosix(base), extensions, indexNames, dropTrailing);
    if (found) return found;
  }
  return null;
}

/** JVM imports are dotted package paths under the usual source roots. */
function resolveJvmModule(
  spec: string,
  projectRoot: string,
  config: WatcherConfig,
  language: SourceLanguage,
): string | null {
  for (const [prefix, target] of Object.entries(config.aliases)) {
    if (spec === prefix || spec.startsWith(prefix)) {
      const rest = spec.slice(prefix.length).replace(/^\//, "").split(".").join("/");
      const base = resolve(projectRoot, target, rest);
      return probeLanguage(toPosix(base), LANGUAGE_EXTENSIONS[language], [], 2);
    }
  }
  const roots = [
    join(projectRoot, "src", "main", "java"),
    join(projectRoot, "src", "main", "kotlin"),
    join(projectRoot, "src", "main"),
    join(projectRoot, "src"),
    projectRoot,
  ];
  return resolveDottedModule(spec, roots, LANGUAGE_EXTENSIONS[language], [], 2);
}

/** Rust `crate::` / `self::` / `super::` paths. */
function resolveRustModule(spec: string, fromFileAbs: string, projectRoot: string): string | null {
  const parts = spec.split("::").filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const exts = LANGUAGE_EXTENSIONS.rust;

  if (parts[0] === "crate") {
    const base = join(projectRoot, "src", ...parts.slice(1));
    const found = probeLanguage(toPosix(base), exts, ["mod"], 2)
      ?? probeLanguage(toPosix(join(projectRoot, ...parts.slice(1))), exts, ["mod"], 2);
    return found;
  }

  let dir = dirname(fromFileAbs);
  let index = 0;
  while (parts[index] === "super") {
    dir = dirname(dir);
    index += 1;
  }
  if (parts[index] === "self") index += 1;
  const rest = parts.slice(index);
  const base = rest.length === 0 ? dir : join(dir, ...rest);
  if (!isSubPath(projectRoot, base)) return null;
  return probeLanguage(toPosix(base), exts, ["mod"], 2);
}

/** Go module paths: strip the `go.mod` module prefix, then find a `.go` file. */
function resolveGoModule(spec: string, projectRoot: string): string | null {
  if (spec.length === 0 || spec.startsWith("internal/")) return null;
  const module = readGoModule(projectRoot);
  let rest = spec;
  if (module && spec.startsWith(`${module}/`)) {
    rest = spec.slice(module.length + 1);
  }
  const segments = rest.split("/").filter((s) => s.length > 0);
  for (let i = 0; i < segments.length; i += 1) {
    const dir = join(projectRoot, ...segments.slice(i));
    if (!isDirectory(dir)) continue;
    const file = listFiles(dir).find((f) => f.endsWith(".go"));
    if (file) return join(dir, file);
  }
  return null;
}

function readGoModule(projectRoot: string): string | null {
  const path = join(projectRoot, "go.mod");
  if (!existsSync(path)) return null;
  try {
    const match = readFileSync(path, "utf8").match(/^\s*module\s+(\S+)/m);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
