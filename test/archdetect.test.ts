import { test } from "node:test";
import assert from "node:assert/strict";
import { makeProject } from "./helpers.js";
import {
  buildQuestion,
  callSystemOne,
  criteriaMap,
  decodeDetection,
  detectArchitecture,
  estimateDepth,
  SystemOneError,
  type FetchLike,
} from "../src/slices/archdetect/index.js";
import { ARCHITECTURE_IDS } from "../src/shared/types.js";

test("archdetect: criteriaMap covers every architecture id", () => {
  const keys = Object.keys(criteriaMap()).sort();
  assert.deepEqual(keys, [...ARCHITECTURE_IDS].sort());
});

test("archdetect: builds a single typed architecture question", () => {
  const question = buildQuestion();
  assert.equal(question.type, "choice");
  assert.equal(Object.keys(question.criteria).length, ARCHITECTURE_IDS.length);
});

test("archdetect: estimateDepth flags shallow modules and lists them", () => {
  const project = makeProject({
    "src/features/a/index.ts": "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n",
    "src/features/a/deep.ts":
      "export function work() {\n"
      + "  const x = 1;\n  const y = x + 1;\n  const z = y * 2;\n"
      + "  return z;\n}\n",
  });
  const depth = estimateDepth(project.lookup, project.config);
  assert.equal(depth.sampled, 2);
  assert.equal(depth.shallowFraction, 0.5);
  assert.deepEqual(depth.shallowFiles, ["src/features/a/index.ts"]);
  assert.ok(depth.avgDepth > 0);
});

test("archdetect: decodeDetection maps choice and confidence", () => {
  const d = decodeDetection(
    {
      answers: {
        architecture: { type: "choice", choice: "clean", confidence: 0.9 },
      },
    },
    "digest",
    "vsa",
  );
  assert.equal(d.architecture, "clean");
  assert.equal(d.confidence, 0.9);
});

test("archdetect: decodeDetection falls back on unknown choice", () => {
  const d = decodeDetection(
    { answers: { architecture: { type: "choice", choice: "nonsense" } } },
    "digest",
    "vsa",
  );
  assert.equal(d.architecture, "vsa");
  assert.equal(d.confidence, 0);
});

test("archdetect: detectArchitecture calls the decision model end-to-end", async () => {
  const project = makeProject({
    "src/features/billing/index.ts": "export const billing = 1;\n",
  });
  const fake: FetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: "typesafe/jev-1.13",
      provider: "TypeSafe",
      answers: {
        architecture: { type: "choice", choice: "hexagonal", confidence: 0.88 },
      },
      usage: { input_tokens: 10, output_tokens: 2, cost: 0.0001 },
    }),
    text: async () => "",
  });

  const result = await detectArchitecture(project.lookup, project.config, {
    apiKey: "test",
    fetchImpl: fake,
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.detection.architecture, "hexagonal");
});

test("archdetect: detectArchitecture surfaces network errors, never throws", async () => {
  const project = makeProject({
    "src/features/billing/index.ts": "export const billing = 1;\n",
  });
  const fake: FetchLike = async () => ({
    ok: false,
    status: 401,
    json: async () => ({}),
    text: async () => "unauthorized",
  });
  const result = await detectArchitecture(project.lookup, project.config, {
    apiKey: "test",
    fetchImpl: fake,
  });
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.reason.length > 0);
});

test("archdetect: callSystemOne rejects without an API key", async () => {
  await assert.rejects(
    () => callSystemOne({ model: "jev-latest", state: "", questions: {} }),
    (err: unknown) => err instanceof SystemOneError && /OPENROUTER_API_KEY/.test(err.message),
  );
});