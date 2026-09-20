import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { makeProject } from "./helpers.js";
import { discoverRoots } from "../src/slices/topology/index.js";

const base = {
  "src/features/billing/index.ts": "export const billing = 1;\n",
  "src/features/billing/internal/charge.ts": "export const charge = 1;\n",
  "src/features/invoicing/index.ts": "export const invoicing = 1;\n",
  "src/features/admin/users/index.ts": "export const users = 1;\n",
  "src/shared/money.ts": "export const money = 1;\n",
};

test("topology: discovers slices, groups and shared roots", () => {
  const project = makeProject(base);
  const ids = project.lookup.slices().map((s) => s.id).sort();
  assert.deepEqual(ids, ["billing", "invoicing", "users"]);
  assert.deepEqual(project.lookup.sharedRoots(), ["src/shared"]);
});

test("topology: sliceOf resolves the owning slice", () => {
  const project = makeProject(base);
  const file = join(project.root, "src/features/billing/internal/charge.ts");
  assert.equal(project.lookup.sliceOf(file)?.id, "billing");
  assert.equal(project.lookup.sliceOf(join(project.root, "src/shared/money.ts")), null);
});

test("topology: sharedOf resolves the shared root", () => {
  const project = makeProject(base);
  const file = join(project.root, "src/shared/money.ts");
  assert.equal(project.lookup.sharedOf(file), "src/shared");
});

test("topology: entry-only mode hides internals", () => {
  const project = makeProject(base);
  const billing = project.lookup.slices().find((s) => s.id === "billing")!;
  const entry = join(project.root, "src/features/billing/index.ts");
  const internals = join(project.root, "src/features/billing/internal/charge.ts");
  assert.equal(project.lookup.isPublicEntry(entry, billing), true);
  assert.equal(project.lookup.isPublicEntry(internals, billing), false);
});

test("topology: publicEntryPath finds the slice entry", () => {
  const project = makeProject(base);
  const invoicing = project.lookup.slices().find((s) => s.id === "invoicing")!;
  assert.equal(
    project.lookup.publicEntryPath(invoicing),
    join(project.root, "src/features/invoicing/index.ts"),
  );
});

test("topology: root-level mode publishes slice root files", () => {
  const project = makeProject(base, { publicEntryMode: "root-level" });
  const billing = project.lookup.slices().find((s) => s.id === "billing")!;
  const rootFile = join(project.root, "src/features/billing/index.ts");
  const internals = join(project.root, "src/features/billing/internal/charge.ts");
  assert.equal(project.lookup.isPublicEntry(rootFile, billing), true);
  assert.equal(project.lookup.isPublicEntry(internals, billing), false);
});

test("topology: discovers nested slice and shared roots", () => {
  const project = makeProject({
    "frontend/src/features/auth/index.ts": "export const a = 1;\n",
    "frontend/src/shared/lib.ts": "export const b = 1;\n",
    "backend/app/features/billing/index.ts": "export const c = 1;\n",
    "backend/app/shared/util.py": "x = 1\n",
  });
  const found = discoverRoots(project.root, project.config);
  assert.deepEqual(found.roots, ["backend/app/features", "frontend/src/features"]);
  assert.deepEqual(found.sharedRoots, ["backend/app/shared", "frontend/src/shared"]);
});

test("topology: discovery ignores test dirs and childless slice dirs", () => {
  const project = makeProject({
    "src/features/empty/README.md": "# nothing\n",
    "tests/features/a/index.ts": "export const a = 1;\n",
    ".venv/lib/site-packages/pack/common/x.py": "x = 1\n",
    ".hidden/features/b/index.ts": "export const b = 1;\n",
  });
  const found = discoverRoots(project.root, project.config);
  assert.deepEqual(found.roots, []);
  assert.deepEqual(found.sharedRoots, []);
});
