import { test, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseWindowValue, resolveCompactLine, readAutoCompactWindow, readAutoCompactPct } from './compact-line.ts';
import type { RenderContext } from './types.ts';

test('parseWindowValue accepts numbers and k/m strings, clamps range', () => {
  expect(parseWindowValue(200000)).toBe(200000);
  expect(parseWindowValue('500k')).toBe(500000);
  expect(parseWindowValue('1m')).toBe(1000000);
  expect(parseWindowValue('1M')).toBe(1000000);
  expect(parseWindowValue('300000')).toBe(300000);
  expect(parseWindowValue('auto')).toBeNull();
  expect(parseWindowValue('')).toBeNull();
  expect(parseWindowValue(50_000)).toBeNull();   // below 100k floor
  expect(parseWindowValue(2_000_000)).toBeNull(); // above 1M ceiling
  expect(parseWindowValue(null)).toBeNull();
  expect(parseWindowValue('abc')).toBeNull();
});

const ctxWith = (opts: { size?: number; observed?: number; configured?: number | null; pct?: number | null }): RenderContext => ({
  stdin: { context_window: { context_window_size: opts.size } },
  transcript: { tools: [], agents: [], workflows: [], todos: [], compactions: opts.observed ? { count: 1, lastAutoPreTokens: opts.observed } : undefined },
  autoCompactWindow: opts.configured ?? null,
  autoCompactPct: opts.pct ?? null,
} as unknown as RenderContext);

test('observed auto line beats configured window', () => {
  const line = resolveCompactLine(ctxWith({ size: 1_000_000, observed: 360_000, configured: 500_000 }));
  expect(line).toEqual({ tokens: 360_000, source: 'observed' });
});

test('falls back to configured window when nothing observed', () => {
  const line = resolveCompactLine(ctxWith({ size: 1_000_000, configured: 500_000 }));
  expect(line).toEqual({ tokens: 500_000, source: 'configured' });
});

test('stale observation above the current window is dropped', () => {
  // e.g. compacted at 743k on a 1M model, then switched to a 200k model
  const line = resolveCompactLine(ctxWith({ size: 200_000, observed: 743_000, configured: null }));
  expect(line).toBeNull();
});

test('returns null when nothing is known', () => {
  expect(resolveCompactLine(ctxWith({ size: 1_000_000 }))).toBeNull();
});

test('configured trigger is capped at the context window', () => {
  const line = resolveCompactLine(ctxWith({ size: 200_000, configured: 400_000 }));
  expect(line).toEqual({ tokens: 200_000, source: 'configured' });
});

// ---- readAutoCompactWindow: env > modelSettings.<id> > top-level ----

const withSettings = (user: object, project?: object) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-ac-'));
  const cfg = path.join(root, 'cfg'); const cwd = path.join(root, 'proj');
  fs.mkdirSync(cfg); fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify(user));
  if (project) fs.writeFileSync(path.join(cwd, '.claude', 'settings.json'), JSON.stringify(project));
  return { root, cfg, cwd };
};

const readWith = (user: object, modelId: string, opts: { project?: object; env?: string } = {}) => {
  const { root, cfg, cwd } = withSettings(user, opts.project);
  const saved = { dir: process.env.CLAUDE_CONFIG_DIR, win: process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW };
  process.env.CLAUDE_CONFIG_DIR = cfg;
  if (opts.env) process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = opts.env; else delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  try {
    return readAutoCompactWindow(cwd, modelId);
  } finally {
    if (saved.dir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = saved.dir;
    if (saved.win === undefined) delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW; else process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = saved.win;
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('/autocompact per-model value is read for the current model', () => {
  const user = { autoCompactWindow: 600_000, modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 400_000 } } };
  expect(readWith(user, 'claude-opus-5-5')).toBe(400_000);
  expect(readWith(user, 'claude-opus-5-5[1m]')).toBe(400_000);
  expect(readWith(user, 'claude-sonnet-5-5')).toBe(600_000);
});

test('per-model "auto" means the built-in default, not the top-level value', () => {
  const user = { autoCompactWindow: 600_000, modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 'auto' } } };
  expect(readWith(user, 'claude-opus-5-5')).toBeNull();
});

test('env var beats settings; project per-model beats user per-model', () => {
  const user = { modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 400_000 } } };
  expect(readWith(user, 'claude-opus-5-5', { env: '300k' })).toBe(300_000);
  expect(readWith(user, 'claude-opus-5-5', { project: { modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 250_000 } } } })).toBe(250_000);
});

test('env window out of range is clamped like the CLI does; settings stay strict', () => {
  expect(parseWindowValue('200', { clamp: true })).toBe(100_000);
  expect(parseWindowValue('2M', { clamp: true })).toBe(1_000_000);
  expect(parseWindowValue('abc', { clamp: true })).toBeNull();
  expect(readWith({}, 'claude-opus-5-5', { env: '200' })).toBe(100_000);
  expect(readWith({ autoCompactWindow: 50_000 }, 'claude-opus-5-5')).toBeNull();
});

test('PCT override scales a window below the context limit', () => {
  expect(resolveCompactLine(ctxWith({ size: 1_000_000, configured: 400_000, pct: 50 }))).toEqual({ tokens: 200_000, source: 'configured' });
  // Window capped at the limit: the session compacts at the limit, override does not apply.
  expect(resolveCompactLine(ctxWith({ size: 200_000, configured: 400_000, pct: 50 }))).toEqual({ tokens: 200_000, source: 'configured' });
  // An observed compaction still wins.
  expect(resolveCompactLine(ctxWith({ size: 1_000_000, observed: 190_000, configured: 400_000, pct: 50 }))).toEqual({ tokens: 190_000, source: 'observed' });
});

test('readAutoCompactPct accepts 1 to under 100 only', () => {
  const saved = process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE;
  const read = (v?: string) => {
    if (v === undefined) delete process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE; else process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = v;
    return readAutoCompactPct();
  };
  try {
    expect(read('50')).toBe(50);
    expect(read(' 75.5 ')).toBe(75.5);
    expect(read('100')).toBeNull();
    expect(read('150')).toBeNull();
    expect(read('0')).toBeNull();
    expect(read('-5')).toBeNull();
    expect(read('abc')).toBeNull();
    expect(read()).toBeNull();
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE; else process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = saved;
  }
});
