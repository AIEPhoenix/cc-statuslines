import type { RenderContext } from '../types.ts';
import { getModelName, getProviderLabel } from '../stdin.ts';

import { git as gitColor, gitBranch as gitBranchColor, label, model as modelColor, project as projectColor, red, dim } from './colors.ts';

const COST_COLOR = '\x1b[38;5;220m'; // warm gold
const RESET = '\x1b[0m';
function cost(text: string): string { return `${COST_COLOR}${text}${RESET}`; }

export function renderProjectLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const colors = ctx.config?.colors;
  const parts: string[] = [];

  if (ctx.claudeCodeVersion) {
    parts.push(label(`v${ctx.claudeCodeVersion}`, colors));
  }

  if (display?.showModel !== false) {
    const m = getModelName(ctx.stdin);
    const provider = getProviderLabel(ctx.stdin);
    const showUsage = display?.showUsage !== false;
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
    const qualifier = provider ?? (showUsage && hasApiKey ? red('API') : undefined);
    const modelDisplay = qualifier ? `${m} | ${qualifier}` : m;
    parts.push(modelColor(modelDisplay, colors));
  }

  let projectPart: string | null = null;
  if (display?.showProject !== false && ctx.stdin.cwd) {
    const segments = ctx.stdin.cwd.split(/[/\\]/).filter(Boolean);
    const levels = ctx.config?.pathLevels ?? 1;
    projectPart = projectColor(segments.length > 0 ? segments.slice(-levels).join('/') : '/', colors);
  }

  let gitPart = '';
  const gc = ctx.config?.gitStatus;
  if ((gc?.enabled ?? true) && ctx.gitStatus) {
    const gp: string[] = [ctx.gitStatus.branch];
    if ((gc?.showDirty ?? true) && ctx.gitStatus.isDirty) gp.push('*');
    if (gc?.showAheadBehind) {
      if (ctx.gitStatus.ahead > 0) gp.push(` ↑${ctx.gitStatus.ahead}`);
      if (ctx.gitStatus.behind > 0) gp.push(` ↓${ctx.gitStatus.behind}`);
    }
    if (gc?.showFileStats && ctx.gitStatus.fileStats) {
      const { modified, added, deleted, untracked } = ctx.gitStatus.fileStats;
      const sp: string[] = [];
      if (modified > 0) sp.push(`!${modified}`);
      if (added > 0) sp.push(`+${added}`);
      if (deleted > 0) sp.push(`✘${deleted}`);
      if (untracked > 0) sp.push(`?${untracked}`);
      if (sp.length > 0) gp.push(` ${sp.join(' ')}`);
    }
    gitPart = `${gitColor('git:(', colors)}${gitBranchColor(gp.join(''), colors)}${gitColor(')', colors)}`;
  }

  if (projectPart && gitPart) parts.push(`${projectPart} ${gitPart}`);
  else if (projectPart) parts.push(projectPart);
  else if (gitPart) parts.push(gitPart);

  if (display?.showSessionName && ctx.transcript.sessionName) parts.push(label(ctx.transcript.sessionName, colors));
  const costVal = ctx.stdin.cost?.total_cost_usd;
  if (display?.showDuration !== false && ctx.sessionDuration && typeof costVal === 'number') {
    parts.push(`${label(`${ctx.sessionDuration}`, colors)} ${cost(`$${costVal.toFixed(2)}`)}`);
  } else if (display?.showDuration !== false && ctx.sessionDuration) {
    parts.push(label(`${ctx.sessionDuration}`, colors));
  } else if (typeof costVal === 'number') {
    parts.push(cost(`$${costVal.toFixed(2)}`));
  }

  return parts.length === 0 ? null : parts.join(dim(' │ '));
}
