/**
 * Test fixture builder — scaffolds a throwaway project on disk and hands back
 * ready-to-use `FileFacts`. Kept outside `src/` so no slice depends on it.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_CONFIG, mergeConfig } from "../src/shared/config.js";
import { resolveImport } from "../src/shared/paths.js";
import { scanImports } from "../src/slices/scan/index.js";
import { buildSliceMap } from "../src/slices/topology/index.js";
import type { FileFacts, WatcherConfig } from "../src/shared/types.js";

export interface Fixture {
  root: string;
  config: WatcherConfig;
  lookup: ReturnType<typeof buildSliceMap>;
  facts(relPath: string, content?: string): FileFacts;
}

export function makeProject(
  files: Record<string, string>,
  overrides: Partial<WatcherConfig> = {},
): Fixture {
  const root = mkdtempSync(join(tmpdir(), "vsa-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }

  const config = mergeConfig(DEFAULT_CONFIG, overrides as Record<string, unknown>);
  const lookup = buildSliceMap(root, config);

  const facts = (relPath: string, content?: string): FileFacts => {
    const abs = join(root, relPath);
    const source = content ?? readFileSync(abs, "utf8");
    return {
      file: { path: abs, rel: relPath, content: source },
      imports: scanImports(source),
      slice: lookup.sliceOf(abs),
      shared: lookup.sharedOf(abs),
      lookup,
      config,
      projectRoot: root,
      resolve: (edge) => resolveImport(edge, abs, root, config),
    };
  };

  return { root, config, lookup, facts };
}
