import type { HudColorName, HudColorValue, HudColorOverrides } from '../config.ts';

export const RESET = '\x1b[0m';
// Curated 256-color palette: softer than raw ANSI brights, consistent across themes.
// State colors (green/yellow/red) stay semantic; identity colors are muted; metadata is gray.
const DIM = '\x1b[2m';
const RED = '\x1b[38;5;167m';            // soft red
const GREEN = '\x1b[38;5;71m';           // soft green
const YELLOW = '\x1b[38;5;179m';         // amber
const MAGENTA = '\x1b[38;5;139m';        // muted purple
const CYAN = '\x1b[38;5;116m';           // soft teal
const BRIGHT_BLUE = '\x1b[38;5;110m';    // soft blue
const BRIGHT_MAGENTA = '\x1b[38;5;175m'; // soft pink
const BRIGHT_CYAN = '\x1b[38;5;117m';    // sky
const BRIGHT_GREEN = '\x1b[38;5;108m';   // sage
const WHITE = '\x1b[38;5;251m';
const CLAUDE_ORANGE = '\x1b[38;5;208m';
const BAR_TRACK = '\x1b[38;5;238m';      // empty portion of progress bars

const ANSI_BY_NAME: Record<HudColorName, string> = { dim: DIM, red: RED, green: GREEN, yellow: YELLOW, magenta: MAGENTA, cyan: CYAN, brightBlue: BRIGHT_BLUE, brightMagenta: BRIGHT_MAGENTA };

function hexToAnsi(hex: string): string {
  return `\x1b[38;2;${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}m`;
}

function resolveAnsi(value: HudColorValue | undefined, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number') return `\x1b[38;5;${value}m`;
  if (typeof value === 'string' && value.startsWith('#') && value.length === 7) return hexToAnsi(value);
  return ANSI_BY_NAME[value as HudColorName] ?? fallback;
}

function colorize(text: string, color: string): string { return `${color}${text}${RESET}`; }
function withOverride(text: string, value: HudColorValue | undefined, fallback: string): string { return colorize(text, resolveAnsi(value, fallback)); }

export function green(text: string): string { return colorize(text, GREEN); }
export function yellow(text: string): string { return colorize(text, YELLOW); }
export function red(text: string): string { return colorize(text, RED); }
export function cyan(text: string): string { return colorize(text, CYAN); }
export function magenta(text: string): string { return colorize(text, MAGENTA); }
export function dim(text: string): string { return colorize(text, DIM); }
export function brightCyan(text: string): string { return colorize(text, BRIGHT_CYAN); }
export function brightGreen(text: string): string { return colorize(text, BRIGHT_GREEN); }
export function brightBlue(text: string): string { return colorize(text, BRIGHT_BLUE); }
export function brightMagenta(text: string): string { return colorize(text, BRIGHT_MAGENTA); }
export function white(text: string): string { return colorize(text, WHITE); }
/** Prefix-only: composes with color helpers whose trailing RESET also clears italic. */
export function italic(text: string): string { return `\x1b[3m${text}`; }

export function model(text: string, colors?: Partial<HudColorOverrides>): string { return withOverride(text, colors?.model, CYAN); }
export function project(text: string, colors?: Partial<HudColorOverrides>): string { return withOverride(text, colors?.project, YELLOW); }
export function git(text: string, colors?: Partial<HudColorOverrides>): string { return withOverride(text, colors?.git, MAGENTA); }
export function gitBranch(text: string, colors?: Partial<HudColorOverrides>): string { return withOverride(text, colors?.gitBranch, CYAN); }
export function label(text: string, colors?: Partial<HudColorOverrides>): string { return withOverride(text, colors?.label, DIM); }
export function custom(text: string, colors?: Partial<HudColorOverrides>): string { return withOverride(text, colors?.custom, CLAUDE_ORANGE); }

export function warning(text: string, colors?: Partial<HudColorOverrides>): string { return colorize(text, resolveAnsi(colors?.warning, YELLOW)); }
export function critical(text: string, colors?: Partial<HudColorOverrides>): string { return colorize(text, resolveAnsi(colors?.critical, RED)); }

export function getContextColor(percent: number, colors?: Partial<HudColorOverrides>): string {
  if (percent >= 85) return resolveAnsi(colors?.critical, RED);
  if (percent >= 70) return resolveAnsi(colors?.warning, YELLOW);
  return resolveAnsi(colors?.context, GREEN);
}

export function getQuotaColor(percent: number, colors?: Partial<HudColorOverrides>): string {
  if (percent >= 90) return resolveAnsi(colors?.critical, RED);
  if (percent >= 75) return resolveAnsi(colors?.usageWarning, BRIGHT_MAGENTA);
  return resolveAnsi(colors?.usage, BRIGHT_BLUE);
}

export function quotaBar(percent: number, width = 10, colors?: Partial<HudColorOverrides>): string {
  const w = Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0;
  const p = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const filled = Math.round((p / 100) * w);
  return `${getQuotaColor(p, colors)}${'█'.repeat(filled)}${BAR_TRACK}${'░'.repeat(w - filled)}${RESET}`;
}

export function coloredBar(percent: number, width = 10, colors?: Partial<HudColorOverrides>, markerPercent?: number | null): string {
  const w = Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0;
  const p = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const filled = Math.round((p / 100) * w);
  const fillColor = getContextColor(p, colors);
  // Tick mark (e.g. the auto-compact line) drawn over whichever cell it lands on.
  if (typeof markerPercent === 'number' && Number.isFinite(markerPercent) && markerPercent > 0 && markerPercent < 100 && w > 0) {
    const idx = Math.min(w - 1, Math.floor((markerPercent / 100) * w));
    const seg = (s: string, color: string) => (s ? `${color}${s}` : '');
    return seg('█'.repeat(Math.min(filled, idx)), fillColor)
      + seg('░'.repeat(Math.max(0, idx - filled)), BAR_TRACK)
      + `${resolveAnsi(colors?.warning, YELLOW)}┊`
      + seg('█'.repeat(Math.max(0, filled - idx - 1)), fillColor)
      + seg('░'.repeat(w - Math.max(filled, idx + 1)), BAR_TRACK)
      + RESET;
  }
  return `${fillColor}${'█'.repeat(filled)}${BAR_TRACK}${'░'.repeat(w - filled)}${RESET}`;
}
