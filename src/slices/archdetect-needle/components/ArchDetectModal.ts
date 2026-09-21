/**
 * Architecture Detection Modal — TUI component for the detection flow.
 *
 * Shows: engine selection → download progress → detection progress → result → confirm
 * Comparison mode: engine select → compare both → side-by-side results
 */

import {
  matchesKey,
  Key,
  visibleWidth,
  type Component,
  Container,
  Text,
  Spacer,
  SelectList,
  type SelectItem,
} from "@earendil-works/pi-tui";
import { BorderedLoader, DynamicBorder } from "@earendil-works/pi-coding-agent";

export type DetectionEngine = "auto" | "jev" | "needle" | "compare";

import type { ArchitectureId } from "../../../shared/types.js";

export interface DetectionResult {
  engine: DetectionEngine;
  architecture: ArchitectureId;
  confidence: number;
  reasoning: string;
  digest: string;
  cost?: number;
}



export interface ModalCallbacks {
  onEngineSelect: (engine: DetectionEngine) => void;
  onConfirm: (result: DetectionResult) => void;
  onCancel: () => void;
}

type ModalState =
  | { phase: "engine-select" }
  | { phase: "downloading"; engine: DetectionEngine; stage: string; progress: number }
  | { phase: "detecting"; engine: DetectionEngine; stage: string; progress: number }
  | { phase: "comparing"; stage: string; progress: number; results: Partial<Record<"jev" | "needle", DetectionResult>> }
  | { phase: "result"; result: DetectionResult }
  | { phase: "comparison"; jev: DetectionResult | null; needle: DetectionResult | null }
  | { phase: "error"; error: string };

/** Color helpers for consistent theming */
function title(theme: any, text: string) {
  return theme.fg("accent", theme.bold(text));
}
function muted(theme: any, text: string) {
  return theme.fg("muted", text);
}
function error(theme: any, text: string) {
  return theme.fg("error", text);
}
function dim(theme: any, text: string) {
  return theme.fg("dim", text);
}

/** Progress bar rendering */
function renderProgressBar(theme: any, width: number, progress: number, label: string): string {
  const barWidth = Math.max(10, width - visibleWidth(label) - 4);
  const filled = Math.round(barWidth * progress);
  const empty = barWidth - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const pct = Math.round(progress * 100);
  return `${label} [${theme.fg("accent", bar)}] ${pct}%`;
}

/** Architecture detection modal component */
export class ArchDetectModal implements Component {
  private state: ModalState = { phase: "engine-select" };
  private container: Container;
  private selectList?: SelectList;
  private loader?: BorderedLoader;
  private callbacks: ModalCallbacks;
  private tui: any;
  private theme: any;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(callbacks: ModalCallbacks) {
    this.callbacks = callbacks;
    this.container = new Container();
    // Don't build yet - wait for setContext to be called with theme
  }

  /** Inject TUI and theme references (called by ctx.ui.custom) */
  setContext(tui: any, theme: any) {
    this.tui = tui;
    this.theme = theme;
    this.buildEngineSelect();
  }

  private buildEngineSelect() {
    this.container.clear();
    this.container.addChild(new DynamicBorder((s: string) => this.theme?.fg("accent", s) ?? s));
    this.container.addChild(new Text(title(this.theme, "🏗  Architecture Detection"), 1, 0));
    this.container.addChild(new Spacer(1));
    this.container.addChild(new Text(muted(this.theme, "No architecture configured for this project."), 1, 0));
    this.container.addChild(new Text(muted(this.theme, "Choose a detection engine:"), 1, 0));
    this.container.addChild(new Spacer(1));

    const items: SelectItem[] = [
      {
        value: "compare",
        label: "Compare (run both Jev + Needle)",
        description: "Runs both detectors and shows side-by-side comparison",
      },
      {
        value: "auto",
        label: "Auto (prefer local Needle, fallback to Jev)",
        description: "Downloads Needle model on first use (~36 MB), then runs offline",
      },
      {
        value: "needle",
        label: "Needle (local WASM, fully offline)",
        description: "45M-121M param model, 2-bit quantized, runs on CPU",
      },
      {
        value: "jev",
        label: "Jev (TypeSafe decision model via OpenRouter)",
        description: "Requires OPENROUTER_API_KEY, network call, higher accuracy",
      },
    ];

    this.selectList = new SelectList(items, Math.min(items.length + 2, 10), {
      selectedPrefix: (t: string) => this.theme?.fg("accent", t) ?? t,
      selectedText: (t: string) => this.theme?.fg("accent", t) ?? t,
      description: (t: string) => this.theme?.fg("muted", t) ?? t,
      scrollInfo: (t: string) => this.theme?.fg("dim", t) ?? t,
      noMatch: (t: string) => this.theme?.fg("warning", t) ?? t,
    });
    this.selectList.onSelect = (item: SelectItem) => {
      this.callbacks.onEngineSelect(item.value as DetectionEngine);
    };
    this.selectList.onCancel = () => this.callbacks.onCancel();
    this.container.addChild(this.selectList);

    this.container.addChild(new Spacer(1));
    this.container.addChild(new Text(dim(this.theme, "↑↓ navigate • enter select • esc cancel"), 1, 0));
    this.container.addChild(new DynamicBorder((s: string) => this.theme?.fg("accent", s) ?? s));
  }

