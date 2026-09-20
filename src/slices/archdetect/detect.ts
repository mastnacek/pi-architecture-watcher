/**
 * Architecture detection — turns topology into a Jev decision.
 *
 * Deep module: `detectArchitecture` is the only entry point. It builds a
 * compact text digest of the project's *structure* and asks the decision model
 * one typed `choice` question: which architecture does this follow? The model's
 * only job is that single judgment — each answer carries a `confidence`.
 *
 * Deep vs. shallow modules is a *per-module* static property, not a global
 * judgment a single model call can make over a whole codebase. That is
 * computed here as `estimateDepth` — a file-by-file heuristic — and is kept
 * fully separate from the model path.
 *
 * `detectArchitecture` never rejects: any network/model failure is returned as
 * `{ ok: false, reason }` so the caller stays in control.
 */

import { join } from "node:path";
import { listDirs, listFiles, readTextSafe, relPosix } from "../../shared/paths.js";
import type { ArchitectureId, SliceLookup, WatcherConfig } from "../../shared/types.js";
import { ARCHETYPES, criteriaMap } from "./archetypes.js";
import { callSystemOne, type SystemOneOptions, type SystemOneResponse } from "./systemone.js";

export interface ArchitectureDetection {
  architecture: ArchitectureId;
  /** 0..1 confidence the model assigned to the chosen architecture */
  confidence: number;
  /** the digest text sent to the model (for transparency / debugging) */
  digest: string;
  provider?: string;
  model?: string;
  cost?: number;
}

export type DetectResult =
  | { ok: true; detection: ArchitectureDetection }
  | { ok: false; reason: string };

// --- Static deep/shallow metric (per-module, no model) --------------------

export interface DepthStats {
  sampled: number;
  /** average implementation-lines / interface-signals across sampled files */
  avgDepth: number;
  /** fraction of sampled files judged shallow (big interface, thin body) */
  shallowFraction: number;
  /** project-relative paths of the shallowest modules, most shallow first */
  shallowFiles: string[];
}

const MAX_SAMPLE_FILES = 250;
const MAX_SHALLOW_FILES = 20;
/** a file with at least this many interface signals but little body is "shallow" */
const SHALLOW_MIN_INTERFACE = 2;
const SHALLOW_MAX_DEPTH = 8;

