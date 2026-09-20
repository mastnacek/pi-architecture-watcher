import { test } from "node:test";
import assert from "node:assert/strict";
import { scanImports } from "../src/slices/scan/index.js";

test("scan: static, type-only, side-effect and named imports", () => {
  const edges = scanImports(
    [
      `import { a } from "./a.js";`,
      `import type { B } from "./b.js";`,
      `import "./polyfill.js";`,
      `import * as ns from "./ns.js";`,
    ].join("\n"),
  );
  assert.deepEqual(
    edges.map((e) => [e.specifier, e.kind]),
    [
      ["./a.js", "static"],
      ["./b.js", "type"],
      ["./polyfill.js", "side-effect"],
      ["./ns.js", "static"],
    ],
  );
});

test("scan: re-exports, dynamic import and require", () => {
  const edges = scanImports(
    [
      `export { x } from "./x.js";`,
      `export * from "./y.js";`,
      `const lazy = await import("./lazy.js");`,
      `const legacy = require("./legacy.js");`,
    ].join("\n"),
  );
  assert.deepEqual(
    edges.map((e) => [e.specifier, e.kind]),
    [
      ["./x.js", "export"],
      ["./y.js", "export"],
      ["./lazy.js", "dynamic"],
      ["./legacy.js", "require"],
    ],
  );
});

test("scan: multi-line named import is one edge", () => {
  const edges = scanImports(`import {\n  alpha,\n  beta,\n} from "./multi.js";\n`);
  assert.equal(edges.length, 1);
  assert.equal(edges[0]!.specifier, "./multi.js");
});

test("scan: ignores comments, strings and non-edges", () => {
  const edges = scanImports(
    [
      `// import { fake } from "./comment.js";`,
      `const s = "import { fake2 } from './string.js'";`,
      `/* import { fake3 } from "./block.js"; */`,
      `obj.require("./method.js");`,
      `console.log(import.meta.url);`,
    ].join("\n"),
  );
  assert.deepEqual(edges, []);
});

test("scan: does not treat template interpolation as code", () => {
  const edges = scanImports("const message = `prefix ${value} suffix`;\n");
  assert.deepEqual(edges, []);
});

test("scan: reports the line of the specifier", () => {
  const edges = scanImports(`const a = 1;\nimport { b } from "./b.js";\n`);
  assert.equal(edges.length, 1);
  assert.equal(edges[0]!.line, 2);
});
