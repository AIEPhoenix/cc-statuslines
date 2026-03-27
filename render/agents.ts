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
  const m = a.model ? ` ${label(`[${a.model}]`, colors)}` : '';
  const desc = a.description ? label(`: ${a.description.length > 40 ? a.description.slice(0, 37) + '...' : a.description}`, colors) : '';
  const elapsed = fmtElapsed(a);
  return `${icon} ${type}${m}${desc} ${label(`(${elapsed})`, colors)}`;
}

function fmtElapsed(a: AgentEntry): string {
  const ms = (a.endTime?.getTime() ?? Date.now()) - a.startTime.getTime();
  if (ms < 1000) return '<1s';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
