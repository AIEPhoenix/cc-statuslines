import type { RenderContext } from '../types.ts';
import { isLimitReached } from '../types.ts';
import { getContextPercent, getBufferedPercent, getProviderLabel, getTotalTokens } from '../stdin.ts';
import { coloredBar, critical, label, project as projectColor, getContextColor, getQuotaColor, quotaBar, custom as customColor, RESET } from './colors.ts';
import { getAdaptiveBarWidth } from '../utils/terminal.ts';
import { buildModelSegment, buildGitSegment, buildLinesChangedSegment, buildAgentNameSegment } from './segments.ts';

const COST_COLOR = '\x1b[38;5;220m';
function cost(text: string): string { return `${COST_COLOR}${text}${RESET}`; }

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
  const contextValueMode = display?.contextValue ?? 'percent';
  const contextValue = formatContextValue(ctx, percent, contextValueMode);
  const contextValueDisplay = `${getContextColor(percent, colors)}${contextValue}${RESET}`;

  // Model and context bar (FIRST)
  const providerLabel = getProviderLabel(ctx.stdin);
  const modelPart = buildModelSegment(ctx);

  if (modelPart && display?.showContextBar !== false) {
    parts.push(`${modelPart} ${bar} ${contextValueDisplay}`);
  } else if (modelPart) {
    parts.push(`${modelPart} ${contextValueDisplay}`);
  } else if (display?.showContextBar !== false) {
    parts.push(`${bar} ${contextValueDisplay}`);
  } else {
    parts.push(contextValueDisplay);
  }

  // Project path + git status
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

  // Session name
  if (display?.showSessionName && ctx.transcript.sessionName) {
    parts.push(label(ctx.transcript.sessionName, colors));
  }

  const agentPart = buildAgentNameSegment(ctx);
  if (agentPart) parts.push(agentPart);

  if (display?.showClaudeCodeVersion && ctx.claudeCodeVersion) {
    parts.push(label(`CC v${ctx.claudeCodeVersion}`, colors));
  }

  // Config counts
  if (display?.showConfigCounts !== false) {
    const totalCounts = ctx.claudeMdCount + ctx.rulesCount + ctx.mcpCount + ctx.hooksCount;
    const envThreshold = display?.environmentThreshold ?? 0;
    if (totalCounts > 0 && totalCounts >= envThreshold) {
      if (ctx.claudeMdCount > 0) parts.push(label(`${ctx.claudeMdCount} CLAUDE.md`, colors));
      if (ctx.rulesCount > 0) parts.push(label(`${ctx.rulesCount} rules`, colors));
      if (ctx.mcpCount > 0) parts.push(label(`${ctx.mcpCount} MCPs`, colors));
      if (ctx.hooksCount > 0) parts.push(label(`${ctx.hooksCount} hooks`, colors));
    }
  }

  // Usage limits
  if (display?.showUsage !== false && ctx.usageData && !providerLabel) {
    if (isLimitReached(ctx.usageData)) {
      const resetTime = ctx.usageData.fiveHour === 100
        ? formatResetTime(ctx.usageData.fiveHourResetAt)
        : formatResetTime(ctx.usageData.sevenDayResetAt);
      parts.push(critical(`⚠ Limit reached${resetTime ? ` (resets ${resetTime})` : ''}`, colors));
    } else {
      const usageThreshold = display?.usageThreshold ?? 0;
      const fiveHour = ctx.usageData.fiveHour;
      const sevenDay = ctx.usageData.sevenDay;
      const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0);
      if (effectiveUsage >= usageThreshold) {
        const usageBarEnabled = display?.usageBarEnabled ?? true;
        if (fiveHour === null && sevenDay !== null) {
          parts.push(formatUsageWindowPart({ label: '7d', percent: sevenDay, resetAt: ctx.usageData.sevenDayResetAt, colors, usageBarEnabled, barWidth, forceLabel: true }));
        } else {
          const fiveHourPart = formatUsageWindowPart({ label: '5h', percent: fiveHour, resetAt: ctx.usageData.fiveHourResetAt, colors, usageBarEnabled, barWidth });
          const sevenDayThreshold = display?.sevenDayThreshold ?? 80;
          if (sevenDay !== null && sevenDay >= sevenDayThreshold) {
            const sevenDayPart = formatUsageWindowPart({ label: '7d', percent: sevenDay, resetAt: ctx.usageData.sevenDayResetAt, colors, usageBarEnabled, barWidth });
            parts.push(`${fiveHourPart} | ${sevenDayPart}`);
          } else {
            parts.push(fiveHourPart);
          }
        }
      }
    }
  }

  // Duration
  if (display?.showDuration !== false && ctx.sessionDuration) {
    parts.push(label(`⏱️  ${ctx.sessionDuration}`, colors));
  }

  if (ctx.extraLabel) {
    parts.push(label(ctx.extraLabel, colors));
  }

  // Custom line
  const customLine = display?.customLine;
  if (customLine) {
    parts.push(customColor(customLine, colors));
  }

  // Our addition: cost + lines changed
  const costVal = ctx.stdin.cost?.total_cost_usd;
  const linesStr = buildLinesChangedSegment(ctx);
  if (typeof costVal === 'number') {
    parts.push(linesStr ? `${cost(`$${costVal.toFixed(2)}`)} ${linesStr}` : cost(`$${costVal.toFixed(2)}`));
  } else if (linesStr) {
    parts.push(linesStr);
  }

  let line = parts.join(' | ');

  // Token breakdown at high context
  if (display?.showTokenBreakdown !== false && percent >= 85) {
    const usage = ctx.stdin.context_window?.current_usage;
    if (usage) {
      const input = formatTokens(usage.input_tokens ?? 0);
      const cache = formatTokens((usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0));
      line += label(` (in: ${input}, cache: ${cache})`, colors);
    }
  }

  return line;
}

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return n.toString();
}

