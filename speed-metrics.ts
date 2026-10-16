import * as fs from 'node:fs';
import * as readline from 'node:readline';

export interface SpeedMetrics {
  totalDurationMs: number;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  /** Model ID from the first assistant entry (the model the agent actually ran on). */
  model: string | null;
  /** Estimated API-equivalent cost in USD (null when the model has no pricing entry). */
  costUsd: number | null;
  /** Wall-clock time Claude spent working (human prompt -> last event of that turn),
   * i.e. session duration minus waiting-for-user gaps. */
  activeDurationMs: number;
  /** Timestamps of the first/last events in the file (null when empty). */
  firstEventMs: number | null;
  lastEventMs: number | null;
}

interface ModelPrice {
  match: RegExp;
  /** $/MTok input and output. */
  inPerM: number;
  outPerM: number;
  /** $/MTok cache read when it isn't the usual 0.1x of input. */
  cacheReadPerM?: number;
  /** Prompts (input + cache tokens) above this size bill at `long` rates instead. */
  longAbove?: number;
  long?: { inPerM: number; outPerM: number };
  /** Price multiplier for `usage.speed === 'fast'` (`/fast`). */
  fastMultiplier?: number;
}

// First match wins, so versioned entries precede the family fallbacks. Cache
// writes derive from input: 5m = 1.25x, 1h = 2x. Sources: Claude API pricing,
// 2026-10-16.
const MODEL_PRICING: ModelPrice[] = [
  { match: /(fable|mythos)-5-1/, inPerM: 10, outPerM: 50, cacheReadPerM: 0.25 },
  { match: /fable|mythos/, inPerM: 10, outPerM: 50 },
  { match: /opus-5-5/, inPerM: 4, outPerM: 20, cacheReadPerM: 0.2, fastMultiplier: 2 },
  { match: /opus-5|opus-4-8/, inPerM: 5, outPerM: 25, fastMultiplier: 2 },
  { match: /opus-4-(1|2025)/, inPerM: 15, outPerM: 75 },
  { match: /opus/, inPerM: 5, outPerM: 25 },
  { match: /sonnet-5-5/, inPerM: 2, outPerM: 10, cacheReadPerM: 0.1 },
  { match: /sonnet-5/, inPerM: 2, outPerM: 10 },
  { match: /sonnet/, inPerM: 3, outPerM: 15 },
  { match: /haiku-5-5/, inPerM: 0.1, outPerM: 0.5, longAbove: 100_000, long: { inPerM: 0.5, outPerM: 2.5 } },
  { match: /3-5-haiku/, inPerM: 0.8, outPerM: 4 },
  { match: /haiku/, inPerM: 1, outPerM: 5 },
];

export function findModelPrice(model: string): ModelPrice | null {
  const low = model.toLowerCase();
  return MODEL_PRICING.find(e => e.match.test(low)) ?? null;
}

/** API-equivalent cost of one request in USD; null when the model has no pricing entry. */
export function requestCostUsd(model: string, u: AssistantUsage): number | null {
  const p = findModelPrice(model);
  if (!p) return null;
  const input = u.input_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cc = u.cache_creation;
  // No TTL breakdown — assume the cheaper 5m rate
  const write5m = cc ? cc.ephemeral_5m_input_tokens ?? 0 : u.cache_creation_input_tokens ?? 0;
  const write1h = cc ? cc.ephemeral_1h_input_tokens ?? 0 : 0;
  const prompt = input + cacheRead + (u.cache_creation_input_tokens ?? write5m + write1h);
  const long = p.long && p.longAbove !== undefined && prompt > p.longAbove;
  const inPerM = long ? p.long!.inPerM : p.inPerM;
  const outPerM = long ? p.long!.outPerM : p.outPerM;
  const readPerM = long ? inPerM * 0.1 : p.cacheReadPerM ?? inPerM * 0.1;
  const mul = u.speed === 'fast' ? p.fastMultiplier ?? 1 : 1;
  return mul * (
    input * inPerM +
    (u.output_tokens ?? 0) * outPerM +
    write5m * inPerM * 1.25 +
    write1h * inPerM * 2 +
    cacheRead * readPerM
  ) / 1e6;
}

interface SpeedInterval { startMs: number; endMs: number; }
interface SpeedRequest {
  inputTokens: number;
  outputTokens: number;
  interval: SpeedInterval | null;
}

interface AssistantUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  } | null;
  /** `standard` | `fast` */
  speed?: string;
}

interface JsonlLine {
  type?: string;
  timestamp?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  isApiErrorMessage?: boolean;
  message?: { usage?: AssistantUsage; model?: string; content?: unknown };
}

/** A real prompt that starts a turn (human input or an injected wake-up),
 * as opposed to tool_result user-entries emitted mid-turn. */
function isTurnStart(e: JsonlLine): boolean {
  if (e.type !== 'user' || e.isSidechain || e.isMeta) return false;
  const c = e.message?.content;
  if (typeof c === 'string') return true;
  if (Array.isArray(c)) return !c.some(b => (b as { type?: string })?.type === 'tool_result');
  return false;
}

