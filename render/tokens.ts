import type { RenderContext } from '../types.ts';
import { getTokenSpeeds } from '../speed-tracker.ts';
import { dim, cyan, brightMagenta, brightCyan, green } from './colors.ts';

export function renderTokensLine(ctx: RenderContext): string | null {
  if (ctx.config?.display?.showTokens === false) return null;

  const cw = ctx.stdin.context_window;
  const parts: string[] = [];

  const totalIn = cw?.total_input_tokens;
  const totalOut = cw?.total_output_tokens;
  const usage = cw?.current_usage;
  const cacheTokens = (usage?.cache_creation_input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0);

  if (typeof totalIn === 'number') parts.push(`${dim('In:')} ${cyan(fmtTokens(totalIn))}`);
  if (typeof totalOut === 'number') parts.push(`${dim('Out:')} ${brightMagenta(fmtTokens(totalOut))}`);
  if (cacheTokens > 0) parts.push(`${dim('Cache:')} ${green(fmtTokens(cacheTokens))}`);

  const { inputSpeed, outputSpeed } = getTokenSpeeds(ctx.stdin);
  if (inputSpeed !== null) parts.push(`${brightCyan(`↑${inputSpeed.toFixed(1)}`)} ${dim('t/s')}`);
  if (outputSpeed !== null) parts.push(`${brightMagenta(`↓${outputSpeed.toFixed(1)}`)} ${dim('t/s')}`);

  return parts.length === 0 ? null : parts.join(dim(' │ '));
}

function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return n.toString();
}
