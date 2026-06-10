import type { RenderContext } from '../types.ts';
import { label, project as projectColor, custom as customColor, dim, italic, RESET } from './colors.ts';
import { buildModelSegment, buildGitSegment, buildAgentNameSegment } from './segments.ts';

const COST_COLOR = '\x1b[38;5;178m'; // muted gold
function cost(text: string): string { return `${COST_COLOR}${text}${RESET}`; }
function sep(): string { return dim(' · '); }

export function renderProjectLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const colors = ctx.config?.colors;
  const parts: string[] = [];

  // The model bracket leads the tokens line when that line is enabled;
  // it only falls back here when the tokens line is off.
  if (display?.showTokens === false) {
    const modelPart = buildModelSegment(ctx);
    if (modelPart) parts.push(modelPart);
  }

  let projectPart: string | null = null;
  if (display?.showProject !== false && ctx.stdin.cwd) {
    const segments = ctx.stdin.cwd.split(/[/\\]/).filter(Boolean);
    const pathLevels = ctx.config?.pathLevels ?? 1;
    const projectPath = segments.length > 0 ? segments.slice(-pathLevels).join('/') : '/';
    projectPart = projectColor(projectPath, colors);
  }

  const gitPart = buildGitSegment(ctx);

  if (projectPart && gitPart) {
    parts.push(`${projectPart} ${gitPart}`);
  } else if (projectPart) {
    parts.push(projectPart);
  } else if (gitPart) {
    parts.push(gitPart);
  }

  if (display?.showSessionName && ctx.transcript.sessionName) {
    parts.push(italic(label(ctx.transcript.sessionName, colors)));
  }

  const agentPart = buildAgentNameSegment(ctx);
  if (agentPart) parts.push(agentPart);

  if (ctx.extraLabel) {
    parts.push(label(ctx.extraLabel, colors));
  }

  // Duration and cost grouped together (no separator between them);
  // lines changed lives on the environment line
  const costVal = ctx.stdin.cost?.total_cost_usd;
  const durationStr = (display?.showDuration !== false && ctx.sessionDuration) ? dim(ctx.sessionDuration) : '';
  const costStr = typeof costVal === 'number' ? cost(`$${costVal.toFixed(2)}`) : '';
  const sessionStats = [durationStr, costStr].filter(Boolean).join(' ');
  if (sessionStats) parts.push(sessionStats);

  const customLine = display?.customLine;
  if (customLine) {
    parts.push(customColor(customLine, colors));
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join(sep());
}
