import type { RenderContext } from '../types.ts';
import { yellow, green, cyan, label, dim } from './colors.ts';

export function renderToolsLine(ctx: RenderContext): string | null {
  const { tools } = ctx.transcript;
  const colors = ctx.config?.colors;
  if (tools.length === 0) return null;

  const parts: string[] = [];
  const running = tools.filter(t => t.status === 'running');
  const completed = tools.filter(t => t.status === 'completed' || t.status === 'error');

  for (const tool of running.slice(-2)) {
    const target = tool.target ? truncPath(tool.target) : '';
    parts.push(`${yellow('◐')} ${cyan(tool.name)}${target ? label(`: ${target}`, colors) : ''}`);
  }

  const counts = new Map<string, number>();
  for (const t of completed) counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
  for (const [name, count] of Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4)) {
    parts.push(`${green('✓')} ${name} ${label(`×${count}`, colors)}`);
  }

  return parts.length === 0 ? null : parts.join(dim('  '));
}

function truncPath(p: string, max = 20): string {
  const np = p.replace(/\\/g, '/');
  if (np.length <= max) return np;
  const parts = np.split('/');
  const filename = parts.pop() || np;
  return filename.length >= max ? filename.slice(0, max - 3) + '...' : '.../' + filename;
}
