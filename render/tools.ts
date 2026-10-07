import type { RenderContext } from '../types.ts';
import { yellow, green, white, label, dim } from './colors.ts';
import { buildLinesChangedSegment } from './segments.ts';

export function renderToolsLine(ctx: RenderContext): string | null {
  const { tools } = ctx.transcript;
  const colors = ctx.config?.colors;
  const parts: string[] = [];
  const running = tools.filter(t => t.status === 'running');
  const completed = tools.filter(t => t.status === 'completed' || t.status === 'error');

  for (const tool of running.slice(-2)) {
    const target = tool.target ? truncTarget(tool.name, tool.target) : '';
    parts.push(`${yellow('◐')} ${white(tool.name)}${target ? label(`: ${target}`, colors) : ''}`);
  }

  const counts = new Map<string, number>();
  for (const t of completed) counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
  for (const [name, count] of Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4)) {
    parts.push(`${green('✓')} ${white(name)} ${label(`×${count}`, colors)}`);
  }

  const lines = buildLinesChangedSegment(ctx);
  if (lines) parts.push(lines);

  return parts.length === 0 ? null : parts.join(dim('  '));
}

// URLs behave like paths: the last segment is the informative one.
const PATH_TOOLS = new Set(['Read', 'Write', 'Edit', 'NotebookEdit', 'WebFetch']);

/** Path-like targets keep their filename; everything else (a Bash command, a
 * search query) is cut from the end, so `cd /Users/...` doesn't read as `.../-Use...`. */
function truncTarget(name: string, target: string, max = 20): string {
  if (PATH_TOOLS.has(name)) return truncPath(target, max);
  const t = target.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max - 3) + '...';
}

function truncPath(p: string, max = 20): string {
  const np = p.replace(/\\/g, '/');
  if (np.length <= max) return np;
  const parts = np.split('/');
  const filename = parts.pop() || np;
  return filename.length >= max ? filename.slice(0, max - 3) + '...' : '.../' + filename;
}
