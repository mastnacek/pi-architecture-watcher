/**
 * Hexagonal / Ports & Adapters rules — domain core with inbound/outbound ports.
 *
 * Deep module: domain is the center. Inbound ports (driving) are implemented by
 * adapters; outbound ports (driven) are implemented by secondary adapters.
 * Domain never knows about adapters.
 */

import { baseName, relPosix, stripExtension } from "../../../shared/paths.js";
import type { EnrichedFacts } from "../enrich.js";
import type { Rule, ArchitectureRuleSet } from "./types.js";
import type { Finding } from "../../../shared/types.js";

const HEX_LAYERS = ["domain", "application", "ports", "adapters", "inbound", "outbound"] as const;
type HexLayer = typeof HEX_LAYERS[number] | string;

function hexLayerOf(path: string): HexLayer {
  const rel = path.split("/")[0] ?? "";
  return (HEX_LAYERS.find((l) => rel.startsWith(l)) ?? rel) as HexLayer;
}

function layerRank(layer: HexLayer): number {
  const order: HexLayer[] = ["domain", "application", "ports", "inbound", "outbound", "adapters"];
  const idx = order.indexOf(layer as typeof order[number]);
  return idx >= 0 ? idx : 50;
}

function finding(
  rule: string,
  severity: Finding["severity"],
  facts: EnrichedFacts,
  title: string,
  detail: string,
  suggestion: string,
  line?: number,
): Finding {
  const out: Finding = { rule, severity, file: facts.file.rel, title, detail, suggestion };
  if (line !== undefined) out.line = line;
  return out;
}

// R1 — domain knows about adapters (forbidden)
function domainKnowsAdapters(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileLayer = hexLayerOf(facts.file.rel);
  if (fileLayer !== "domain") return out;

  for (const dep of facts.dependencies) {
    if (!dep.target) continue;
    const targetLayer = hexLayerOf(relPosix(facts.projectRoot, dep.target));
    if (targetLayer === "adapters" || targetLayer === "inbound" || targetLayer === "outbound") {
      out.push(
        finding(
          "hex-domain-knows-adapters",
          "error",
          facts,
          `Doména zná adaptéry: \`${targetLayer}\``,
          `\`${facts.file.rel}\` (domain) importuje \`${dep.edge.specifier}\` z \`${targetLayer}\` (řádek ${dep.edge.line}). `
            + `Doména nesmí vědět o adaptérech — jen o portech.`,
          `Vytáhni port (interface) do \`domain/ports\` nebo \`application/ports\`, implementuj v adaptérech.`,
          dep.edge.line,
        ),
      );
    }
  }
  return out;
}

// R2 — port in wrong place
function portInWrongPlace(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileLayer = hexLayerOf(facts.file.rel);

  const content = facts.file.content;
  const isPort = /\binterface\s+\w+(Port|Inbound|Outbound)\b/.test(content)
    || /\bexport\s+interface\s+\w+Port\b/.test(content);

  if (isPort) {
    if (fileLayer === "adapters" || fileLayer === "inbound" || fileLayer === "outbound") {
      out.push(
        finding(
          "hex-port-in-adapter",
          "error",
          facts,
          `Port v adapéru: \`${fileLayer}\``,
          `\`${facts.file.rel}\` definuje port/interface v \`${fileLayer}\`. `
            + `Porty patří do \`domain/ports\` nebo \`application/ports\`.`,
          `Přesuň port do \`domain/ports/\` (doménový port) nebo \`application/ports/\` (use-case port).`,
        ),
      );
    } else if (fileLayer !== "domain" && fileLayer !== "application" && fileLayer !== "ports") {
      out.push(
        finding(
          "hex-port-in-wrong-layer",
          "warning",
          facts,
          `Port ve špatné vrstvě: \`${fileLayer}\``,
          `\`${facts.file.rel}\` vypadá jako port, ale leží v \`${fileLayer}\`. `
            + `Porty: domain/ports (doménové) nebo application/ports (aplikované).`,
          `Přesuň do správné složky ports/.`,
        ),
      );
    }
  }
  return out;
}

// R3 — adapter implements no port
function adapterWithoutPort(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileLayer = hexLayerOf(facts.file.rel);
  if (fileLayer !== "adapters" && fileLayer !== "inbound" && fileLayer !== "outbound") return out;

  const content = facts.file.content;
  const isAdapter = /\bimplements\s+\w+(Port|Inbound|Outbound)\b/.test(content)
    || /\bclass\s+\w+(Adapter|Gateway|Client|Repository)\b/.test(content);

  if (!isAdapter) return out;

  // Check if it actually implements a known port
  const implementsPort = /\bimplements\s+\w+(Port|Inbound|Outbound)\b/.test(content);
  if (!implementsPort) {
    out.push(
      finding(
        "hex-adapter-no-port",
        "warning",
        facts,
        `Adapter bez portu: \`${facts.file.rel}\``,
        `Adaptér v \`${fileLayer}\` neimplementuje žádný explicitní port (interface). `
          + `V Hexagonalní architektuře každý adaptér realizuje port.`,
        `Definuj port (interface) a uveď \`implements PortName\`, nebo přesuň kód, pokud není adaptér.`,
      ),
    );
  }
  return out;
}