/** Lightweight interface-signal heuristics, one regex per language family. */
const INTERFACE_MARKERS = [
  /\bexport\b/, // TS/JS
  /^\s*(pub|pub\(|pub fn|fn)\b/, // Rust
  /^\s*(def|class)\b/, // Python
  /^\s*(public|private|protected)\b/, // Java/Kotlin
  /^\s*func\b/, // Go
];

function countInterfaceSignals(line: string): number {
  // each marker counts once per matching line; that is enough for a ratio
  return INTERFACE_MARKERS.some((re) => re.test(line)) ? 1 : 0;
}

function isCodeLine(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && !t.startsWith("//") && !t.startsWith("#") && !t.startsWith("*");
}

/**
 * Walk source files under the slice/shared roots and estimate per-module depth.
 *
 * Ousterhout's "deep module" = small interface hiding substantial
 * implementation. This approximates that ratio per file: an exported/public
 * symbol is a unit of interface, a code line is a unit of implementation. A
 * file with several exports but few lines of body is "shallow" (thin wrapper).
 */
export function estimateDepth(
  lookup: SliceLookup,
  config: WatcherConfig,
): DepthStats {
  const seen = new Set<string>();
  const queue: string[] = [];

  for (const slice of lookup.slices()) queue.push(slice.dir);
  for (const shared of lookup.sharedRoots()) queue.push(join(lookup.root, shared));

  let sampled = 0;
  let totalDepth = 0;
  let shallow = 0;
  const shallowFiles: string[] = [];
  const shallowDepths: { rel: string; depth: number }[] = [];

  const visit = (dir: string): void => {
    if (sampled >= MAX_SAMPLE_FILES) return;
    for (const f of listFiles(dir)) {
      if (sampled >= MAX_SAMPLE_FILES) return;
      if (!config.sourceExtensions.some((ext) => f.endsWith(ext))) continue;
      const abs = join(dir, f);
      if (seen.has(abs)) continue;
      seen.add(abs);

      const content = readTextSafe(abs);
      if (content === null) continue;
      const lines = content.split("\n");
      let interfaceSignals = 0;
      let implLines = 0;
      for (const line of lines) {
        interfaceSignals += countInterfaceSignals(line);
        if (isCodeLine(line)) implLines += 1;
      }
      if (interfaceSignals === 0 && implLines === 0) continue;

      sampled += 1;
      const depth = interfaceSignals === 0 ? implLines : implLines / interfaceSignals;
      totalDepth += depth;
      if (interfaceSignals >= SHALLOW_MIN_INTERFACE && depth < SHALLOW_MAX_DEPTH) {
        shallow += 1;
        shallowDepths.push({ rel: relPosix(lookup.root, abs), depth });
      }
    }
    for (const sub of listDirs(dir)) visit(join(dir, sub));
  };

  for (const root of queue) visit(root);

  // most shallow first (lowest impl-per-interface ratio)
  shallowDepths.sort((a, b) => a.depth - b.depth);
  for (const entry of shallowDepths) {
    if (shallowFiles.length >= MAX_SHALLOW_FILES) break;
    shallowFiles.push(entry.rel);
  }

  return {
    sampled,
    avgDepth: sampled === 0 ? 0 : totalDepth / sampled,
    shallowFraction: sampled === 0 ? 0 : shallow / sampled,
    shallowFiles,
  };
}

// --- Model path: architecture only ----------------------------------------

/** Build the compact, structure-only digest sent as the model's `state`. */
export function buildStateDigest(lookup: SliceLookup, config: WatcherConfig): string {
  const lines: string[] = [];
  lines.push(`slice roots (configured): ${config.roots.join(", ") || "none"}`);
  lines.push(`shared roots (configured): ${config.sharedRoots.join(", ") || "none"}`);
  const slices = lookup.slices();
  lines.push(`discovered slices (${slices.length}):`);
  for (const s of slices) {
    const rel = relPosix(lookup.root, s.dir);
    lines.push(`  - ${rel} (publicEntry=${s.hasPublicEntry ? "yes" : "no"})`);
  }
  return lines.join("\n");
}

/** The single typed question this model answers: which architecture? */
export function buildQuestion(): { type: "choice"; instructions: string; criteria: Record<string, string> } {
  return {
    type: "choice",
    instructions: "Which architecture does this project's structure most closely follow?",
    criteria: criteriaMap() as Record<string, string>,
  };
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/** Decode the decision response into a typed detection, with safe fallbacks. */
export function decodeDetection(
  response: SystemOneResponse,
  digest: string,
  fallback: ArchitectureId,
): ArchitectureDetection {
  const answer = response.answers["architecture"];

  let architecture: ArchitectureId = fallback;
  let confidence = 0;
  if (answer?.choice && ARCHETYPES.some((a) => a.id === answer.choice)) {
    architecture = answer.choice as ArchitectureId;
    confidence = clamp01(answer.confidence ?? 0);
  }

  return {
    architecture,
    confidence,
    digest,
    provider: response.provider,
    model: response.model,
    cost: response.usage?.cost,
  };
}

export interface DetectOptions extends SystemOneOptions {
  /** override the fallback architecture used when the model answer is missing */
  fallback?: ArchitectureId;
}

/** Run architecture detection end-to-end. Never throws; network errors become `ok:false`. */
export async function detectArchitecture(
  lookup: SliceLookup,
  config: WatcherConfig,
  options: DetectOptions = {},
): Promise<DetectResult> {
  const digest = buildStateDigest(lookup, config);
  const fallback = options.fallback ?? config.architecture;

  try {
    const response = await callSystemOne(
      {
        model: config.detectionModel,
        state: digest,
        questions: { architecture: buildQuestion() },
      },
      options,
    );
    return { ok: true, detection: decodeDetection(response, digest, fallback) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason };
  }
}