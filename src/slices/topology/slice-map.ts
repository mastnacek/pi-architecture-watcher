/**
 * Slice topology — internal to the `topology` slice.
 *
 * Deep module: `buildSliceMap(projectRoot, config)` turns a directory tree
 * plus a config into a `SliceLookup` that answers every structural question the
 * rules need (`sliceOf`, `sharedOf`, `isPublicEntry`, `publicEntryPath`).
 *
 * Discovery rules:
 *  - every immediate sub-directory of a configured slice root is a slice
 *  - a sub-directory that has no source files of its own but has children is a
 *    *group* (e.g. `features/admin/`), and its children become slices instead
 *  - a slice's public surface is `index` / `public` / `api` / `<sliceName>`
 *  - `entry-only` keeps internals private; `root-level` publishes all
 *    root-level slice files but still hides `internal/`, `lib/`, `utils/`, …
 */

import { basename, dirname, join, resolve } from "node:path";
import {
  hasSourceExtension,
  isDirectory,
  isSubPath,
  listDirs,
  listFiles,
  relPosix,
  stripExtension,
} from "../../shared/paths.js";
import type { SliceLookup, SliceRef, WatcherConfig } from "../../shared/types.js";

const NO_SLICE: null = null;

interface DirInfo {
  hasSource: boolean;
  subdirs: string[];
}

function inspect(absDir: string, config: WatcherConfig): DirInfo {
  const files = listFiles(absDir);
  return {
    hasSource: files.some((f) => hasSourceExtension(f, config.sourceExtensions)),
    subdirs: listDirs(absDir),
  };
}

/** Absolute path of a slice's public entry file, or `null`. */
function findPublicEntry(
  sliceDir: string,
  sliceName: string,
  config: WatcherConfig,
): string | null {
  const names = [...config.publicEntries, sliceName];
  for (const name of names) {
    for (const ext of config.sourceExtensions) {
      const candidate = join(sliceDir, `${name}${ext}`);
      if (isDirectory(sliceDir) && listFiles(sliceDir).includes(`${name}${ext}`)) {
        return candidate;
      }
    }
  }
  return null;
}

/** Register slices discovered under one absolute slice root. */
function collectSlices(
  projectRoot: string,
  rootAbs: string,
  config: WatcherConfig,
  out: SliceRef[],
): void {
  for (const child of listDirs(rootAbs)) {
    const childAbs = join(rootAbs, child);
    const info = inspect(childAbs, config);

    const isGroup = !info.hasSource && info.subdirs.length > 0;
    if (isGroup) {
      for (const grandChild of info.subdirs) {
        const grandAbs = join(childAbs, grandChild);
        if (!inspect(grandAbs, config).hasSource) {
          // deeper groups are ignored; keeps discovery predictable
          continue;
        }
        out.push(makeSlice(projectRoot, grandAbs, grandChild, config));
      }
      continue;
    }

    out.push(makeSlice(projectRoot, childAbs, child, config));
  }
}

function makeSlice(
  projectRoot: string,
  dir: string,
  name: string,
  config: WatcherConfig,
): SliceRef {
  const entry = findPublicEntry(dir, name, config);
  return {
    id: name,
    dir,
    root: relPosix(projectRoot, dirname(dir)),
    hasPublicEntry: entry !== null,
  };
}

/** Ensure slice ids are unique; fall back to the project-relative path. */
function disambiguate(projectRoot: string, slices: SliceRef[]): SliceRef[] {
  const counts = new Map<string, number>();
  for (const slice of slices) counts.set(slice.id, (counts.get(slice.id) ?? 0) + 1);
  return slices.map((slice) =>
    (counts.get(slice.id) ?? 0) > 1
      ? { ...slice, id: relPosix(projectRoot, slice.dir) }
      : slice,
  );
}

/** Build the read-only topology view for a project. */
export function buildSliceMap(projectRoot: string, config: WatcherConfig): SliceLookup {
  const root = resolve(projectRoot);

  const slices: SliceRef[] = [];
  for (const rel of config.roots) {
    const abs = resolve(root, rel);
    if (isDirectory(abs)) collectSlices(root, abs, config, slices);
  }
  const uniqueSlices = disambiguate(root, slices).sort((a, b) => b.dir.length - a.dir.length);

  const sharedAbs = config.sharedRoots
    .map((rel) => resolve(root, rel))
    .filter((abs) => isDirectory(abs))
    .sort((a, b) => b.length - a.length);

  const sliceCache = new Map<string, SliceRef | null>();
  const sharedCache = new Map<string, string | null>();

  const sliceOf = (absPath: string): SliceRef | null => {
    const cached = sliceCache.get(absPath);
    if (cached !== undefined) return cached;
    const hit = uniqueSlices.find((s) => isSubPath(s.dir, absPath)) ?? NO_SLICE;
    sliceCache.set(absPath, hit);
    return hit;
  };

  const sharedOf = (absPath: string): string | null => {
    const cached = sharedCache.get(absPath);
    if (cached !== undefined) return cached;
    const hit = sharedAbs.find((s) => isSubPath(s, absPath)) ?? null;
    const id = hit ? relPosix(root, hit) : null;
    sharedCache.set(absPath, id);
    return id;
  };

  const isPublicEntry = (absPath: string, slice: SliceRef): boolean => {
    if (!isSubPath(slice.dir, absPath)) return false;
    const rel = relPosix(slice.dir, absPath);
    const segments = rel.split("/");
    const dirPart = segments.slice(0, -1);
    const file = segments[segments.length - 1] ?? "";
    const name = stripExtension(file);

    if (dirPart.some((segment) => config.internalsDirNames.includes(segment))) return false;
    if (dirPart.length > 0) return false; // only slice-root files can be public

    if (config.publicEntryMode === "root-level") return true;
    return [...config.publicEntries, slice.id].includes(name);
  };

  const publicEntryPath = (slice: SliceRef): string | null =>
    findPublicEntry(slice.dir, basename(slice.dir), config);

  return {
    root,
    sliceOf,
    sharedOf,
    isPublicEntry,
    publicEntryPath,
    slices: () => uniqueSlices,
    sharedRoots: () => sharedAbs.map((abs) => relPosix(root, abs)),
  };
}
