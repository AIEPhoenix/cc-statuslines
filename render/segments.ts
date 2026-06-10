import type { RenderContext } from '../types.ts';
import { getModelName, getProviderLabel, getEffortLevel, getWorktreeName } from '../stdin.ts';
import { git as gitColor, gitBranch as gitBranchColor, model as modelColor, brightBlue, green, red, dim } from './colors.ts';

/**
 * Shared segment builders used by both the expanded (project.ts) and
 * compact (session-line.ts) layouts, so new stdin-derived segments only
 * need to be implemented once.
 */

/** `[Fable 5 | Bedrock | high]` — model name plus provider/API and effort qualifiers. */
export function buildModelSegment(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  if (display?.showModel === false) return null;
  const colors = ctx.config?.colors;

  const qualifiers: string[] = [];
  const providerLabel = getProviderLabel(ctx.stdin);
  const showUsage = display?.showUsage !== false;
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  const provider = providerLabel ?? (showUsage && hasApiKey ? red('API') : undefined);
  if (provider) qualifiers.push(provider);

  if (display?.showEffort !== false) {
    const effort = getEffortLevel(ctx.stdin);
    if (effort) qualifiers.push(effort);
  }

  const inner = [getModelName(ctx.stdin), ...qualifiers].join(' | ');
  return modelColor(`[${inner}]`, colors);
}

/** `git:(main*) wt:feature PR #1234` — branch state plus worktree and PR context. */
export function buildGitSegment(ctx: RenderContext): string {
  const gitConfig = ctx.config?.gitStatus;
  if (!(gitConfig?.enabled ?? true) || !ctx.gitStatus) return '';
  const colors = ctx.config?.colors;

  const gitParts: string[] = [ctx.gitStatus.branch];
  if ((gitConfig?.showDirty ?? true) && ctx.gitStatus.isDirty) gitParts.push('*');
  if (gitConfig?.showAheadBehind) {
    if (ctx.gitStatus.ahead > 0) gitParts.push(` ↑${ctx.gitStatus.ahead}`);
    if (ctx.gitStatus.behind > 0) gitParts.push(` ↓${ctx.gitStatus.behind}`);
  }
  if (gitConfig?.showFileStats && ctx.gitStatus.fileStats) {
    const { modified, added, deleted, untracked } = ctx.gitStatus.fileStats;
    const statParts: string[] = [];
    if (modified > 0) statParts.push(`!${modified}`);
    if (added > 0) statParts.push(`+${added}`);
    if (deleted > 0) statParts.push(`✘${deleted}`);
    if (untracked > 0) statParts.push(`?${untracked}`);
    if (statParts.length > 0) gitParts.push(` ${statParts.join(' ')}`);
  }

  let segment = `${gitColor('git:(', colors)}${gitBranchColor(gitParts.join(''), colors)}${gitColor(')', colors)}`;

  const worktree = getWorktreeName(ctx.stdin);
  if (worktree) segment += ` ${dim(`wt:${worktree}`)}`;

  if (gitConfig?.showPR ?? true) {
    const pr = buildPRPart(ctx);
    if (pr) segment += ` ${pr}`;
  }

  return segment;
}

function buildPRPart(ctx: RenderContext): string | null {
  const pr = ctx.stdin.pr;
  if (typeof pr?.number !== 'number') return null;
  let text = `PR #${pr.number}`;
  if (pr.review_state === 'approved') text += '✓';
  else if (pr.review_state === 'changes_requested') text += '✗';
  const colored = brightBlue(text);
  return pr.url ? hyperlink(pr.url, colored) : colored;
}

/** OSC 8 clickable hyperlink (supported by Claude Code statuslines since v2.1.145). */
function hyperlink(url: string, text: string): string {
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

/** `+156/-23` — session-wide lines added/removed from stdin cost data. */
export function buildLinesChangedSegment(ctx: RenderContext): string | null {
  if (!ctx.config?.display?.showLinesChanged) return null;
  const cost = ctx.stdin.cost;
  const added = cost?.total_lines_added ?? 0;
  const removed = cost?.total_lines_removed ?? 0;
  if (added === 0 && removed === 0) return null;
  return `${green(`+${added}`)}${dim('/')}${red(`-${removed}`)}`;
}

/** `@agent-name` — present only when running via `claude --agent`. */
export function buildAgentNameSegment(ctx: RenderContext): string | null {
  const name = ctx.stdin.agent?.name?.trim();
  return name ? dim(`@${name}`) : null;
}
