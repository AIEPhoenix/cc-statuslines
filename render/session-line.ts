import type { RenderContext } from '../types.ts';
import { isLimitReached } from '../types.ts';
import { getContextPercent, getBufferedPercent, getModelName, getProviderLabel, getTotalTokens } from '../stdin.ts';

import { coloredBar, critical, git as gitColor, gitBranch as gitBranchColor, label, model as modelColor, project as projectColor, red, dim, getContextColor, getQuotaColor, quotaBar, RESET } from './colors.ts';

const COST_COLOR = '\x1b[38;5;220m';
function cost(text: string): string { return `${COST_COLOR}${text}${RESET}`; }
import { getAdaptiveBarWidth } from '../utils/terminal.ts';

export function renderSessionLine(ctx: RenderContext): string {
  const rawPercent = getContextPercent(ctx.stdin);
  const bufferedPercent = getBufferedPercent(ctx.stdin);
  const autocompactMode = ctx.config?.display?.autocompactBuffer ?? 'enabled';
  const percent = autocompactMode === 'disabled' ? rawPercent : bufferedPercent;
  const colors = ctx.config?.colors;
  const barWidth = getAdaptiveBarWidth();
  const bar = coloredBar(percent, barWidth, colors);
  const parts: string[] = [];
  const display = ctx.config?.display;
  const mode = display?.contextValue ?? 'percent';
  const contextValue = fmtCtxVal(ctx, percent, mode);
  const cvDisplay = `${getContextColor(percent, colors)}${contextValue}${RESET}`;

  if (ctx.claudeCodeVersion) {
    parts.push(label(`v${ctx.claudeCodeVersion}`, colors));
  }

  const providerLabel = getProviderLabel(ctx.stdin);
  const showUsage = display?.showUsage !== false;
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  const qualifier = providerLabel ?? (showUsage && hasApiKey ? red('API') : undefined);
  const m = getModelName(ctx.stdin);
  const modelDisplay = qualifier ? `${m} | ${qualifier}` : m;

  if (display?.showModel !== false && display?.showContextBar !== false)
    parts.push(`${modelColor(modelDisplay, colors)} ${bar} ${cvDisplay}`);
  else if (display?.showModel !== false) parts.push(`${modelColor(modelDisplay, colors)} ${cvDisplay}`);
  else if (display?.showContextBar !== false) parts.push(`${bar} ${cvDisplay}`);
  else parts.push(cvDisplay);

  // Project + git
  let projectPart: string | null = null;
  if (display?.showProject !== false && ctx.stdin.cwd) {
    const segs = ctx.stdin.cwd.split(/[/\\]/).filter(Boolean);
    const levels = ctx.config?.pathLevels ?? 1;
    projectPart = projectColor(segs.length > 0 ? segs.slice(-levels).join('/') : '/', colors);
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

  // Config counts
  if (display?.showConfigCounts !== false) {
    const total = ctx.claudeMdCount + ctx.rulesCount + ctx.mcpCount + ctx.hooksCount;
    const envThreshold = display?.environmentThreshold ?? 0;
    if (total > 0 && total >= envThreshold) {
      if (ctx.claudeMdCount > 0) parts.push(label(`${ctx.claudeMdCount} CLAUDE.md`, colors));
      if (ctx.rulesCount > 0) parts.push(label(`${ctx.rulesCount} rules`, colors));
      if (ctx.mcpCount > 0) parts.push(label(`${ctx.mcpCount} MCPs`, colors));
      if (ctx.hooksCount > 0) parts.push(label(`${ctx.hooksCount} hooks`, colors));
    }
  }

  // Usage
  if (display?.showUsage !== false && ctx.usageData && !providerLabel) {
    if (isLimitReached(ctx.usageData)) {
      const rt = ctx.usageData.fiveHour === 100 ? fmtReset(ctx.usageData.fiveHourResetAt) : fmtReset(ctx.usageData.sevenDayResetAt);
      parts.push(critical(`⚠ Limit reached${rt ? ` (resets ${rt})` : ''}`, colors));
    } else {
      const usageThreshold = display?.usageThreshold ?? 0;
      const { fiveHour, sevenDay } = ctx.usageData;
      if (Math.max(fiveHour ?? 0, sevenDay ?? 0) >= usageThreshold) {
        const ube = display?.usageBarEnabled ?? true;
        if (fiveHour === null && sevenDay !== null) {
          parts.push(fmtWindow({ l: '7d', percent: sevenDay, resetAt: ctx.usageData.sevenDayResetAt, colors, ube, barWidth, forceLabel: true }));
        } else {
          const fhp = fmtWindow({ l: '5h', percent: fiveHour, resetAt: ctx.usageData.fiveHourResetAt, colors, ube, barWidth });
          const sdThreshold = display?.sevenDayThreshold ?? 80;
          if (sevenDay !== null && sevenDay >= sdThreshold) {
            const sdp = fmtWindow({ l: '7d', percent: sevenDay, resetAt: ctx.usageData.sevenDayResetAt, colors, ube, barWidth });
            parts.push(`${fhp} | ${sdp}`);
          } else parts.push(fhp);
        }
      }
    }
  }

  const costVal = ctx.stdin.cost?.total_cost_usd;
  if (display?.showDuration !== false && ctx.sessionDuration && typeof costVal === 'number') {
    parts.push(`${label(`${ctx.sessionDuration}`, colors)} ${cost(`$${costVal.toFixed(2)}`)}`);
  } else if (display?.showDuration !== false && ctx.sessionDuration) {
    parts.push(label(`${ctx.sessionDuration}`, colors));
  } else if (typeof costVal === 'number') {
    parts.push(cost(`$${costVal.toFixed(2)}`));
  }

  let line = parts.join(' | ');
  if (display?.showTokenBreakdown !== false && percent >= 85) {
    const usage = ctx.stdin.context_window?.current_usage;
    if (usage) {
      const input = fmtTokens(usage.input_tokens ?? 0);
      const cache = fmtTokens((usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0));
      line += label(` (in: ${input}, cache: ${cache})`, colors);
    }
  }
  return line;
}

function fmtTokens(n: number): string { return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : n.toString(); }

function fmtCtxVal(ctx: RenderContext, percent: number, mode: 'percent' | 'tokens' | 'remaining' | 'both'): string {
  const total = getTotalTokens(ctx.stdin);
  const size = ctx.stdin.context_window?.context_window_size ?? 0;
  if (mode === 'tokens') return size > 0 ? `${fmtTokens(total)}/${fmtTokens(size)}` : fmtTokens(total);
  if (mode === 'both') return size > 0 ? `${percent}% (${fmtTokens(total)}/${fmtTokens(size)})` : `${percent}%`;
  if (mode === 'remaining') return `${Math.max(0, 100 - percent)}%`;
  return `${percent}%`;
}

function fmtPercent(p: number | null, colors?: RenderContext['config']['colors']): string {
  return p === null ? label('--', colors) : `${getQuotaColor(p, colors)}${p}%${RESET}`;
}

function fmtWindow({ l, percent, resetAt, colors, ube, barWidth, forceLabel = false }: { l: string; percent: number | null; resetAt: Date | null; colors?: RenderContext['config']['colors']; ube: boolean; barWidth: number; forceLabel?: boolean }): string {
  const ud = fmtPercent(percent, colors);
  const reset = fmtReset(resetAt);
  if (ube) {
    const body = reset ? `${quotaBar(percent ?? 0, barWidth, colors)} ${ud} (${reset} / ${l})` : `${quotaBar(percent ?? 0, barWidth, colors)} ${ud}`;
    return forceLabel ? `${l}: ${body}` : body;
  }
  return reset ? `${l}: ${ud} (${reset})` : `${l}: ${ud}`;
}

function fmtReset(d: Date | null): string {
  if (!d) return '';
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return '';
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h >= 24) { const dd = Math.floor(h / 24), rh = h % 24; return rh > 0 ? `${dd}d ${rh}h` : `${dd}d`; }
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
