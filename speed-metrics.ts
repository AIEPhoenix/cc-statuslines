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

interface UsageTotals {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

// $/MTok input and output. Cache rates derive from input: write 5m = 1.25x, 1h = 2x, read = 0.1x.
const MODEL_PRICING: Array<{ match: RegExp; inPerM: number; outPerM: number }> = [
  { match: /fable/, inPerM: 10, outPerM: 50 },
  { match: /opus/, inPerM: 5, outPerM: 25 },
  { match: /sonnet/, inPerM: 3, outPerM: 15 },
  { match: /haiku/, inPerM: 1, outPerM: 5 },
];

function estimateCostUsd(model: string | null, t: UsageTotals): number | null {
  if (!model) return null;
  const p = MODEL_PRICING.find(e => e.match.test(model.toLowerCase()));
  if (!p) return null;
  return (
    t.input * p.inPerM +
    t.output * p.outPerM +
    t.cacheWrite5m * p.inPerM * 1.25 +
    t.cacheWrite1h * p.inPerM * 2 +
    t.cacheRead * p.inPerM * 0.1
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

interface ScanResult { requests: SpeedRequest[]; model: string | null; totals: UsageTotals; activeDurationMs: number; firstEventMs: number | null; lastEventMs: number | null; }

async function scanRequests(jsonlPath: string): Promise<ScanResult> {
  const totals: UsageTotals = { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
  if (!fs.existsSync(jsonlPath)) return { requests: [], model: null, totals, activeDurationMs: 0, firstEventMs: null, lastEventMs: null };
  const requests: SpeedRequest[] = [];
  let lastUserMs: number | null = null;
  let model: string | null = null;
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

        totals.input += u.input_tokens ?? 0;
        totals.output += u.output_tokens ?? 0;
        totals.cacheRead += u.cache_read_input_tokens ?? 0;
        const cc = u.cache_creation;
        if (cc) {
          totals.cacheWrite5m += cc.ephemeral_5m_input_tokens ?? 0;
          totals.cacheWrite1h += cc.ephemeral_1h_input_tokens ?? 0;
        } else {
          // No TTL breakdown — assume the cheaper 5m rate
          totals.cacheWrite5m += u.cache_creation_input_tokens ?? 0;
        }
      }
    }
  } catch { /* ignore read errors */ }

  // Close the trailing turn — when the session is idle, lastEventMs is the
  // final assistant event, so waiting-for-input time never accrues.
  if (turnStartMs !== null && lastEventMs !== null && lastEventMs > turnStartMs) {
    activeMs += lastEventMs - turnStartMs;
  }

  return { requests, model, totals, activeDurationMs: activeMs, firstEventMs, lastEventMs };
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
  const { requests, model, totals, activeDurationMs, firstEventMs, lastEventMs } = await scanRequests(jsonlPath);
  return { ...buildMetrics(requests, model), costUsd: estimateCostUsd(model, totals), activeDurationMs, firstEventMs, lastEventMs };
}

export function outputTokensPerSec(m: SpeedMetrics): number | null {
  if (m.totalDurationMs <= 0 || m.outputTokens <= 0) return null;
  return m.outputTokens / (m.totalDurationMs / 1000);
}

export function inputTokensPerSec(m: SpeedMetrics): number | null {
  if (m.totalDurationMs <= 0 || m.inputTokens <= 0) return null;
  return m.inputTokens / (m.totalDurationMs / 1000);
}
