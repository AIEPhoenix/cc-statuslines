import * as fs from 'node:fs';
import * as path from 'node:path';
import type { StdinData } from './types.ts';
import { getHudDir } from './config.ts';

const SPEED_WINDOW_MS = 2000;

interface SpeedCache {
  inputTokens: number;
  outputTokens: number;
  timestamp: number;
}

function getCachePath(): string { return path.join(getHudDir(), '.speed-cache.json'); }

function readCache(): SpeedCache | null {
  try {
    const p = getCachePath();
    if (!fs.existsSync(p)) return null;
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as SpeedCache;
    return (typeof parsed.outputTokens === 'number' && typeof parsed.timestamp === 'number') ? parsed : null;
  } catch { return null; }
}

function writeCache(cache: SpeedCache): void {
  try {
    const p = getCachePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(cache), 'utf8');
  } catch {}
}

function calcSpeed(current: number, previous: number, deltaMs: number): number | null {
  const dt = current - previous;
  if (dt > 0 && deltaMs > 0 && deltaMs <= SPEED_WINDOW_MS) return dt / (deltaMs / 1000);
  return null;
}

export interface TokenSpeeds {
  inputSpeed: number | null;
  outputSpeed: number | null;
}

// Cached result per invocation to avoid double read/write
let cachedResult: TokenSpeeds | null = null;
let cachedForTimestamp = 0;

function computeSpeeds(stdin: StdinData): TokenSpeeds {
  const now = Date.now();
  // Return cached result if called multiple times in the same ms
  if (cachedResult && now === cachedForTimestamp) return cachedResult;

  const inputTokens = stdin.context_window?.total_input_tokens;
  const outputTokens = stdin.context_window?.current_usage?.output_tokens;
  const inVal = typeof inputTokens === 'number' && Number.isFinite(inputTokens) ? inputTokens : 0;
  const outVal = typeof outputTokens === 'number' && Number.isFinite(outputTokens) ? outputTokens : 0;

  const prev = readCache();

  let inputSpeed: number | null = null;
  let outputSpeed: number | null = null;

  if (prev) {
    const dms = now - prev.timestamp;
    if (inVal >= (prev.inputTokens ?? 0)) inputSpeed = calcSpeed(inVal, prev.inputTokens ?? 0, dms);
    if (outVal >= prev.outputTokens) outputSpeed = calcSpeed(outVal, prev.outputTokens, dms);
  }

  writeCache({ inputTokens: inVal, outputTokens: outVal, timestamp: now });
  cachedResult = { inputSpeed, outputSpeed };
  cachedForTimestamp = now;
  return cachedResult;
}

/** Original claude-hud compatible: output speed only */
export function getOutputSpeed(stdin: StdinData): number | null {
  return computeSpeeds(stdin).outputSpeed;
}

/** Extended: both input and output speeds for token stats line */
export function getTokenSpeeds(stdin: StdinData): TokenSpeeds {
  return computeSpeeds(stdin);
}