  private buildDownloading(engine: DetectionEngine, stage: string, progress: number) {
    this.container.clear();
    this.container.addChild(new DynamicBorder((s: string) => this.theme?.fg("accent", s) ?? s));
    this.container.addChild(new Text(title(this.theme, `📥 Downloading ${engine === "needle" ? "Needle" : "Jev"} Engine`), 1, 0));
    this.container.addChild(new Spacer(1));
    this.container.addChild(new Text(muted(this.theme, stage), 1, 0));
    this.container.addChild(new Spacer(1));

    this.loader = new BorderedLoader(this.tui, this.theme, stage);
    this.loader.onAbort = () => this.callbacks.onCancel();
    this.container.addChild(this.loader);

    this.container.addChild(new Spacer(1));
    this.container.addChild(new Text(renderProgressBar(this.theme, 60, progress, "Progress:"), 1, 0));
    this.container.addChild(new DynamicBorder((s: string) => this.theme?.fg("accent", s) ?? s));
  }

  private buildDetecting(engine: DetectionEngine, stage: string, progress: number) {
    this.container.clear();
    this.container.addChild(new DynamicBorder((s: string) => this.theme?.fg("accent", s) ?? s));
    this.container.addChild(new Text(title(this.theme, `🔍 Detecting Architecture (${engine})`), 1, 0));
    this.container.addChild(new Spacer(1));
    this.container.addChild(new Text(muted(this.theme, stage), 1, 0));
    this.container.addChild(new Spacer(1));

    this.loader = new BorderedLoader(this.tui, this.theme, stage);
    this.loader.onAbort = () => this.callbacks.onCancel();
    this.container.addChild(this.loader);

    this.container.addChild(new Spacer(1));
    this.container.addChild(new Text(renderProgressBar(this.theme, 60, progress, "Progress:"), 1, 0));
    this.container.addChild(new DynamicBorder((s: string) => this.theme?.fg("accent", s) ?? s));
  }

  private buildResult(result: DetectionResult) {
    this.container.clear();
    this.container.addChild(new DynamicBorder((s: string) => this.theme?.fg("accent", s) ?? s));
    this.container.addChild(new Text(title(this.theme, "✅ Detection Complete"), 1, 0));
    this.container.addChild(new Spacer(1));

    const confColor = result.confidence >= 0.8 ? "success" : result.confidence >= 0.5 ? "warning" : "error";
    this.container.addChild(new Text(`${muted(this.theme, "Engine:")} ${result.engine}`, 1, 0));
    this.container.addChild(new Text(`${muted(this.theme, "Architecture:")} ${this.theme.fg(confColor, this.theme.bold(result.architecture))}`, 1, 0));
    this.container.addChild(new Text(`${muted(this.theme, "Confidence:")} ${this.theme.fg(confColor, `${Math.round(result.confidence * 100)}%`)}`, 1, 0));
    this.container.addChild(new Spacer(1));
    this.container.addChild(new Text(muted(this.theme, "Reasoning:"), 1, 0));
    this.container.addChild(new Text(wrapText(this.theme, result.reasoning, 60).join("\n"), 1, 0));
    this.container.addChild(new Spacer(1));

    if (result.cost !== undefined && result.cost > 0) {
      this.container.addChild(new Text(`${muted(this.theme, "Cost:")} $${result.cost.toFixed(6)}`, 1, 0));
      this.container.addChild(new Spacer(1));
    }

    this.container.addChild(new Text(dim(this.theme, "enter = confirm & save  •  esc = cancel"), 1, 0));
    this.container.addChild(new DynamicBorder((s: string) => this.theme?.fg("accent", s) ?? s));
  }

