/**
 * Self-check — the watcher analyses its own source tree.
 *
 * This is the strongest available regression test: the plugin is written as
 * vertical slices, so its own rules must find no `error`-level violation in it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { resolveImport } from "../src/shared/paths.js";
import { scanImports } from "../src/slices/scan/index.js";
import { buildSliceMap } from "../src/slices/topology/index.js";
import { classifyFile } from "../src/slices/classify/index.js";
import type { FileFacts, Report } from "../src/shared/types.js";

/** Walk up until the package root is found. */
function findProjectRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i += 1) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name?: string;
      };
      if (pkg.name === "pi-architecture-watcher") return dir;
    } catch {
      // keep walking
    }
    dir = resolve(dir, "..");
  }
  throw new Error(`project root not found from ${start}`);
}

function collect(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) collect(abs, out);
    else if (entry.name.endsWith(".ts")) out.push(abs);
  }
  return out;
}

test("self: the plugin is VSA-clean by its own rules", () => {
  const root = findProjectRoot(dirname(fileURLToPath(import.meta.url)));
  const config = DEFAULT_CONFIG;
  const lookup = buildSliceMap(root, config);

  const files = [
    join(root, "index.ts"),
    ...collect(join(root, "src"), []),
  ];

  assert.ok(files.length >= 12, `expected to scan the plugin sources, got ${files.length}`);

  const reports: Report[] = files.map((abs) => {
    const content = readFileSync(abs, "utf8");
    const facts: FileFacts = {
      file: { path: abs, rel: abs.slice(root.length + 1), content },
      imports: scanImports(content),
      slice: lookup.sliceOf(abs),
      shared: lookup.sharedOf(abs),
      lookup,
      config,
      projectRoot: root,
      resolve: (edge) => resolveImport(edge, abs, root, config),
    };
    return classifyFile(facts);
  });

  const errors = reports.flatMap((r) =>
    r.findings
      .filter((f) => f.severity === "error")
      .map((f) => `${f.file}:${f.line ?? 0} ${f.rule} — ${f.detail}`),
  );

  assert.deepEqual(errors, [], `unexpected VSA errors in the plugin itself:\n${errors.join("\n")}`);
});