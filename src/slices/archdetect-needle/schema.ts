/**
 * Needle architecture detection schema.
 *
 * Deep module: the single typed choice question Needle answers.
 * Mirrors the Jev `criteriaMap` so both engines share the same taxonomy.
 */

import type { ArchitectureId } from "../../shared/types.js";
import { ARCHITECTURE_IDS } from "../../shared/types.js";
import { ARCHETYPES } from "../../shared/archdetect.js";

/** The exact enum Needle will choose from. */
export const DETECTION_SCHEMA = {
  type: "object",
  properties: {
    architecture: {
      type: "string",
      enum: ARCHITECTURE_IDS,
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reasoning: { type: "string" },
  },
  required: ["architecture", "confidence", "reasoning"],
  additionalProperties: false,
} as const;

/** TypeScript type inferred from the schema. */
export type DetectionResult = {
  architecture: ArchitectureId;
  confidence: number;
  reasoning: string;
};

/** Build the single choice question for Needle. */
export function buildNeedleQuestion(): {
  type: "choice";
  instructions: string;
  criteria: Record<ArchitectureId, string>;
} {
  return {
    type: "choice",
    instructions:
      "Analyze this project's directory structure and import patterns. Which architecture does it most closely follow?",
    criteria: ARCHETYPES.reduce(
      (acc, a) => {
        acc[a.id] = a.criteria;
        return acc;
      },
      {} as Record<ArchitectureId, string>,
    ),
  };
}

/** System prompt for Needle architecture detection. */
export const SYSTEM_PROMPT = `
You are an expert software architect. Your task is to classify a project's architecture based solely on its directory structure and slice topology.

You will receive a compact text digest describing:
- Configured slice roots and shared roots
- Discovered slices with their public entry status

Choose the single architecture that best matches the observed structure. Output your choice with a confidence score (0..1) and brief reasoning.

Architecture definitions:
${ARCHETYPES.map((a) => `- ${a.id}: ${a.criteria}`).join("\n")}

Only output the structured result. No extra commentary.
`.trim();