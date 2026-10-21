import type { RenderContext } from '../types.ts';
import { dim, cyan, brightMagenta, brightGreen, RESET } from './colors.ts';

const COST_COLOR = '\x1b[38;5;178m'; // muted gold, same as agent costs

export function renderTokensLine(ctx: RenderContext): string | null {
  if (ctx.config?.display?.showTokens === false) return null;

  const cw = ctx.stdin.context_window;
  const countParts: string[] = [];
  const speedParts: string[] = [];

  // Since CC 2.1.132 these describe the last response, not session totals, and
  // the input figure already includes cache reads and writes.
  const lastIn = cw?.total_input_tokens;
  const lastOut = cw?.total_output_tokens;
  const cacheRead = cw?.current_usage?.cache_read_input_tokens ?? 0;

  if (typeof lastIn === 'number') {
    const cached = cacheRead > 0 ? ` ${dim('(')}${brightGreen(fmtTokens(cacheRead))} ${dim('cached)')}` : '';
    countParts.push(`${dim('last in')} ${cyan(fmtTokens(lastIn))}${cached}`);
  }
  if (typeof lastOut === 'number') countParts.push(`${dim('out')} ${brightMagenta(fmtTokens(lastOut))}`);

  if (ctx.config?.display?.showSpeed !== false) {
    const inputSpeed = ctx.transcript.inputTokensPerSec;
    const outputSpeed = ctx.transcript.outputTokensPerSec;
    if (typeof inputSpeed === 'number') speedParts.push(cyan(`↑${fmtSpeed(inputSpeed)}`));
    if (typeof outputSpeed === 'number') speedParts.push(brightMagenta(`↓${fmtSpeed(outputSpeed)}`));
  }

  const parts: string[] = [];
  const costVal = ctx.stdin.cost?.total_cost_usd;
  if (typeof costVal === 'number') parts.push(`${COST_COLOR}$${costVal.toFixed(2)}${RESET}`);
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