// R4 — inbound adapter calls domain directly (should go through application/use-case)
function inboundCallsDomainDirectly(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileLayer = hexLayerOf(facts.file.rel);
  if (fileLayer !== "inbound" && fileLayer !== "adapters") return out;

  // Check if this looks like an inbound adapter (controller, CLI, consumer)
  const content = facts.file.content;
  const isInboundAdapter = /\bclass\s+\w+(Controller|Handler|Consumer|Listener|Endpoint)\b/.test(content);

  if (!isInboundAdapter) return out;

  for (const dep of facts.dependencies) {
    if (!dep.target) continue;
    const targetLayer = hexLayerOf(relPosix(facts.projectRoot, dep.target));
    if (targetLayer === "domain") {
      out.push(
        finding(
          "hex-inbound-calls-domain",
          "warning",
          facts,
          `Inbound adaptér volá doménu přímo`,
          `\`${facts.file.rel}\` (${fileLayer}) importuje doménu \`${dep.edge.specifier}\` (řádek ${dep.edge.line}). `
            + `Inbound adaptéry by měly orchestrovat přes use-case (application), ne volat doménu přímo.`,
          `Vytvoř use-case v \`application/\`, nech controller ho volat, use-case pak doménu.`,
          dep.edge.line,
        ),
      );
    }
  }
  return out;
}

// R5 — outbound adapter called by domain (inverted)
function outboundCalledByDomain(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileLayer = hexLayerOf(facts.file.rel);
  if (fileLayer !== "outbound" && fileLayer !== "adapters") return out;

  // Check if this outbound adapter is imported by domain
  for (const dep of facts.dependencies) {
    if (!dep.target) continue;
    const targetLayer = hexLayerOf(relPosix(facts.projectRoot, dep.target));
    if (targetLayer === "domain") {
      out.push(
        finding(
          "hex-outbound-called-by-domain",
          "error",
          facts,
          `Outbound adaptér volán z domény`,
          `\`${facts.file.rel}\` (${fileLayer}) je importován z domény \`${dep.edge.specifier}\` (řádek ${dep.edge.line}). `
            + `Doména nesmí volat outbound adaptéry — musí používat outbound porty.`,
          `Definuj outbound port (interface) v domain/ports, implementuj ho zde, injektuj do domény.`,
          dep.edge.line,
        ),
      );
    }
  }
  return out;
}

// R6 — missing primary/secondary adapter distinction
function adapterMissingDirection(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileLayer = hexLayerOf(facts.file.rel);
  if (fileLayer !== "adapters" && fileLayer !== "inbound" && fileLayer !== "outbound") return out;

  const content = facts.file.content;
  const hasDirection = /inbound|outbound|primary|secondary|driving|driven/i.test(content);

  if (!hasDirection && (fileLayer === "inbound" || fileLayer === "outbound")) {
    out.push(
      finding(
        "hex-adapter-missing-direction",
        "hint",
        facts,
        `Adapter bez jasného směru: \`${facts.file.rel}\``,
        `Adaptér v \`${fileLayer}\` nemá v kódu ani v názvu indikaci, zda je inbound (driving) nebo outbound (driven).`,
        `Pojmenuj podle směru: \`*InboundAdapter\`, \`*OutboundAdapter\`, nebo přesuň do \`inbound/\`/\`outbound/\`.`,
      ),
    );
  }
  return out;
}

export const HEXAGONAL_RULES: Rule[] = [
  { id: "hex-domain-knows-adapters", severity: "error", description: "Doména importuje adaptéry — doména smí znát jen porty.", run: domainKnowsAdapters },
  { id: "hex-port-in-adapter", severity: "error", description: "Port/interface definován v adapéru — porty patří do domain/ports nebo application/ports.", run: portInWrongPlace },
  { id: "hex-adapter-no-port", severity: "warning", description: "Adapter neimplementuje žádný explicitní port.", run: adapterWithoutPort },
  { id: "hex-inbound-calls-domain", severity: "warning", description: "Inbound adaptér volá doménu přímo místo přes use-case.", run: inboundCallsDomainDirectly },
  { id: "hex-outbound-called-by-domain", severity: "error", description: "Doména volá outbound adaptér přímo — musí používat port.", run: outboundCalledByDomain },
  { id: "hex-adapter-missing-direction", severity: "hint", description: "Adapter nemá jasný směr (inbound/outbound).", run: adapterMissingDirection },
];

export const HEXAGONAL_RULE_SET: ArchitectureRuleSet = {
  architecture: "hexagonal",
  rules: HEXAGONAL_RULES,
};