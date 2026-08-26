import { test, expect } from 'bun:test';
import { parseWindowValue, resolveCompactLine } from './compact-line.ts';
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

const ctxWith = (opts: { size?: number; observed?: number; configured?: number | null }): RenderContext => ({
  stdin: { context_window: { context_window_size: opts.size } },
  transcript: { tools: [], agents: [], workflows: [], todos: [], compactions: opts.observed ? { count: 1, lastAutoPreTokens: opts.observed } : undefined },
  autoCompactWindow: opts.configured ?? null,
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
