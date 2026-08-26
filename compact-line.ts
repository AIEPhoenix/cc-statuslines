import * as fs from 'node:fs';
import * as path from 'node:path';
import { getClaudeConfigDir } from './config.ts';
import type { RenderContext } from './types.ts';

// Claude Code clamps configured auto-compact windows to this range (cli.js v2.1.x).
const MIN_WINDOW = 100_000;
const MAX_WINDOW = 1_000_000;

/**
 * The auto-compact window as explicitly configured by the user, or null when
 * unset. Mirrors the CLI's resolution order for the sources visible to us:
 * CLAUDE_CODE_AUTO_COMPACT_WINDOW env var (the statusline process inherits the
 * CLI's environment), then `autoCompactWindow` in settings, local > project >
 * user. Server-delivered (clientdata/experiment) and built-in model defaults
 * are intentionally NOT modeled — those are version-dependent internals; the
 * observed line from the transcript covers them instead.
 */
export function readAutoCompactWindow(cwd?: string): number | null {
  const fromEnv = parseWindowValue(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
  if (fromEnv !== null) return fromEnv;

  const files: string[] = [];
  if (cwd) {
    files.push(path.join(cwd, '.claude', 'settings.local.json'));
    files.push(path.join(cwd, '.claude', 'settings.json'));
  }
  files.push(path.join(getClaudeConfigDir(), 'settings.json'));

  for (const file of files) {
    try {
      const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
      const parsed = parseWindowValue(settings.autoCompactWindow);
      if (parsed !== null) return parsed;
    } catch {}
  }
  return null;
}

/** Accepts 200000, "200000", "500k", "1m"; "auto"/invalid/out-of-range → null. */
export function parseWindowValue(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') {
    n = v;
  } else if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (!s || s === 'auto') return null;
    const m = s.match(/^(\d+(?:\.\d+)?)([km])?$/);
    if (!m) return null;
    n = parseFloat(m[1]) * (m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1);
  } else {
    return null;
  }
  if (!Number.isFinite(n)) return null;
  n = Math.round(n);
  return n >= MIN_WINDOW && n <= MAX_WINDOW ? n : null;
}

export interface CompactLine {
  tokens: number;
  /** 'observed' = learned from a trigger:"auto" compact_boundary in this
   * session; 'configured' = estimated from env/settings (nominal window,
   * actual trigger fires somewhat below it). */
  source: 'observed' | 'configured';
}

/**
 * Best current belief about where auto-compact will fire, per the
 * estimate-then-revise strategy: start from the configured window, switch to
 * the observed trigger point once this session has auto-compacted.
 */
export function resolveCompactLine(ctx: RenderContext): CompactLine | null {
  const size = ctx.stdin.context_window?.context_window_size ?? 0;
  const inWindow = (t: number | undefined): t is number =>
    typeof t === 'number' && t > 0 && (size <= 0 || t <= size);

  // A mid-session model switch can shrink the window below a previously
  // observed line; such stale observations are dropped rather than clamped.
  const observed = ctx.transcript.compactions?.lastAutoPreTokens;
  if (inWindow(observed)) return { tokens: observed, source: 'observed' };

  const configured = ctx.autoCompactWindow;
  if (typeof configured === 'number' && inWindow(configured)) return { tokens: configured, source: 'configured' };
  return null;
}
