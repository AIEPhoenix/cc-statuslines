import type { RenderContext } from '../types.ts';

const FAINT = '\x1b[38;5;242m'; // quieter than the standard dim label — pure background info
const RESET = '\x1b[0m';

export function renderEnvironmentLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  if (display?.showConfigCounts === false) return null;

  const total = ctx.claudeMdCount + ctx.rulesCount + ctx.mcpCount + ctx.hooksCount;
  const threshold = display?.environmentThreshold ?? 0;
  if (total === 0 || total < threshold) return null;

  const parts: string[] = [];
  if (ctx.claudeMdCount > 0) parts.push(`${ctx.claudeMdCount} CLAUDE.md`);
  if (ctx.rulesCount > 0) parts.push(`${ctx.rulesCount} rules`);
  if (ctx.mcpCount > 0) parts.push(`${ctx.mcpCount} MCPs`);
  if (ctx.hooksCount > 0) parts.push(`${ctx.hooksCount} hooks`);

  return parts.length === 0 ? null : `${FAINT}${parts.join(' · ')}${RESET}`;
}
