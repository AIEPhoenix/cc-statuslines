import type { RenderContext } from '../types.ts';
import { getContextPercent, getBufferedPercent, getTotalTokens } from '../stdin.ts';
import { resolveCompactLine } from '../compact-line.ts';
import { coloredBar, label, getContextColor, brightBlue, dim, RESET } from './colors.ts';
import { getAdaptiveBarWidth } from '../utils/terminal.ts';

export function renderIdentityLine(ctx: RenderContext): string {
  const rawPercent = getContextPercent(ctx.stdin);
  const bufferedPercent = getBufferedPercent(ctx.stdin);
  const colors = ctx.config?.colors;
  const display = ctx.config?.display;

  const compact = display?.showCompactLine !== false ? resolveCompactLine(ctx) : null;
  const size = ctx.stdin.context_window?.context_window_size ?? 0;
  // Only an observed line earns a tick: a configured window is nominal (the
  // real trigger fires well below it), so drawing it would imply false precision.
  const markerPercent = compact?.source === 'observed' && size > 0 ? (compact.tokens / size) * 100 : null;

  // The synthetic autocompact buffer approximated "distance to compaction"
  // before the line was knowable; with a real tick on the bar, fill and marker
  // must share the raw tokens/size denominator or the fill crosses the tick early.
  const autocompactMode = ctx.config?.display?.autocompactBuffer ?? 'enabled';
  const percent = autocompactMode === 'disabled' || markerPercent !== null ? rawPercent : bufferedPercent;
  const mode = display?.contextValue ?? 'percent';
  const contextValue = formatContextValue(ctx, percent, mode);
  // 1M badge: context has grown past 200k, so the session runs on an extended window
  const badge = ctx.stdin.exceeds_200k_tokens === true ? ` ${brightBlue('1M')}` : '';
  const cvDisplay = `${getContextColor(percent, colors)}${contextValue}${RESET}${badge}`;

  let line = display?.showContextBar !== false
    ? `${label('Context', colors)} ${coloredBar(percent, getAdaptiveBarWidth(), colors, markerPercent)} ${cvDisplay}`
    : `${label('Context', colors)} ${cvDisplay}`;

  if (compact) {
    // "ac@360k" = observed auto-compact line; "ac≈500k" = configured window,
    // the actual trigger fires somewhat below it. "×2" = compactions so far.
    const count = ctx.transcript.compactions?.count ?? 0;
    const sep = compact.source === 'observed' ? '@' : '≈';
    line += dim(` ac${sep}${fmtTokens(compact.tokens)}${count > 0 ? ` ×${count}` : ''}`);
  } else {
    const count = ctx.transcript.compactions?.count ?? 0;
    if (count > 0 && display?.showCompactLine !== false) line += dim(` ac ×${count}`);
  }

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
  if (n >= 1e6) return `${trim1((n / 1e6))}M`;
  if (n >= 1000) return `${trim1(n / 1000)}k`;
  return n.toString();
}

/** One decimal, with a trailing ".0" dropped: 360 → "360", 480.5 → "480.5". */
function trim1(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '');
}

function formatContextValue(ctx: RenderContext, percent: number, mode: 'percent' | 'tokens' | 'remaining' | 'both'): string {
  const total = getTotalTokens(ctx.stdin);
  const size = ctx.stdin.context_window?.context_window_size ?? 0;
  if (mode === 'tokens') return size > 0 ? `${fmtTokens(total)}/${fmtTokens(size)}` : fmtTokens(total);
  if (mode === 'both') return size > 0 ? `${percent}% (${fmtTokens(total)}/${fmtTokens(size)})` : `${percent}%`;
  if (mode === 'remaining') return `${Math.max(0, 100 - percent)}%`;
  return `${percent}%`;
}
