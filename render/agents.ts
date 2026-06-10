import type { RenderContext, AgentEntry } from '../types.ts';
import { yellow, green, magenta, label } from './colors.ts';

export function renderAgentsLine(ctx: RenderContext): string | null {
  const { agents } = ctx.transcript;
  const colors = ctx.config?.colors;
  const running = agents.filter(a => a.status === 'running');
  const recent = agents.filter(a => a.status === 'completed').reverse().slice(0, 2);
  const toShow = [...running, ...recent].slice(0, 3);
  if (toShow.length === 0) return null;
  return toShow.map(a => fmtAgent(a, colors)).join('\n');
}

function fmtAgent(a: AgentEntry, colors?: RenderContext['config']['colors']): string {
  const icon = a.status === 'running' ? yellow('◐') : green('✓');
  const type = magenta(a.type);
  const m = a.model ? ` ${label(`[${fmtModel(a.model)}]`, colors)}` : '';
  const desc = a.description ? label(`: ${a.description.length > 40 ? a.description.slice(0, 37) + '...' : a.description}`, colors) : '';
  const elapsed = fmtElapsed(a);
  const speed = typeof a.outputTokensPerSec === 'number' ? ` | ${a.outputTokensPerSec.toFixed(1)} tok/s` : '';
  const tools = typeof a.totalToolUseCount === 'number' ? ` | ${a.totalToolUseCount}t` : '';
  const tokens = typeof a.totalTokens === 'number' ? ` | ${fmtTokens(a.totalTokens)}` : '';
  return `${icon} ${type}${m}${desc} ${label(`(${elapsed}${speed}${tools}${tokens})`, colors)}`;
}

function fmtElapsed(a: AgentEntry): string {
  const ms = (a.endTime?.getTime() ?? Date.now()) - a.startTime.getTime();
  if (ms < 1000) return '<1s';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

/** Compact label from a model ID or alias: "claude-haiku-4-5-20251001" → "haiku 4.5". */
function fmtModel(m: string): string {
  const match = m.toLowerCase().match(/(opus|sonnet|haiku|fable)[-_ ]?(\d+(?:[-.]\d+)?)?/);
  if (!match) return m;
  const ver = match[2]?.replace('-', '.');
  return ver ? `${match[1]} ${ver}` : match[1];
}

function fmtTokens(n: number): string {
  if (n < 1000) return `${n}tok`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
