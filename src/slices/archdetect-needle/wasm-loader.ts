/**
 * Needle WASM loader — downloads and initializes the Needle engine.
 *
 * Deep module: handles model download, caching, and WASM instantiation.
 * Pure async, no UI. Returns a ready-to-use `NeedleInstance`.
 */

import { mkdir, writeFile, readFile, access, constants, open } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export interface NeedleInstance {
  /** Run a single detection. Returns structured result or throws. */
  detect(digest: string): Promise<{
    architecture: string;
    confidence: number;
    reasoning: string;
  }>;
  /** Clean up resources. */
  close(): Promise<void>;
}

const NEEDLE_MODEL_URL =
  "https://huggingface.co/Cactus-Compute/needle3/resolve/main/needle3.cact";
const NEEDLE_WASM_URL =
  "https://huggingface.co/Cactus-Compute/needle3/resolve/main/wasm/needle.wasm";
const NEEDLE_JS_URL =
  "https://huggingface.co/Cactus-Compute/needle3/resolve/main/wasm/needle.js";

const CACHE_DIR = join(homedir(), ".cache", "pi-architecture-watcher", "needle");
const MODEL_PATH = join(CACHE_DIR, "needle3.cact");
const WASM_PATH = join(CACHE_DIR, "needle.wasm");
const JS_PATH = join(CACHE_DIR, "needle.js");

/** Download a file with progress callback. */
async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.statusText}`);
  const total = Number(res.headers.get("content-length") ?? "0");
  let downloaded = 0;
  const file = await open(dest, "w");
  try {
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await file.write(value);
      downloaded += value.length;
      onProgress?.(downloaded, total);
    }
  } finally {
    await file.close();
  }
}

/** Ensure Needle assets are downloaded and cached. */
export async function ensureNeedleAssets(
  onProgress?: (stage: string, progress: number) => void,
): Promise<{ modelPath: string; wasmPath: string; jsPath: string }> {
  const assets = [
    { url: NEEDLE_MODEL_URL, path: MODEL_PATH, name: "model (35 MB)" },
    { url: NEEDLE_WASM_URL, path: WASM_PATH, name: "WASM (1 MB)" },
    { url: NEEDLE_JS_URL, path: JS_PATH, name: "JS loader (60 KB)" },
  ];

  for (const asset of assets) {
    try {
      await access(asset.path, constants.F_OK);
      onProgress?.(`Using cached ${asset.name}`, 1);
    } catch {
      onProgress?.(`Downloading ${asset.name}...`, 0);
      await downloadFile(asset.url, asset.path, (d, t) => {
        onProgress?.(`Downloading ${asset.name}`, t > 0 ? d / t : 0);
      });
      onProgress?.(`Downloaded ${asset.name}`, 1);
    }
  }
  return { modelPath: MODEL_PATH, wasmPath: WASM_PATH, jsPath: JS_PATH };
}

/** Load the Needle WASM module and return an instance. */
export async function loadNeedleWasm(
  jsPath: string,
  wasmPath: string,
  modelPath: string,
): Promise<NeedleInstance> {
  // Dynamically import the Emscripten module
  const moduleFactory = await import(jsPath);
  const createNeedle = moduleFactory.default ?? moduleFactory.createNeedle;

  if (typeof createNeedle !== "function") {
    throw new Error("Needle JS module does not export createNeedle");
  }

  // Read model bytes
  const modelBytes = await readFile(modelPath);

  // Create the module instance
  const Module = await createNeedle({
    locateFile: (p: string) => {
      if (p.endsWith(".wasm")) return wasmPath;
      return p;
    },
    // Preload model into FS
    preRun: () => {
      Module.FS.writeFile("/needle3.cact", new Uint8Array(modelBytes));
    },
  });

  // Wait for runtime initialization
  await new Promise<void>((resolve, reject) => {
    Module.onRuntimeInitialized = () => resolve();
    Module.onAbort = (e: unknown) => reject(new Error(`WASM init failed: ${e}`));
  });

  // Get Emscripten string helpers
  const stringToUTF8 = Module.stringToUTF8 ?? Module._malloc;
  const UTF8ToString = Module.UTF8ToString ?? ((ptr: number): string => {
    const bytes = Module.HEAPU8.slice(ptr);
    const nullIdx = bytes.findIndex((b: number) => b === 0);
    if (nullIdx >= 0) return new TextDecoder().decode(bytes.slice(0, nullIdx));
    return "";
  });

  // Initialize Needle engine
  const { SYSTEM_PROMPT, buildNeedleQuestion } = await import("./schema.js");
  const systemPrompt = SYSTEM_PROMPT;
  buildNeedleQuestion(); // validate schema at init
  const toolsJson = JSON.stringify([
    {
      name: "detect_architecture",
      description: "Classify project architecture from topology digest",
      parameters: {
        type: "object",
        properties: {
          architecture: { type: "string", enum: ["vsa", "clean", "hexagonal", "layered", "modular-monolith", "fsd"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reasoning: { type: "string" },
        },
        required: ["architecture", "confidence", "reasoning"],
      },
    },
  ]);

  const initResult = Module._needle_init(
    stringToUTF8(systemPrompt),
    stringToUTF8(toolsJson),
    0, // tool_index_path = null
  );
  if (initResult < 0) {
    const err = Module._needle_last_error();
    throw new Error(`needle_init failed: ${UTF8ToString(err)}`);
  }

  const detect = async (digest: string): Promise<{
    architecture: string;
    confidence: number;
    reasoning: string;
  }> => {
    const outBuf = Module._malloc(65536);
    try {
      const result = Module._needle_complete(
        stringToUTF8(digest),
        512,
        outBuf,
        65536,
      );
      if (result < 0) {
        const err = Module._needle_last_error();
        throw new Error(`needle_complete failed: ${UTF8ToString(err)}`);
      }
      const json = UTF8ToString(outBuf);
      const parsed = JSON.parse(json);
      const calls = parsed.function_calls ?? parsed.suppressed_calls ?? [];
      if (calls.length === 0) {
        throw new Error("Needle returned no function calls");
      }
      const args = calls[0].arguments ?? {};
      return {
        architecture: args.architecture,
        confidence: args.confidence ?? 0,
        reasoning: args.reasoning ?? "",
      };
    } finally {
      Module._free(outBuf);
    }
  };

  const close = async () => {
    Module._needle_reset();
  };

  return { detect, close };
}