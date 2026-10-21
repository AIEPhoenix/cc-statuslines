import * as fs from 'node:fs';
import * as path from 'node:path';
import { getClaudeConfigDir } from './config.ts';
import type { RenderContext } from './types.ts';

// Claude Code clamps configured auto-compact windows to this range (cli.js v2.1.x).
const MIN_WINDOW = 100_000;
const MAX_WINDOW = 1_000_000;

/**
 * The auto-compact window as explicitly configured by the user, or null when
 * unset. Per the docs it is the trigger point ("how full the context window
 * gets before Claude Code compacts"), not a window size. Mirrors the CLI's
 * resolution order for the sources visible to us:
 * CLAUDE_CODE_AUTO_COMPACT_WINDOW env var (the statusline process inherits the
 * CLI's environment), then the per-model `modelSettings.<id>.autoCompactWindow`
 * that `/autocompact` writes (CC ≥2.1.288), then the top-level
 * `autoCompactWindow`; each in settings local > project > user. A per-model
 * "auto" means the model's built-in default. Server-delivered and built-in
 * model defaults are intentionally NOT modeled — those are version-dependent
 * internals; the observed line from the transcript covers them instead.
 */
export function readAutoCompactWindow(cwd?: string, modelId?: string): number | null {
  const fromEnv = parseWindowValue(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, { clamp: true });
  if (fromEnv !== null) return fromEnv;

  const files: string[] = [];
  if (cwd) {
    files.push(path.join(cwd, '.claude', 'settings.local.json'));
    files.push(path.join(cwd, '.claude', 'settings.json'));
  }
  files.push(path.join(getClaudeConfigDir(), 'settings.json'));

  const allSettings: Record<string, unknown>[] = [];
  for (const file of files) {
    try {
      const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (settings && typeof settings === 'object') allSettings.push(settings);
    } catch {}
  }

  const modelKeys = modelId ? [modelId, modelId.replace(/\[[^\]]*\]$/, '')] : [];
  for (const settings of allSettings) {
    const perModel = settings.modelSettings as Record<string, { autoCompactWindow?: unknown }> | undefined;
    for (const key of modelKeys) {
      const v = perModel?.[key]?.autoCompactWindow;
      if (typeof v === 'string' && v.trim().toLowerCase() === 'auto') return null;
      const parsed = parseWindowValue(v);
      if (parsed !== null) return parsed;
    }
  }
  for (const settings of allSettings) {
    const parsed = parseWindowValue(settings.autoCompactWindow);
    if (parsed !== null) return parsed;
  }
  return null;
}

/**
 * Accepts 200000, "200000", "500k", "1m"; "auto"/invalid → null. Out of range
 * is null, or with `clamp` pulled to 100k–1M: the CLI does that (with a
 * warning) for CLAUDE_CODE_AUTO_COMPACT_WINDOW, so "200" means 100k there.
 */
export function parseWindowValue(v: unknown, opts: { clamp?: boolean } = {}): number | null {
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
  if (opts.clamp) return n > 0 ? Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, n)) : null;
  return n >= MIN_WINDOW && n <= MAX_WINDOW ? n : null;
}

/**
 * CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: the percentage (1–100) of the auto-compact
 * window at which compaction triggers. It can only lower the trigger, so 100
 * and anything invalid → null.
 */
export function readAutoCompactPct(): number | null {
  const raw = process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE?.trim();
  if (!raw || !/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const pct = parseFloat(raw);
  return pct >= 1 && pct < 100 ? pct : null;
}

export interface CompactLine {
  tokens: number;
  /** 'observed' = learned from a trigger:"auto" compact_boundary in this
   * session; 'configured' = the trigger set in env/settings. */
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

  // The CLI caps a configured trigger at the model's context window.
  const configured = ctx.autoCompactWindow;
  if (typeof configured === 'number' && configured > 0) {
    const window = size > 0 ? Math.min(configured, size) : configured;
    // The percentage override only applies when the session compacts before
    // the model's context limit; a window capped at the limit does not.
    const pct = ctx.autoCompactPct;
    const scaled = typeof pct === 'number' && (size <= 0 || window < size) ? Math.round(window * pct / 100) : window;
    return { tokens: scaled, source: 'configured' };
  }
  return null;
}
