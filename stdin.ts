import type { StdinData, UsageData } from './types.ts';

const AUTOCOMPACT_BUFFER_PERCENT = 0.165;

export async function readStdin(): Promise<StdinData | null> {
  if (process.stdin.isTTY) return null;
  const chunks: string[] = [];
  try {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      chunks.push(chunk as string);
    }
    const raw = chunks.join('');
    if (!raw.trim()) return null;
    return JSON.parse(raw) as StdinData;
  } catch {
    return null;
  }
}

export function getTotalTokens(stdin: StdinData): number {
  const u = stdin.context_window?.current_usage;
  return (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0);
}

function getNativePercent(stdin: StdinData): number | null {
  const n = stdin.context_window?.used_percentage;
  if (typeof n === 'number' && !Number.isNaN(n)) return Math.min(100, Math.max(0, Math.round(n)));
  return null;
}

export function getContextPercent(stdin: StdinData): number {
  const native = getNativePercent(stdin);
  if (native !== null) return native;
  const size = stdin.context_window?.context_window_size;
  if (!size || size <= 0) return 0;
  return Math.min(100, Math.round((getTotalTokens(stdin) / size) * 100));
}

export function getBufferedPercent(stdin: StdinData): number {
  const native = getNativePercent(stdin);
  if (native !== null) return native;
  const size = stdin.context_window?.context_window_size;
  if (!size || size <= 0) return 0;
  const totalTokens = getTotalTokens(stdin);
  const rawRatio = totalTokens / size;
  const scale = Math.min(1, Math.max(0, (rawRatio - 0.05) / 0.45));
  const buffer = size * AUTOCOMPACT_BUFFER_PERCENT * scale;
  return Math.min(100, Math.round(((totalTokens + buffer) / size) * 100));
}

export function getModelName(stdin: StdinData): string {
  const displayName = stdin.model?.display_name?.trim();
  if (displayName) return displayName;
  const modelId = stdin.model?.id?.trim();
  if (!modelId) return 'Unknown';
  return normalizeBedrockModelLabel(modelId) ?? modelId;
}

export function isBedrockModelId(modelId?: string): boolean {
  if (!modelId) return false;
  return modelId.toLowerCase().includes('anthropic.claude-');
}

export function getProviderLabel(stdin: StdinData): string | null {
  if (isBedrockModelId(stdin.model?.id)) return 'Bedrock';
  return null;
}

export function getEffortLevel(stdin: StdinData): string | null {
  const level = stdin.effort?.level?.trim();
  return level ? level : null;
}

export function getWorktreeName(stdin: StdinData): string | null {
  const name = stdin.worktree?.name?.trim() || stdin.workspace?.git_worktree?.trim();
  return name ? name : null;
}

export function getUsageFromStdin(stdin: StdinData): UsageData | null {
  const r = stdin.rate_limits;
  if (!r) return null;
  const fiveHour = parsePercent(r.five_hour?.used_percentage);
  const sevenDay = parsePercent(r.seven_day?.used_percentage);
  if (fiveHour === null && sevenDay === null) return null;
  return {
    fiveHour,
    sevenDay,
    fiveHourResetAt: parseResetAt(r.five_hour?.resets_at),
    sevenDayResetAt: parseResetAt(r.seven_day?.resets_at),
  };
}

function parsePercent(v: number | null | undefined): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.round(Math.min(100, Math.max(0, v)));
}

function parseResetAt(v: number | null | undefined): Date | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return new Date(v * 1000);
}

function normalizeBedrockModelLabel(modelId: string): string | null {
  if (!isBedrockModelId(modelId)) return null;
  const low = modelId.toLowerCase();
  const prefix = 'anthropic.claude-';
  const idx = low.indexOf(prefix);
  if (idx === -1) return null;
  let suffix = low.slice(idx + prefix.length).replace(/-v\d+:\d+$/, '').replace(/-\d{8}$/, '');
  const tokens = suffix.split('-').filter(Boolean);
  if (tokens.length === 0) return null;
  const familyIndex = tokens.findIndex(t => t === 'haiku' || t === 'sonnet' || t === 'opus' || t === 'fable');
  if (familyIndex === -1) return null;
  const family = tokens[familyIndex];
  const before = readNumVer(tokens, familyIndex - 1, -1).reverse();
  const after = readNumVer(tokens, familyIndex + 1, 1);
  const ver = before.length >= after.length ? before : after;
  const label = family[0].toUpperCase() + family.slice(1);
  return ver.length ? `Claude ${label} ${ver.join('.')}` : `Claude ${label}`;
}

function readNumVer(tokens: string[], start: number, step: -1 | 1): string[] {
  const parts: string[] = [];
  for (let i = start; i >= 0 && i < tokens.length; i += step) {
    if (!/^\d+$/.test(tokens[i])) break;
    parts.push(tokens[i]);
    if (parts.length === 2) break;
  }
  return parts;
}