  private buildError(err: string) {
    this.container.clear();
    this.container.addChild(new DynamicBorder((s: string) => this.theme?.fg("error", s) ?? s));
    this.container.addChild(new Text(error(this.theme, "❌ Detection Failed"), 1, 0));
    this.container.addChild(new Spacer(1));
    this.container.addChild(new Text(wrapText(this.theme, err, 60).join("\n"), 1, 0));
    this.container.addChild(new Spacer(1));
    this.container.addChild(new Text(dim(this.theme, "esc = dismiss"), 1, 0));
    this.container.addChild(new DynamicBorder((s: string) => this.theme?.fg("error", s) ?? s));
  }

  /** Public method to transition to downloading phase */
  startDownloading(engine: DetectionEngine) {
    this.state = { phase: "downloading", engine, stage: "Preparing...", progress: 0 };
    this.buildDownloading(engine, "Preparing...", 0);
    this.tui?.requestRender();
  }

  /** Public method to update download progress */
  updateDownloadProgress(stage: string, progress: number) {
    if (this.state.phase !== "downloading") return;
    this.state = { phase: "downloading", engine: this.state.engine, stage, progress };
    this.buildDownloading(this.state.engine, stage, progress);
    this.tui?.requestRender();
  }

  /** Public method to transition to detecting phase */
  startDetecting(engine: DetectionEngine) {
    this.state = { phase: "detecting", engine, stage: "Analyzing...", progress: 0 };
    this.buildDetecting(engine, "Analyzing...", 0);
    this.tui?.requestRender();
  }

  /** Public method to update detection progress */
  updateDetectionProgress(stage: string, progress: number) {
    if (this.state.phase !== "detecting") return;
    this.state = { phase: "detecting", engine: this.state.engine, stage, progress };
    this.buildDetecting(this.state.engine, stage, progress);
    this.tui?.requestRender();
  }

  /** Public method to show result */
  showResult(result: DetectionResult) {
    this.state = { phase: "result", result };
    this.buildResult(result);
    this.tui?.requestRender();
  }

  /** Public method to show error */
  showError(err: string) {
    this.state = { phase: "error", error: err };
    this.buildError(err);
    this.tui?.requestRender();
  }

  /** Public method to start comparison phase */
  startComparing() {
    this.state = { phase: "comparing", stage: "Starting Jev...", progress: 0, results: {} };
    this.buildComparing("Starting Jev...", 0);
    this.tui?.requestRender();
  }

  /** Public method to update comparison progress */
  updateComparisonProgress(stage: string, progress: number, result?: DetectionResult) {
    if (this.state.phase !== "comparing") return;
    if (result) {
      const results = { ...this.state.results, [result.engine]: result };
      this.state = { phase: "comparing", stage, progress, results };
    } else {
      this.state = { phase: "comparing", stage, progress, results: this.state.results };
    }
    this.buildComparing(stage, progress);
    this.tui?.requestRender();
  }

  /** Public method to show comparison result */
  showComparison(jev: DetectionResult | null, needle: DetectionResult | null) {
    const match = jev !== null && needle !== null && jev.architecture === needle.architecture;
    this.state = { phase: "comparison", jev, needle };
    this.buildComparison(jev, needle, match);
    this.tui?.requestRender();
  }

  private buildComparing(stage: string, progress: number) {
    this.container.clear();
    this.container.addChild(new DynamicBorder((s: string) => this.theme?.fg("accent", s) ?? s));
    this.container.addChild(new Text(title(this.theme, "⚖️  Comparing Jev + Needle"), 1, 0));
    this.container.addChild(new Spacer(1));
    this.container.addChild(new Text(muted(this.theme, stage), 1, 0));
    this.container.addChild(new Spacer(1));

    this.loader = new BorderedLoader(this.tui, this.theme, stage);
    this.loader.onAbort = () => this.callbacks.onCancel();
    this.container.addChild(this.loader);

    this.container.addChild(new Spacer(1));
    this.container.addChild(new Text(renderProgressBar(this.theme, 60, progress, "Progress:"), 1, 0));
    this.container.addChild(new DynamicBorder((s: string) => this.theme?.fg("accent", s) ?? s));
  }

