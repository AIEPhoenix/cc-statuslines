import type { RenderContext } from '../types.ts';
import { label, project as projectColor, custom as customColor, dim, white, italic, RESET } from './colors.ts';
import { buildGitSegment, buildAgentNameSegment, buildPermissionSegment } from './segments.ts';
import { stripControl } from '../utils/text.ts';

const DIM = '\x1b[2m';
const VALUE = '\x1b[38;5;251m';

function sep(): string { return dim(' · '); }

/** Dim the scaffolding (act/api labels, parens) but keep the time values readable. */
function fmtDurationTrio(s: string): string {
  const highlighted = s.replace(/(\d+h \d+m|\d+h|\d+m|<1m)/g, m => `${RESET}${VALUE}${m}${RESET}${DIM}`);
  return `${DIM}${highlighted}${RESET}`;
}

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
    parts.push(italic(white(stripControl(ctx.transcript.sessionName))));
  }

  const agentPart = buildAgentNameSegment(ctx);
  if (agentPart) parts.push(agentPart);

  const permissionPart = buildPermissionSegment(ctx);
  if (permissionPart) parts.push(permissionPart);

  if (ctx.extraLabel) {
    parts.push(label(ctx.extraLabel, colors));
  }

  // Cost lives on the tokens line; lines changed on the tools line
  if (display?.showDuration !== false && ctx.sessionDuration) {
    parts.push(fmtDurationTrio(ctx.sessionDuration));
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
