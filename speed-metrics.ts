import * as fs from 'node:fs';
import * as readline from 'node:readline';

export interface SpeedMetrics {
  totalDurationMs: number;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
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
}

interface JsonlLine {
  type?: string;
  timestamp?: string;
  isSidechain?: boolean;
  isApiErrorMessage?: boolean;
  message?: { usage?: AssistantUsage };
}

function parseTs(value: string | undefined): number | null {
  if (!value) return null;
  const n = new Date(value).getTime();
  return Number.isFinite(n) ? n : null;
}

async function scanRequests(jsonlPath: string): Promise<SpeedRequest[]> {
  if (!fs.existsSync(jsonlPath)) return [];
  const requests: SpeedRequest[] = [];
  let lastUserMs: number | null = null;

  try {
    const rl = readline.createInterface({ input: fs.createReadStream(jsonlPath), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let e: JsonlLine;
      try { e = JSON.parse(line) as JsonlLine; } catch { continue; }
      if (e.isApiErrorMessage) continue;

      const ts = parseTs(e.timestamp);
      if (e.type === 'user' && ts !== null) { lastUserMs = ts; continue; }

      if (e.type === 'assistant' && e.message?.usage && ts !== null) {
        const u = e.message.usage;
        const interval = lastUserMs !== null && ts > lastUserMs ? { startMs: lastUserMs, endMs: ts } : null;
        const inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
        requests.push({
          inputTokens,
          outputTokens: u.output_tokens ?? 0,
          interval,
        });
      }
    }
  } catch { /* ignore read errors */ }

  return requests;
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

function buildMetrics(requests: SpeedRequest[]): SpeedMetrics {
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
  return { totalDurationMs, inputTokens, outputTokens, requestCount: requests.length };
}

export async function collectSpeed(jsonlPath: string): Promise<SpeedMetrics> {
  const requests = await scanRequests(jsonlPath);
  return buildMetrics(requests);
}

export function outputTokensPerSec(m: SpeedMetrics): number | null {
  if (m.totalDurationMs <= 0 || m.outputTokens <= 0) return null;
  return m.outputTokens / (m.totalDurationMs / 1000);
}

export function inputTokensPerSec(m: SpeedMetrics): number | null {
  if (m.totalDurationMs <= 0 || m.inputTokens <= 0) return null;
  return m.inputTokens / (m.totalDurationMs / 1000);
}
