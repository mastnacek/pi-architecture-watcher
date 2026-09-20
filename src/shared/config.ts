/**
 * Config kernel.
 *
 * Deep module: `loadConfig(projectRoot)` hides defaults, file locations,
 * merge order and validation. Callers only ever see a complete WatcherConfig.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ALL_SOURCE_EXTENSIONS } from "./languages.js";
import { readTextSafe } from "./paths.js";
import {
  ARCHITECTURE_IDS,
  type ArchitectureId,
  type PublicEntryMode,
  type Severity,
  type Mode,
  type WatcherConfig,
} from "./types.js";

export const CONFIG_FILENAME = "architecture-watcher.json";

export const DEFAULT_CONFIG: WatcherConfig = {
  enabled: true,
  mode: "auto",
  roots: [
    "src/features",
    "src/slices",
    "src/modules",
    "src/vertical",
    "src/app",
    "features",
    "slices",
  ],
  sharedRoots: [
    "src/shared",
    "src/common",
    "src/kernel",
    "src/platform",
    "src/core",
    "shared",
    "common",
  ],
  aliases: {},
  sourceExtensions: [...ALL_SOURCE_EXTENSIONS],
  publicEntries: ["index", "public", "api", "__init__"],
  publicEntryMode: "entry-only",
  internalsDirNames: ["internal", "internals", "impl", "lib", "utils", "helpers", "_"],
  maxSliceFanOut: 4,
  maxSharedImports: 6,
  blockAt: "never",
  notifyFrom: "warning",
  watchTools: ["write", "edit"],
  watchToolPatterns: [],
  ignore: [
    "**/*.test.*",
    "**/*.spec.*",
    "**/*.d.ts",
    "**/dist/**",
    "**/node_modules/**",
    "**/*.generated.*",
    "**/coverage/**",
  ],
  injectFixes: true,
  autoFixImports: false,
  statusLine: true,
  architecture: "vsa",
  detectionModel: "jev-latest",
};

const SEVERITIES: readonly Severity[] = ["hint", "warning", "error"];
const MODES: readonly Mode[] = ["auto", "human", "off"];
const ENTRY_MODES: readonly PublicEntryMode[] = ["entry-only", "root-level"];
const ARCHITECTURES: readonly ArchitectureId[] = [...ARCHITECTURE_IDS];

/** Global config path: `~/.pi/agent/architecture-watcher.json`. */
export function globalConfigPath(agentDir?: string): string {
  return join(agentDir ?? join(homedir(), ".pi", "agent"), CONFIG_FILENAME);
}

/** Project config path: `<projectRoot>/.pi/architecture-watcher.json`. */
export function projectConfigPath(projectRoot: string): string {
  return join(projectRoot, ".pi", CONFIG_FILENAME);
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  const raw = readTextSafe(path);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const out = value.filter((v): v is string => typeof v === "string" && v.length > 0);
  return out.length > 0 ? out : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asOneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function asAliases(value: unknown, fallback: Record<string, string>): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : fallback;
}

function asBlockAt(value: unknown, fallback: Severity | "never"): Severity | "never" {
  if (value === undefined || value === null) return fallback;
  if (value === "never") return "never";
  return asOneOf(value, SEVERITIES, fallback === "never" ? "error" : fallback);
}

/** Merge one raw JSON object over a base config, validating every field. */
export function mergeConfig(base: WatcherConfig, raw: Record<string, unknown>): WatcherConfig {
  return {
    enabled: asBoolean(raw.enabled, base.enabled),
    mode: asOneOf(raw.mode, MODES, base.mode),
    roots: asStringArray(raw.roots, base.roots),
    sharedRoots: asStringArray(raw.sharedRoots, base.sharedRoots),
    aliases: asAliases(raw.aliases, base.aliases),
    sourceExtensions: asStringArray(raw.sourceExtensions, base.sourceExtensions),
    publicEntries: asStringArray(raw.publicEntries, base.publicEntries),
    publicEntryMode: asOneOf(raw.publicEntryMode, ENTRY_MODES, base.publicEntryMode),
    internalsDirNames: asStringArray(raw.internalsDirNames, base.internalsDirNames),
    maxSliceFanOut: asNumber(raw.maxSliceFanOut, base.maxSliceFanOut),
    maxSharedImports: asNumber(raw.maxSharedImports, base.maxSharedImports),
    blockAt: asBlockAt(raw.blockAt, base.blockAt),
    notifyFrom: asOneOf(raw.notifyFrom, SEVERITIES, base.notifyFrom),
    watchTools: asStringArray(raw.watchTools, base.watchTools),
    watchToolPatterns: asStringArray(raw.watchToolPatterns, base.watchToolPatterns),
    ignore: asStringArray(raw.ignore, base.ignore),
    injectFixes: asBoolean(raw.injectFixes, base.injectFixes),
    autoFixImports: asBoolean(raw.autoFixImports, base.autoFixImports),
    statusLine: asBoolean(raw.statusLine, base.statusLine),
    architecture: asOneOf(raw.architecture, ARCHITECTURES, base.architecture),
    detectionModel: typeof raw.detectionModel === "string" && raw.detectionModel.length > 0
      ? raw.detectionModel
      : base.detectionModel,
  };
}

/** Load the effective configuration: defaults, then global, then project. */
export function loadConfig(projectRoot: string, agentDir?: string): WatcherConfig {
  let config = DEFAULT_CONFIG;
  const global = readJson(globalConfigPath(agentDir));
  if (global) config = mergeConfig(config, global);
  const project = readJson(projectConfigPath(projectRoot));
  if (project) config = mergeConfig(config, project);
  return config;
}

/** Persist a config to the project `.pi/` directory. */
export function saveProjectConfig(projectRoot: string, config: WatcherConfig): string {
  const path = projectConfigPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return path;
}
