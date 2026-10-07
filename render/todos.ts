import type { RenderContext } from '../types.ts';
import { yellow, green, white, label } from './colors.ts';
import { stripControl } from '../utils/text.ts';

export function renderTodosLine(ctx: RenderContext): string | null {
  const { todos } = ctx.transcript;
  const colors = ctx.config?.colors;
  if (!todos || todos.length === 0) return null;

  const inProgress = todos.find(t => t.status === 'in_progress');
  const completed = todos.filter(t => t.status === 'completed').length;
  const total = todos.length;

  if (!inProgress) {
    if (completed === total && total > 0) return `${green('✓')} All todos complete ${label(`(${completed}/${total})`, colors)}`;
    return null;
  }

  const raw = stripControl(inProgress.content);
  const content = raw.length > 50 ? raw.slice(0, 47) + '...' : raw;
  return `${yellow('▸')} ${white(content)} ${label(`(${completed}/${total})`, colors)}`;
}
