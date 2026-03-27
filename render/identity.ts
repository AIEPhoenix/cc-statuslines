import type { RenderContext } from '../types.ts';
import { getContextPercent, getBufferedPercent, getTotalTokens } from '../stdin.ts';
import { coloredBar, label, getContextColor, RESET } from './colors.ts';
import { getAdaptiveBarWidth } from '../utils/terminal.ts';

export function renderIdentityLine(ctx: RenderContext): string {
  const rawPercent = getContextPercent(ctx.stdin);
  const bufferedPercent = getBufferedPercent(ctx.stdin);
  const autocompactMode = ctx.config?.display?.autocompactBuffer ?? 'enabled';
  const percent = autocompactMode === 'disabled' ? rawPercent : bufferedPercent;
  const colors = ctx.config?.colors;
  const display = ctx.config?.display;
  const mode = display?.contextValue ?? 'percent';
  const contextValue = formatContextValue(ctx, percent, mode);
  const cvDisplay = `${getContextColor(percent, colors)}${contextValue}${RESET}`;

  let line = display?.showContextBar !== false
    ? `${label('Context', colors)} ${coloredBar(percent, getAdaptiveBarWidth(), colors)} ${cvDisplay}`
    : `${label('Context', colors)} ${cvDisplay}`;

  if (display?.showTokenBreakdown !== false && percent >= 85) {
    const usage = ctx.stdin.context_window?.current_usage;
    if (usage) {
      const input = fmtTokens(usage.input_tokens ?? 0);
      const cache = fmtTokens((usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0));
      line += label(` (in: ${input}, cache: ${cache})`, colors);
    }
  }
  return line;
}

function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

function formatContextValue(ctx: RenderContext, percent: number, mode: 'percent' | 'tokens' | 'remaining' | 'both'): string {
  const total = getTotalTokens(ctx.stdin);
  const size = ctx.stdin.context_window?.context_window_size ?? 0;
  if (mode === 'tokens') return size > 0 ? `${fmtTokens(total)}/${fmtTokens(size)}` : fmtTokens(total);
  if (mode === 'both') return size > 0 ? `${percent}% (${fmtTokens(total)}/${fmtTokens(size)})` : `${percent}%`;
  if (mode === 'remaining') return `${Math.max(0, 100 - percent)}%`;
  return `${percent}%`;
}
