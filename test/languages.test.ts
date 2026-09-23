/**
 * Multi-language scanning + resolution: Python, Rust, Java, Kotlin, Go.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { languageOf } from "../src/shared/languages.js";
import { resolveImport } from "../src/shared/paths.js";
import { scanImports } from "../src/slices/scan/index.js";
import { makeProject } from "./helpers.js";
import type { ImportEdge } from "../src/shared/types.js";

function specs(source: string, language: Parameters<typeof scanImports>[1]): string[] {
  return scanImports(source, language).map((e) => e.specifier);
}

function edge(specifier: string): ImportEdge {
  return { specifier, kind: "static", line: 1, column: 1 };
}

test("languageOf maps every supported extension", () => {
  assert.equal(languageOf("a/b.py"), "python");
  assert.equal(languageOf("a/b.pyi"), "python");
  assert.equal(languageOf("a/b.rs"), "rust");
  assert.equal(languageOf("a/B.java"), "java");
  assert.equal(languageOf("a/B.kt"), "kotlin");
  assert.equal(languageOf("a/b.go"), "go");
  assert.equal(languageOf("a/b.ts"), "typescript");
  assert.equal(languageOf("a/b.md"), "unknown");
});

test("scan: python absolute, dotted and relative imports", () => {
  const source = [
    "import os",
    "import a.b.c",
    "from a.b import c",
    "from . import sibling",
    "from .pkg import thing",
    "from ..up.mod import x",
    "# from .commented import y",
  ].join("\n");
  assert.deepEqual(specs(source, "python"), [
    "os",
    "a.b.c",
    "a.b",
    "./",
    "./pkg",
    "../up/mod",
  ]);
});

test("scan: rust use paths and mod declarations", () => {
  const source = [
    "use crate::features::billing::Invoice;",
    "use super::sibling::{A, B};",
    "use std::collections::HashMap;",
    "mod helper;",
    "// use ignored::path;",
  ].join("\n");
  assert.deepEqual(specs(source, "rust"), [
    "crate::features::billing::Invoice",
    "super::sibling",
    "std::collections::HashMap",
    "self::helper",
  ]);
});

test("scan: java imports, static and wildcard", () => {
  const source = [
    "package com.example;",
    "import java.util.List;",
    "import static org.junit.Assert.assertThat;",
    "import com.example.billing.Invoice;",
    "/* import ignored.Klass; */",
  ].join("\n");
  assert.deepEqual(specs(source, "java"), [
    "java.util.List",
    "org.junit.Assert.assertThat",
    "com.example.billing.Invoice",
  ]);
});

test("scan: kotlin imports with wildcard and alias", () => {
  const source = [
    "import com.example.billing.Invoice",
    "import com.example.shared.*",
    "import com.example.util as u",
  ].join("\n");
  assert.deepEqual(specs(source, "kotlin"), [
    "com.example.billing.Invoice",
    "com.example.shared",
    "com.example.util",
  ]);
});

test("scan: go single and block imports", () => {
  const source = [
    'import "fmt"',
    "import (",
    '\tbilling "github.com/me/proj/features/billing"',
    '\t_ "github.com/me/proj/features/audit"',
    ")",
  ].join("\n");
  assert.deepEqual(specs(source, "go"), [
    "fmt",
    "github.com/me/proj/features/billing",
    "github.com/me/proj/features/audit",
  ]);
});

const norm = (p: string | null) => (p ? p.replace(/\\/g, "/") : null);

test("resolve: python relative and absolute dotted modules", () => {
  const project = makeProject({
    "src/shared/money.py": "",
    "src/slices/billing/__init__.py": "",
    "src/slices/billing/invoice.py": "",
  });
  const from = join(project.root, "src/slices/billing/__init__.py");
  assert.equal(
    norm(resolveImport(edge("./invoice"), from, project.root, project.config, "python")),
    norm(join(project.root, "src/slices/billing/invoice.py")),
  );
  assert.equal(
    norm(resolveImport(edge("shared.money"), from, project.root, project.config, "python")),
    norm(join(project.root, "src/shared/money.py")),
  );
});

test("resolve: rust crate/self/super modules", () => {
  const project = makeProject({
    "src/main.rs": "",
    "src/features/billing/mod.rs": "",
    "src/features/billing/receipt.rs": "",
  });
  const from = join(project.root, "src/features/billing/receipt.rs");
  assert.equal(
    norm(resolveImport(edge("crate::features::billing::Invoice"), from, project.root, project.config, "rust")),
    norm(join(project.root, "src/features/billing/mod.rs")),
  );
  assert.equal(
    norm(resolveImport(edge("self::receipt"), from, project.root, project.config, "rust")),
    norm(join(project.root, "src/features/billing/receipt.rs")),
  );
  assert.equal(
    norm(resolveImport(edge("super::billing::receipt"), from, project.root, project.config, "rust")),
    norm(join(project.root, "src/features/billing/receipt.rs")),
  );
});

test("resolve: java and kotlin package paths", () => {
  const project = makeProject({
    "src/main/java/com/example/billing/Invoice.java": "",
    "src/main/kotlin/com/example/billing/Invoice.kt": "",
  });
  const fromJava = join(project.root, "src/main/java/com/example/App.java");
  assert.equal(
    norm(resolveImport(edge("com.example.billing.Invoice"), fromJava, project.root, project.config, "java")),
    norm(join(project.root, "src/main/java/com/example/billing/Invoice.java")),
  );
  assert.equal(
    norm(resolveImport(edge("com.example.billing.Invoice"), fromJava, project.root, project.config, "kotlin")),
    norm(join(project.root, "src/main/kotlin/com/example/billing/Invoice.kt")),
  );
});

test("resolve: go module path via go.mod", () => {
  const project = makeProject({
    "go.mod": "module github.com/me/proj\n\ngo 1.22\n",
    "features/billing/billing.go": "",
  });
  assert.equal(
    norm(resolveImport(
      edge("github.com/me/proj/features/billing"),
      join(project.root, "features/audit/audit.go"),
      project.root,
      project.config,
      "go",
    )),
    norm(join(project.root, "features/billing/billing.go")),
  );
});