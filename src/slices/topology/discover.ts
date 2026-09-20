/**
 * Root discovery — internal to the `topology` slice.
 *
 * Deep module: `discoverRoots(projectRoot, config)` scans the project once and
 * answers "where do the slices and the shared kernel actually live?". This is
 * what lets a detected architecture take effect: a project may nest its layers
 * (e.g. `frontend/src/features`, `backend/app/features`), so the static
 * `config.roots` defaults miss them and the watcher tracks zero slices.
 *
 * Pure-ish: reads the directory tree, writes nothing. Bounded by `MAX_DEPTH`
 * and a skip-list of dependency/build/test directories.
 */

import { join } from "node:path";
import {
  hasSourceExtension,
  listDirs,
  listFiles,
  relPosix,
} from "../../shared/paths.js";
import type { WatcherConfig } from "../../shared/types.js";

/** Directory names that hold one sub-directory per slice. */
const SLICE_ROOT_NAMES = new Set([
  "features",
  "slices",
  "modules",
  "vertical",
  "bounded-contexts",
  "entities",
  "pages",
  "widgets",
  "processes",
  "use-cases",
]);

/** Directory names that form the shared kernel. */
const SHARED_ROOT_NAMES = new Set(["shared", "common", "kernel", "platform", "core"]);

/** Never descend into these. */
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  "site-packages",
  "dist-info",
  ".next",
  ".nuxt",
  "target",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".ruff_cache",
  ".mypy_cache",
  ".cache",
  ".turbo",
  ".idea",
  ".vscode",
  "tmp",
  "temp",
  "test",
  "tests",
  "__tests__",
  "spec",
  "specs",
  "e2e",
  "__mocks__",
]);

const MAX_DEPTH = 6;

export interface DiscoveredRoots {
  /** project-relative POSIX paths of slice roots */
  roots: string[];
  /** project-relative POSIX paths of shared roots */
  sharedRoots: string[];
}

/** True when `absDir` has at least one sub-directory that holds source files. */
function hasSliceChildren(absDir: string, config: WatcherConfig): boolean {
  return listDirs(absDir).some((child) => {
    const files = listFiles(join(absDir, child));
    return files.some((f) => hasSourceExtension(f, config.sourceExtensions));
  });
}

function dedupeSorted(list: string[]): string[] {
  return [...new Set(list)].sort((a, b) => a.localeCompare(b));
}

/** Scan the project tree for slice and shared roots. */
export function discoverRoots(projectRoot: string, config: WatcherConfig): DiscoveredRoots {
  const roots: string[] = [];
  const sharedRoots: string[] = [];

  const walk = (absDir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    for (const name of listDirs(absDir)) {
      if (SKIP_DIR_NAMES.has(name)) continue;
      if (name.startsWith(".")) continue; // dot-dirs: worktrees, .venv*, VCS, caches
      const abs = join(absDir, name);

      if (SLICE_ROOT_NAMES.has(name)) {
        if (hasSliceChildren(abs, config)) roots.push(relPosix(projectRoot, abs));
      } else if (SHARED_ROOT_NAMES.has(name)) {
        sharedRoots.push(relPosix(projectRoot, abs));
      }

      walk(abs, depth + 1);
    }
  };

  walk(projectRoot, 0);
  return { roots: dedupeSorted(roots), sharedRoots: dedupeSorted(sharedRoots) };
}