function parseTs(value: string | undefined): number | null {
  if (!value) return null;
  const n = new Date(value).getTime();
  return Number.isFinite(n) ? n : null;
}

interface ScanResult { requests: SpeedRequest[]; model: string | null; costUsd: number | null; activeDurationMs: number; firstEventMs: number | null; lastEventMs: number | null; }

async function scanRequests(jsonlPath: string): Promise<ScanResult> {
  if (!fs.existsSync(jsonlPath)) return { requests: [], model: null, costUsd: null, activeDurationMs: 0, firstEventMs: null, lastEventMs: null };
  const requests: SpeedRequest[] = [];
  let lastUserMs: number | null = null;
  let model: string | null = null;
  // Priced per request: Haiku 5.5 tiers by prompt size and /fast by request.
  let costUsd: number | null = null;
  let activeMs = 0;
  let turnStartMs: number | null = null;
  let lastEventMs: number | null = null;
  let firstEventMs: number | null = null;

  try {
    const rl = readline.createInterface({ input: fs.createReadStream(jsonlPath), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let e: JsonlLine;
      try { e = JSON.parse(line) as JsonlLine; } catch { continue; }
      if (e.isApiErrorMessage) continue;

      const ts = parseTs(e.timestamp);

      if (ts !== null) {
        if (firstEventMs === null || ts < firstEventMs) firstEventMs = ts;
        // A new turn closes the previous one at its last event; the gap in
        // between (waiting for the user) is excluded from active time.
        if (isTurnStart(e)) {
          if (turnStartMs !== null && lastEventMs !== null && lastEventMs > turnStartMs) {
            activeMs += lastEventMs - turnStartMs;
          }
          turnStartMs = ts;
        }
        lastEventMs = lastEventMs === null ? ts : Math.max(lastEventMs, ts);
      }

      if (e.type === 'user' && ts !== null) { lastUserMs = ts; continue; }

      if (e.type === 'assistant' && e.message?.usage && ts !== null) {
        if (!model && typeof e.message.model === 'string') model = e.message.model;
        const u = e.message.usage;
        const interval = lastUserMs !== null && ts > lastUserMs ? { startMs: lastUserMs, endMs: ts } : null;
        const inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
        requests.push({
          inputTokens,
          outputTokens: u.output_tokens ?? 0,
          interval,
        });

        const reqModel = typeof e.message.model === 'string' ? e.message.model : model;
        const cost = reqModel ? requestCostUsd(reqModel, u) : null;
        if (cost !== null) costUsd = (costUsd ?? 0) + cost;
      }
    }
  } catch { /* ignore read errors */ }

  // Close the trailing turn — when the session is idle, lastEventMs is the
  // final assistant event, so waiting-for-input time never accrues.
  if (turnStartMs !== null && lastEventMs !== null && lastEventMs > turnStartMs) {
    activeMs += lastEventMs - turnStartMs;
  }

  return { requests, model, costUsd, activeDurationMs: activeMs, firstEventMs, lastEventMs };
}

function mergeIntervals(intervals: SpeedInterval[]): SpeedInterval[] {
  if (intervals.length === 0) return [];
  const sorted = intervals.slice().sort((a, b) => a.startMs - b.startMs);
  const merged: SpeedInterval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = merged[merged.length - 1];
    if (cur.startMs <= last.endMs) last.endMs = Math.max(last.endMs, cur.endMs);
    else merged.push({ ...cur });
  }
  return merged;
}

function buildMetrics(requests: SpeedRequest[], model: string | null): SpeedMetrics {
  let inputTokens = 0;
  let outputTokens = 0;
  const intervals: SpeedInterval[] = [];
  for (const r of requests) {
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
    if (r.interval) intervals.push(r.interval);
  }
  const merged = mergeIntervals(intervals);
  const totalDurationMs = merged.reduce((sum, iv) => sum + (iv.endMs - iv.startMs), 0);
  return { totalDurationMs, inputTokens, outputTokens, requestCount: requests.length, model, costUsd: null, activeDurationMs: 0, firstEventMs: null, lastEventMs: null };
}

export async function collectSpeed(jsonlPath: string): Promise<SpeedMetrics> {
  const { requests, model, costUsd, activeDurationMs, firstEventMs, lastEventMs } = await scanRequests(jsonlPath);
  return { ...buildMetrics(requests, model), costUsd, activeDurationMs, firstEventMs, lastEventMs };
}

export function outputTokensPerSec(m: SpeedMetrics): number | null {
  if (m.totalDurationMs <= 0 || m.outputTokens <= 0) return null;
  return m.outputTokens / (m.totalDurationMs / 1000);
}

export function inputTokensPerSec(m: SpeedMetrics): number | null {
  if (m.totalDurationMs <= 0 || m.inputTokens <= 0) return null;
  return m.inputTokens / (m.totalDurationMs / 1000);
}
