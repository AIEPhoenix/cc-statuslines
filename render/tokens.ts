import type { RenderContext } from '../types.ts';
import { dim, cyan, brightMagenta, brightCyan, green } from './colors.ts';
import { buildModelSegment } from './segments.ts';

export function renderTokensLine(ctx: RenderContext): string | null {
  if (ctx.config?.display?.showTokens === false) return null;

  const cw = ctx.stdin.context_window;
  const countParts: string[] = [];
  const speedParts: string[] = [];

  const totalIn = cw?.total_input_tokens;
  const totalOut = cw?.total_output_tokens;
  const usage = cw?.current_usage;
  const cacheTokens = (usage?.cache_creation_input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0);

  if (typeof totalIn === 'number') countParts.push(`${dim('in')} ${cyan(fmtTokens(totalIn))}`);
  if (typeof totalOut === 'number') countParts.push(`${dim('out')} ${brightMagenta(fmtTokens(totalOut))}`);
  if (cacheTokens > 0) countParts.push(`${dim('cache')} ${green(fmtTokens(cacheTokens))}`);

  if (ctx.config?.display?.showSpeed !== false) {
    const inputSpeed = ctx.transcript.inputTokensPerSec;
    const outputSpeed = ctx.transcript.outputTokensPerSec;
    if (typeof inputSpeed === 'number') speedParts.push(brightCyan(`↑${fmtSpeed(inputSpeed)}`));
    if (typeof outputSpeed === 'number') speedParts.push(brightMagenta(`↓${fmtSpeed(outputSpeed)}`));
  }

  const parts: string[] = [];
  const modelPart = buildModelSegment(ctx);
  if (modelPart) parts.push(modelPart);
  if (countParts.length > 0) parts.push(countParts.join(dim('  ')));
  if (speedParts.length > 0) parts.push(speedParts.join(dim('/')) + dim(' t/s'));

  return parts.length === 0 ? null : parts.join(dim('  ·  '));
}

function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

function fmtSpeed(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toFixed(0);
}
