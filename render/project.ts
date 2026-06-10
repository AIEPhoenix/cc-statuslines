import type { RenderContext } from '../types.ts';
import { label, project as projectColor, custom as customColor, dim, RESET } from './colors.ts';
import { buildModelSegment, buildGitSegment, buildLinesChangedSegment, buildAgentNameSegment } from './segments.ts';

const COST_COLOR = '\x1b[38;5;178m'; // muted gold
function cost(text: string): string { return `${COST_COLOR}${text}${RESET}`; }
function sep(): string { return dim(' · '); }

export function renderProjectLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const colors = ctx.config?.colors;
  const parts: string[] = [];

  const modelPart = buildModelSegment(ctx);
  if (modelPart) parts.push(modelPart);

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
    parts.push(label(ctx.transcript.sessionName, colors));
  }

  const agentPart = buildAgentNameSegment(ctx);
  if (agentPart) parts.push(agentPart);

  if (display?.showClaudeCodeVersion && ctx.claudeCodeVersion) {
    parts.push(label(`CC v${ctx.claudeCodeVersion}`, colors));
  }

  if (ctx.extraLabel) {
    parts.push(label(ctx.extraLabel, colors));
  }

  // Duration, cost, and lines changed grouped together (no separator between them)
  const costVal = ctx.stdin.cost?.total_cost_usd;
  const durationStr = (display?.showDuration !== false && ctx.sessionDuration) ? dim(ctx.sessionDuration) : '';
  const costStr = typeof costVal === 'number' ? cost(`$${costVal.toFixed(2)}`) : '';
  const linesStr = buildLinesChangedSegment(ctx) ?? '';
  const sessionStats = [durationStr, costStr, linesStr].filter(Boolean).join(' ');
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
