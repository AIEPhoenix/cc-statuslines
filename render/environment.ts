import type { RenderContext } from '../types.ts';
import { buildModelSegment } from './segments.ts';

const FAINT = '\x1b[38;5;242m'; // quieter than the standard dim label — pure background info
const RESET = '\x1b[0m';

export function renderEnvironmentLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const parts: string[] = [];

  if (ctx.claudeCodeVersion) parts.push(faint(`v${ctx.claudeCodeVersion}`));

  if (display?.showConfigCounts !== false) {
    const total = ctx.claudeMdCount + ctx.rulesCount + ctx.mcpCount + ctx.hooksCount;
    const threshold = display?.environmentThreshold ?? 0;
    if (total > 0 && total >= threshold) {
      if (ctx.claudeMdCount > 0) parts.push(faint(`${ctx.claudeMdCount} CLAUDE.md`));
      if (ctx.rulesCount > 0) parts.push(faint(`${ctx.rulesCount} rules`));
      if (ctx.mcpCount > 0) parts.push(faint(`${ctx.mcpCount} MCPs`));
      if (ctx.hooksCount > 0) parts.push(faint(`${ctx.hooksCount} hooks`));
    }
  }

  const modelPart = buildModelSegment(ctx);
  if (modelPart) parts.push(modelPart);

  return parts.length === 0 ? null : parts.join(faint(' · '));
}

function faint(text: string): string { return `${FAINT}${text}${RESET}`; }
