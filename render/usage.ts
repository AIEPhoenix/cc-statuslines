import type { RenderContext, SpendLimitData } from '../types.ts';
import { isLimitReached } from '../types.ts';
import { getProviderLabel } from '../stdin.ts';
import { critical, label, getQuotaColor, quotaBar, RESET } from './colors.ts';
import { getAdaptiveBarWidth } from '../utils/terminal.ts';

export function renderUsageLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const colors = ctx.config?.colors;
  if (display?.showUsage === false || !ctx.usageData || getProviderLabel(ctx.stdin)) return null;

  const usageLabel = label('Usage', colors);
  const { fiveHour, sevenDay, spend } = ctx.usageData;
  if (isLimitReached(ctx.usageData)) {
    const resetTime = fiveHour === 100 ? fmtReset(ctx.usageData.fiveHourResetAt)
      : sevenDay === 100 ? fmtReset(ctx.usageData.sevenDayResetAt)
      : fmtReset(spend?.resetAt ?? null);
    return `${usageLabel} ${critical(`⚠ Limit reached${resetTime ? ` (resets ${resetTime})` : ''}`, colors)}`;
  }

  const threshold = display?.usageThreshold ?? 0;
  if (Math.max(fiveHour ?? 0, sevenDay ?? 0, spend?.percent ?? 0) < threshold) return null;

  const usageBarEnabled = display?.usageBarEnabled ?? true;
  const barWidth = getAdaptiveBarWidth();
  // Gateway spend cap: `$314/$500 63% (monthly · resets 3d)`. Shown whenever
  // present — a gateway user typically has no 5h/7d windows at all.
  const spendPart = spend ? fmtSpend(spend, colors, usageBarEnabled, barWidth) : null;

  if (fiveHour === null && sevenDay === null) {
    return spendPart ? `${usageLabel} ${spendPart}` : null;
  }

  let body: string;
  if (fiveHour === null && sevenDay !== null) {
    body = fmtWindow({ l: '7d', percent: sevenDay, resetAt: ctx.usageData.sevenDayResetAt, colors, usageBarEnabled, barWidth, forceLabel: true });
  } else {
    body = fmtWindow({ l: '5h', percent: fiveHour, resetAt: ctx.usageData.fiveHourResetAt, colors, usageBarEnabled, barWidth });
    const sdThreshold = display?.sevenDayThreshold ?? 80;
    if (sevenDay !== null && sevenDay >= sdThreshold) {
      body += ` | ${fmtWindow({ l: '7d', percent: sevenDay, resetAt: ctx.usageData.sevenDayResetAt, colors, usageBarEnabled, barWidth })}`;
    }
  }
  if (spendPart) body += ` | ${spendPart}`;
  return `${usageLabel} ${body}`;
}

function fmtSpend(spend: SpendLimitData, colors: RenderContext['config']['colors'] | undefined, usageBarEnabled: boolean, barWidth: number): string {
  const pct = fmtPercent(spend.percent, colors);
  const dollars = spend.usedUsd !== null && spend.limitUsd !== null ? `${fmtUsd(spend.usedUsd)}/${fmtUsd(spend.limitUsd)} ` : '';
  const reset = fmtReset(spend.resetAt);
  const notes = [spend.period, reset ? `resets ${reset}` : ''].filter(Boolean).join(' · ');
  const tail = notes ? ` ${label(`(${notes})`, colors)}` : '';
  const bar = usageBarEnabled ? `${quotaBar(spend.percent, barWidth, colors)} ` : '';
  return `${label('spend', colors)} ${bar}${dollars}${pct}${tail}`;
}

function fmtUsd(n: number): string {
  return n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2).replace(/\.00$/, '')}`;
}

function fmtPercent(p: number | null, colors?: RenderContext['config']['colors']): string {
  if (p === null) return label('--', colors);
  return `${getQuotaColor(p, colors)}${p}%${RESET}`;
}

function fmtWindow({ l, percent, resetAt, colors, usageBarEnabled, barWidth, forceLabel = false }: { l: string; percent: number | null; resetAt: Date | null; colors?: RenderContext['config']['colors']; usageBarEnabled: boolean; barWidth: number; forceLabel?: boolean }): string {
  const ud = fmtPercent(percent, colors);
  const reset = fmtReset(resetAt);
  if (usageBarEnabled) {
    const body = reset ? `${quotaBar(percent ?? 0, barWidth, colors)} ${ud} ${label(`(resets in ${reset})`, colors)}` : `${quotaBar(percent ?? 0, barWidth, colors)} ${ud}`;
    return forceLabel ? `${l}: ${body}` : body;
  }
  return reset ? `${l}: ${ud} ${label(`(resets in ${reset})`, colors)}` : `${l}: ${ud}`;
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
