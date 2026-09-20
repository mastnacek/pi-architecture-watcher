import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFile } from "../src/slices/classify/index.js";
import { makeProject } from "./helpers.js";

const base = {
  "src/features/billing/index.ts": "export const billing = 1;\n",
  "src/features/billing/charge.ts": "export const charge = 1;\n",
  "src/features/invoicing/index.ts": "export const invoicing = 1;\n",
  "src/features/invoicing/internal.ts": "export const internal = 1;\n",
  "src/shared/money.ts": "export const money = 1;\n",
};

test("classify: deep cross-slice import is an error with a fix", () => {
  const project = makeProject(base);
  const report = classifyFile(
    project.facts(
      "src/features/billing/charge.ts",
      `import { internal } from "../invoicing/internal.js";\nexport const c = internal;\n`,
    ),
  );
  const rule = report.findings.find((f) => f.rule === "cross-slice-deep-import");
  assert.ok(rule, "expected cross-slice-deep-import");
  assert.equal(rule.severity, "error");
  assert.equal(rule.line, 1);
  assert.equal(rule.fix, "../invoicing/index.js");
  assert.equal(report.verdict, "violation");
  assert.ok(report.score >= 40);
});

test("classify: import through the public entry is clean", () => {
  const project = makeProject(base);
  const report = classifyFile(
    project.facts(
      "src/features/billing/charge.ts",
      `import { invoicing } from "../invoicing/index.js";\nexport const c = invoicing;\n`,
    ),
  );
  assert.deepEqual(report.findings, []);
  assert.equal(report.verdict, "clean");
  assert.equal(report.score, 0);
});

test("classify: shared kernel importing a slice is an error", () => {
  const project = makeProject(base);
  const report = classifyFile(
    project.facts(
      "src/shared/money.ts",
      `import { billing } from "../features/billing/index.js";\nexport const m = billing;\n`,
    ),
  );
  const rule = report.findings.find((f) => f.rule === "shared-depends-on-slice");
  assert.ok(rule, "expected shared-depends-on-slice");
  assert.equal(rule.severity, "error");
});

test("classify: domain logic outside its slice is a warning", () => {
  const project = makeProject(base);
  const report = classifyFile(
    project.facts("src/billing-service.ts", "export const service = 1;\n"),
  );
  const rule = report.findings.find((f) => f.rule === "orphan-domain-file");
  assert.ok(rule, "expected orphan-domain-file");
  assert.equal(rule.severity, "warning");
  assert.equal(report.verdict, "violation");
});

test("classify: excessive slice fan-out is a warning", () => {
  const peers: Record<string, string> = {};
  for (const name of ["a", "b", "c", "d", "e"]) {
    peers[`src/features/${name}/index.ts`] = `export const ${name} = 1;\n`;
  }
  const imports = ["a", "b", "c", "d", "e"]
    .map((n, i) => `import { ${n} } from "../${n}/index.js";`)
    .join("\n");
  const project = makeProject({
    ...peers,
    "src/features/orders/index.ts": "export const orders = 1;\n",
    "src/features/orders/place.ts": `${imports}\nexport const t = [a, b, c, d, e];\n`,
  });
  const report = classifyFile(
    project.facts("src/features/orders/place.ts"),
  );
  const rule = report.findings.find((f) => f.rule === "slice-fan-out");
  assert.ok(rule, "expected slice-fan-out");
  assert.equal(rule.severity, "warning");
});

test("classify: two-way slice dependency is a cycle error", () => {
  const project = makeProject({
    "src/features/billing/index.ts": "export const billing = 1;\n",
    "src/features/billing/charge.ts": "import { inv } from '../invoicing/index.js';\nexport const c = inv;\n",
    "src/features/invoicing/index.ts": "import { billing } from '../billing/index.js';\nexport const inv = billing;\n",
  });
  const report = classifyFile(project.facts("src/features/billing/charge.ts"));
  const rule = report.findings.find((f) => f.rule === "cross-slice-cycle");
  assert.ok(rule, "expected cross-slice-cycle");
  assert.equal(rule.severity, "error");
});
