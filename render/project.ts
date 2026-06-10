import type { RenderContext } from '../types.ts';
import { label, project as projectColor, custom as customColor, dim, italic } from './colors.ts';
import { buildGitSegment, buildAgentNameSegment } from './segments.ts';

function sep(): string { return dim(' · '); }

export function renderProjectLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const colors = ctx.config?.colors;
  const parts: string[] = [];

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

  // Cost lives on the tokens line; lines changed on the tools line
  if (display?.showDuration !== false && ctx.sessionDuration) {
    parts.push(dim(ctx.sessionDuration));
  }

  const customLine = display?.customLine;
  if (customLine) {
    parts.push(customColor(customLine, colors));
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join(sep());
}
