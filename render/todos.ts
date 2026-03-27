import type { RenderContext } from '../types.ts';
import { yellow, green, label } from './colors.ts';

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

  const content = inProgress.content.length > 50 ? inProgress.content.slice(0, 47) + '...' : inProgress.content;
  return `${yellow('▸')} ${content} ${label(`(${completed}/${total})`, colors)}`;
}
