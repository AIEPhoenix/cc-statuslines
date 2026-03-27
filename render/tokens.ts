import type { RenderContext } from '../types.ts';
import { getTokenSpeeds } from '../speed-tracker.ts';
import { dim, cyan, brightMagenta, brightCyan, green } from './colors.ts';

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

  const { inputSpeed, outputSpeed } = getTokenSpeeds(ctx.stdin);
  if (inputSpeed !== null) speedParts.push(brightCyan(`↑${inputSpeed.toFixed(0)}`));
  if (outputSpeed !== null) speedParts.push(brightMagenta(`↓${outputSpeed.toFixed(0)}`));

  const parts: string[] = [];
  if (ctx.claudeCodeVersion) parts.push(`\x1b[38;5;245mv${ctx.claudeCodeVersion}\x1b[0m`);
  if (countParts.length > 0) parts.push(countParts.join(dim('  ')));
  if (speedParts.length > 0) parts.push(speedParts.join(dim('/')) + dim(' t/s'));

  return parts.length === 0 ? null : parts.join(dim('  ·  '));
}

function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}
