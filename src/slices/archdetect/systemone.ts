/**
 * System One (Jev) client — the only network-touching code in the plugin.
 *
 * Deep module: callers hand one typed `SystemOneRequest` and get back a typed
 * `SystemOneResponse`. Everything about the endpoint, auth and error decoding
 * stays in here. `fetch` is injectable so the rest of the slice stays testable
 * without a network.
 *
 * Jev is a *decision* model (`text -> decisions`), not a chat model. It is
 * called through `/api/v1/systemone`, never `/chat/completions`. Each question
 * is typed:
 *   - `noul`   → boolean-ish with a numeric confidence 0..1
 *   - `choice` → one of the `criteria` keys
 *   - `score`  → ordered list of options
 */

export const SYSTEMONE_ENDPOINT = "https://openrouter.ai/api/v1/systemone";

export type QuestionType = "noul" | "choice" | "score";

export interface SystemOneQuestion {
  type: QuestionType;
  /** plain-language instruction the model answers */
  instructions: string;
  /** `choice`/`noul` → key→description map; `score` → ordered options */
  criteria?: Record<string, string> | string[];
}

export interface SystemOneRequest {
  model: string;
  /** free-form context the model reasons over (our topology digest) */
  state: string;
  questions: Record<string, SystemOneQuestion>;
}

export interface SystemOneAnswer {
  type?: string;
  noul?: number;
  choice?: string;
  score?: string[];
  confidence?: number;
  text?: string;
}

export interface SystemOneResponse {
  id?: string;
  model?: string;
  provider?: string;
  answers: Record<string, SystemOneAnswer>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cost?: number;
  };
}

/** Minimal fetch signature — keeps the client decoupled from DOM/undici types. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface SystemOneOptions {
  endpoint?: string;
  apiKey?: string;
  fetchImpl?: FetchLike;
}

export class SystemOneError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "SystemOneError";
  }
}

/** Resolve the OpenRouter key from the explicit option, else the environment. */
/** Resolve the OpenRouter key from the explicit option, else the env var.
 * OAuth (auth.json) resolution happens in the composition root, which passes
 * the result in as an explicit key to keep this slice Pi-free. */
export function resolveApiKey(explicit?: string): string | null {
  if (explicit && explicit.length > 0) return explicit;
  const env = process.env["OPENROUTER_API_KEY"];
  return env && env.length > 0 ? env : null;
}

/** Call the System One endpoint and decode a typed response. */
export async function callSystemOne(
  request: SystemOneRequest,
  options: SystemOneOptions = {},
): Promise<SystemOneResponse> {
  const apiKey = resolveApiKey(options.apiKey);
  if (apiKey === null) {
    throw new SystemOneError("není k dispozici OpenRouter klíč — nastav OPENROUTER_API_KEY nebo se přihlas přes /login (OpenRouter)");
  }

  // SAFETY: Node ≥ 18 exposes a WHATWG-compatible `fetch` on the global; we
  // only use the subset of its surface declared in `FetchLike`, so the cast is safe.
  const fetchFn: FetchLike = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  if (typeof fetchFn !== "function") {
    throw new SystemOneError("globalní fetch není dostupný (vyžadován Node ≥ 18)");
  }

  const endpoint = options.endpoint ?? SYSTEMONE_ENDPOINT;
  const res = await fetchFn(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(15000),
  }).catch((err: unknown) => {
    throw new SystemOneError(
      err instanceof Error && err.name === "TimeoutError"
        ? "Požadavek na System One vypršel (timeout)."
        : `Chyba sítě: ${err instanceof Error ? err.message : String(err)}`
    );
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new SystemOneError(`System One odmítl požadavek (${res.status}): ${body.slice(0, 300)}`, res.status);
  }

  const json = (await res.json()) as SystemOneResponse;
  if (!json || typeof json !== "object" || !json.answers) {
    throw new SystemOneError("System One vrátil neočekávanou odpověď");
  }
  return json;
}