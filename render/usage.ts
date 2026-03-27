import type { RenderContext } from '../types.ts';
import { isLimitReached } from '../types.ts';
import { getProviderLabel } from '../stdin.ts';
import { critical, label, getQuotaColor, quotaBar, RESET } from './colors.ts';
import { getAdaptiveBarWidth } from '../utils/terminal.ts';

export function renderUsageLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const colors = ctx.config?.colors;
  if (display?.showUsage === false || !ctx.usageData || getProviderLabel(ctx.stdin)) return null;

  const usageLabel = label('Usage', colors);
  if (isLimitReached(ctx.usageData)) {
    const resetTime = ctx.usageData.fiveHour === 100 ? fmtReset(ctx.usageData.fiveHourResetAt) : fmtReset(ctx.usageData.sevenDayResetAt);
    return `${usageLabel} ${critical(`⚠ Limit reached${resetTime ? ` (resets ${resetTime})` : ''}`, colors)}`;
  }

  const threshold = display?.usageThreshold ?? 0;
  const { fiveHour, sevenDay } = ctx.usageData;
  if (Math.max(fiveHour ?? 0, sevenDay ?? 0) < threshold) return null;

  const usageBarEnabled = display?.usageBarEnabled ?? true;
  const barWidth = getAdaptiveBarWidth();

  if (fiveHour === null && sevenDay !== null) {
    return `${usageLabel} ${fmtWindow({ l: '7d', percent: sevenDay, resetAt: ctx.usageData.sevenDayResetAt, colors, usageBarEnabled, barWidth, forceLabel: true })}`;
  }

  const fhPart = fmtWindow({ l: '5h', percent: fiveHour, resetAt: ctx.usageData.fiveHourResetAt, colors, usageBarEnabled, barWidth });
  const sdThreshold = display?.sevenDayThreshold ?? 80;
  if (sevenDay !== null && sevenDay >= sdThreshold) {
    const sdPart = fmtWindow({ l: '7d', percent: sevenDay, resetAt: ctx.usageData.sevenDayResetAt, colors, usageBarEnabled, barWidth });
    return `${usageLabel} ${fhPart} | ${sdPart}`;
  }
  return `${usageLabel} ${fhPart}`;
}

function fmtPercent(p: number | null, colors?: RenderContext['config']['colors']): string {
  if (p === null) return label('--', colors);
  return `${getQuotaColor(p, colors)}${p}%${RESET}`;
}

function fmtWindow({ l, percent, resetAt, colors, usageBarEnabled, barWidth, forceLabel = false }: { l: string; percent: number | null; resetAt: Date | null; colors?: RenderContext['config']['colors']; usageBarEnabled: boolean; barWidth: number; forceLabel?: boolean }): string {
  const ud = fmtPercent(percent, colors);
  const reset = fmtReset(resetAt);
  if (usageBarEnabled) {
    const body = reset ? `${quotaBar(percent ?? 0, barWidth, colors)} ${ud} (resets in ${reset})` : `${quotaBar(percent ?? 0, barWidth, colors)} ${ud}`;
    return forceLabel ? `${l}: ${body}` : body;
  }
  return reset ? `${l}: ${ud} (resets in ${reset})` : `${l}: ${ud}`;
}

function fmtReset(resetAt: Date | null): string {
  if (!resetAt) return '';
  const diffMs = resetAt.getTime() - Date.now();
  if (diffMs <= 0) return '';
  const mins = Math.ceil(diffMs / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60), m = mins % 60;
  if (hours >= 24) { const d = Math.floor(hours / 24), rh = hours % 24; return rh > 0 ? `${d}d ${rh}h` : `${d}d`; }
  return m > 0 ? `${hours}h ${m}m` : `${hours}h`;
}