  private buildComparison(jev: DetectionResult | null, needle: DetectionResult | null, match: boolean) {
    this.container.clear();
    this.container.addChild(new DynamicBorder((s: string) => this.theme?.fg("accent", s) ?? s));
    this.container.addChild(new Text(title(this.theme, "⚖️  Comparison Complete"), 1, 0));
    this.container.addChild(new Spacer(1));

    // Match indicator
    const matchColor = match ? "success" : "warning";
    const matchText = match ? "✅  Both engines agree" : "⚠️  Engines disagree";
    this.container.addChild(new Text(this.theme.fg(matchColor, this.theme.bold(matchText)), 1, 0));
    this.container.addChild(new Spacer(1));

    // Jev result
    if (jev) {
      const confColor = jev.confidence >= 0.8 ? "success" : jev.confidence >= 0.5 ? "warning" : "error";
      this.container.addChild(new Text(title(this.theme, "Jev (OpenRouter)"), 1, 0));
      this.container.addChild(new Text(`${muted(this.theme, "Architecture:")} ${this.theme.fg(confColor, this.theme.bold(jev.architecture))}`, 1, 0));
      this.container.addChild(new Text(`${muted(this.theme, "Confidence:")} ${this.theme.fg(confColor, `${Math.round(jev.confidence * 100)}%`)}`, 1, 0));
      this.container.addChild(new Text(`${muted(this.theme, "Cost:")} $${(jev.cost ?? 0).toFixed(6)}`, 1, 0));
      this.container.addChild(new Text(`${muted(this.theme, "Reasoning:")} ${jev.reasoning}`, 1, 0));
    } else {
      this.container.addChild(new Text(title(this.theme, "Jev (OpenRouter)"), 1, 0));
      this.container.addChild(new Text(error(this.theme, "Failed or not run"), 1, 0));
    }
    this.container.addChild(new Spacer(1));

    // Needle result
    if (needle) {
      const confColor = needle.confidence >= 0.8 ? "success" : needle.confidence >= 0.5 ? "warning" : "error";
      this.container.addChild(new Text(title(this.theme, "Needle (Local)"), 1, 0));
      this.container.addChild(new Text(`${muted(this.theme, "Architecture:")} ${this.theme.fg(confColor, this.theme.bold(needle.architecture))}`, 1, 0));
      this.container.addChild(new Text(`${muted(this.theme, "Confidence:")} ${this.theme.fg(confColor, `${Math.round(needle.confidence * 100)}%`)}`, 1, 0));
      this.container.addChild(new Text(`${muted(this.theme, "Cost:")} $0.000000`, 1, 0));
      this.container.addChild(new Text(`${muted(this.theme, "Reasoning:")} ${needle.reasoning}`, 1, 0));
    } else {
      this.container.addChild(new Text(title(this.theme, "Needle (Local)"), 1, 0));
      this.container.addChild(new Text(error(this.theme, "Failed or not run"), 1, 0));
    }
    this.container.addChild(new Spacer(1));

    this.container.addChild(new Text(dim(this.theme, "enter = confirm & save  •  esc = cancel"), 1, 0));
    this.container.addChild(new DynamicBorder((s: string) => this.theme?.fg("accent", s) ?? s));
  }

  handleInput(data: string): void {
    // Let the active component handle input first (SelectList handles arrows, enter, escape)
    if (this.state.phase === "engine-select" && this.selectList) {
      this.selectList.handleInput(data);
      this.tui?.requestRender();
      return;
    }

    if (this.loader) {
      this.loader.handleInput(data);
      this.tui?.requestRender();
      return;
    }

    // Global escape handling for phases without a focused component
    if (matchesKey(data, Key.escape)) {
      this.callbacks.onCancel();
      return;
    }

    if (this.state.phase === "result" && matchesKey(data, Key.enter)) {
      this.callbacks.onConfirm(this.state.result);
      return;
    }

    if (this.state.phase === "comparison" && matchesKey(data, Key.enter)) {
      const chosen = this.state.needle ?? this.state.jev;
      if (chosen) {
        this.callbacks.onConfirm(chosen);
      }
      return;
    }
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }
    this.cachedLines = this.container.render(width);
    this.cachedWidth = width;
    return this.cachedLines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.container.invalidate();
  }
}

/** Simple word wrap preserving ANSI codes */
function wrapText(_theme: any, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? current + " " + word : word;
    if (visibleWidth(test) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}