function formatContextValue(ctx: RenderContext, percent: number, mode: 'percent' | 'tokens' | 'remaining' | 'both'): string {
  const totalTokens = getTotalTokens(ctx.stdin);
  const size = ctx.stdin.context_window?.context_window_size ?? 0;
  if (mode === 'tokens') return size > 0 ? `${formatTokens(totalTokens)}/${formatTokens(size)}` : formatTokens(totalTokens);
  if (mode === 'both') return size > 0 ? `${percent}% (${formatTokens(totalTokens)}/${formatTokens(size)})` : `${percent}%`;
  if (mode === 'remaining') return `${Math.max(0, 100 - percent)}%`;
  return `${percent}%`;
}

function formatUsagePercent(percent: number | null, colors?: RenderContext['config']['colors']): string {
  if (percent === null) return label('--', colors);
  const color = getQuotaColor(percent, colors);
  return `${color}${percent}%${RESET}`;
}

function formatUsageWindowPart({ label: l, percent, resetAt, colors, usageBarEnabled, barWidth, forceLabel = false }: {
  label: '5h' | '7d'; percent: number | null; resetAt: Date | null;
  colors?: RenderContext['config']['colors']; usageBarEnabled: boolean; barWidth: number; forceLabel?: boolean;
}): string {
  const usageDisplay = formatUsagePercent(percent, colors);
  const reset = formatResetTime(resetAt);
  if (usageBarEnabled) {
    const body = reset ? `${quotaBar(percent ?? 0, barWidth, colors)} ${usageDisplay} (${reset} / ${l})` : `${quotaBar(percent ?? 0, barWidth, colors)} ${usageDisplay}`;
    return forceLabel ? `${l}: ${body}` : body;
  }
  return reset ? `${l}: ${usageDisplay} (${reset})` : `${l}: ${usageDisplay}`;
}

function formatResetTime(resetAt: Date | null): string {
  if (!resetAt) return '';
  const now = new Date();
  const diffMs = resetAt.getTime() - now.getTime();
  if (diffMs <= 0) return '';
  const diffMins = Math.ceil(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  if (hours >= 24) { const days = Math.floor(hours / 24); const remHours = hours % 24; return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`; }
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
