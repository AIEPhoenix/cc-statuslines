import { test, expect } from 'bun:test';
import { getUsageFromStdin, getPermissionMode } from './stdin.ts';
import { isLimitReached } from './types.ts';
import type { StdinData, RenderContext } from './types.ts';
import { DEFAULT_CONFIG } from './config.ts';
import { renderCacheLine, renderCachePart } from './render/cache.ts';
import { renderUsageLine } from './render/usage.ts';
import { buildPermissionSegment, buildModelSegment, buildGitSegment } from './render/segments.ts';

const strip = (s: string | null) => (s ?? '').replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/g, '');

const ctxOf = (stdin: StdinData, extra: Partial<RenderContext> = {}): RenderContext => ({
  stdin,
  transcript: { tools: [], agents: [], workflows: [], todos: [] },
  claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0,
  sessionDuration: '',
  gitStatus: null,
  usageData: getUsageFromStdin(stdin),
  config: DEFAULT_CONFIG,
  extraLabel: null,
  ...extra,
});

const NOW_S = Math.floor(Date.now() / 1000);

// ---------- rate_limits.spend_limit (CC ≥2.1.251, dollars ≥2.1.284) ----------

test('spend_limit alone still yields usage data (gateway users have no 5h/7d)', () => {
  const u = getUsageFromStdin({ rate_limits: { spend_limit: { used_percentage: 62.8, resets_at: NOW_S + 86400, used_usd: 314.12, limit_usd: 500, period: 'monthly' } } });
  expect(u).not.toBeNull();
  expect(u!.fiveHour).toBeNull();
  expect(u!.spend).toEqual({ percent: 63, resetAt: new Date((NOW_S + 86400) * 1000), usedUsd: 314.12, limitUsd: 500, period: 'monthly' });
});

test('spend_limit without the 2.1.284 dollar fields parses with nulls', () => {
  const u = getUsageFromStdin({ rate_limits: { spend_limit: { used_percentage: 10, resets_at: NOW_S + 60 } } });
  expect(u!.spend).toEqual({ percent: 10, resetAt: new Date((NOW_S + 60) * 1000), usedUsd: null, limitUsd: null, period: null });
});

test('spend at 100% counts as limit reached', () => {
  const u = getUsageFromStdin({ rate_limits: { spend_limit: { used_percentage: 100, resets_at: NOW_S + 60 } } })!;
  expect(isLimitReached(u)).toBe(true);
});

test('usage line renders spend-only and spend-alongside-5h', () => {
  const only = strip(renderUsageLine(ctxOf({ rate_limits: { spend_limit: { used_percentage: 62.8, resets_at: NOW_S + 3 * 86400, used_usd: 314.12, limit_usd: 500, period: 'monthly' } } })));
  expect(only).toContain('spend');
  expect(only).toContain('$314/$500');
  expect(only).toContain('63%');
  expect(only).toContain('monthly');
  const both = strip(renderUsageLine(ctxOf({ rate_limits: { five_hour: { used_percentage: 28, resets_at: NOW_S + 3600 }, spend_limit: { used_percentage: 5, resets_at: NOW_S + 60 } } })));
  expect(both).toContain('28%');
  expect(both).toContain('| spend');
});

test('no rate_limits at all → no usage line', () => {
  expect(renderUsageLine(ctxOf({}))).toBeNull();
});

// ---------- prompt_cache (CC ≥2.1.251) ----------

const warmCache = () => ({
  warm: true, caching_observed: true, ttl: '1h', expires_at: NOW_S + 42 * 60, requests: 14, misses: 2,
  expected_rebuilds: 1, hit_ratio: 0.93, cache_write_tokens: 352000, miss_recache_tokens: 310200,
  last_miss_at: NOW_S - 1800, last_miss_cause: { causes: ['tools_changed'], tools_added: 2, tools_removed: 0 },
  miss_causes: { tools_changed: 2 }, recache_tokens_if_cold: 45000,
});

test('cache line: warm', () => {
  const line = strip(renderCacheLine(ctxOf({ prompt_cache: warmCache() })));
  expect(line).toBe('Cache ● 1h · expires 42m · hit 93% · miss 2/14 (tools_changed +2 tools)');
  expect(strip(renderCachePart(ctxOf({ prompt_cache: warmCache() })))).toBe('cache ●42m 93%');
});

test('cache line: cold shows recache cost, no expiry', () => {
  const line = strip(renderCacheLine(ctxOf({ prompt_cache: { ...warmCache(), warm: false, expires_at: null } })));
  expect(line).toBe('Cache ○ cold · recache 45k · hit 93% · miss 2/14 (tools_changed +2 tools)');
  expect(strip(renderCachePart(ctxOf({ prompt_cache: { ...warmCache(), warm: false, expires_at: null } })))).toBe('cache ○cold 93%');
});

test('cache line: expiring within 5 minutes is flagged but still warm', () => {
  const line = strip(renderCacheLine(ctxOf({ prompt_cache: { ...warmCache(), expires_at: NOW_S + 120 } })));
  expect(line).toContain('Cache ●');
  expect(line).toContain('expires 2m');
});

test('cache line: every nullable field null, no misses', () => {
  const line = strip(renderCacheLine(ctxOf({ prompt_cache: { warm: true, caching_observed: true, ttl: '5m', expires_at: null, requests: 1, misses: 0, hit_ratio: null, last_miss_at: null, last_miss_cause: null, recache_tokens_if_cold: null } })));
  expect(line).toBe('Cache ● 5m');
});

test('cache line: not observed / absent / disabled', () => {
  expect(strip(renderCacheLine(ctxOf({ prompt_cache: { warm: false, caching_observed: false, requests: 3, misses: 3 } })))).toBe('Cache ○ not observed · miss 3/3');
  expect(renderCachePart(ctxOf({ prompt_cache: { warm: false, caching_observed: false, requests: 3 } }))).toBeNull();
  expect(renderCacheLine(ctxOf({}))).toBeNull();
  expect(renderCacheLine(ctxOf({ prompt_cache: null }))).toBeNull();
  const off = { ...DEFAULT_CONFIG, display: { ...DEFAULT_CONFIG.display, showCache: false } };
  expect(renderCacheLine(ctxOf({ prompt_cache: warmCache() }, { config: off }))).toBeNull();
});

// ---------- permission_mode / fast_mode / pr.kind ----------

test('permission mode badge: default hidden, known modes labelled, unknown shown verbatim', () => {
  expect(getPermissionMode({ permission_mode: 'default' })).toBeNull();
  expect(getPermissionMode({})).toBeNull();
  expect(strip(buildPermissionSegment(ctxOf({ permission_mode: 'bypassPermissions' })))).toBe('⚑ bypass');
  expect(strip(buildPermissionSegment(ctxOf({ permission_mode: 'plan' })))).toBe('⚑ plan');
  expect(strip(buildPermissionSegment(ctxOf({ permission_mode: 'auto' })))).toBe('⚑ auto');
  expect(strip(buildPermissionSegment(ctxOf({ permission_mode: 'someFutureMode' })))).toBe('⚑ someFutureMode');
  const off = { ...DEFAULT_CONFIG, display: { ...DEFAULT_CONFIG.display, showPermissionMode: false } };
  expect(buildPermissionSegment(ctxOf({ permission_mode: 'plan' }, { config: off }))).toBeNull();
});

test('fast_mode joins the model bracket', () => {
  const stdin: StdinData = { model: { display_name: 'Fable 5.1' }, effort: { level: 'high' }, thinking: { enabled: true }, fast_mode: true };
  expect(strip(buildModelSegment(ctxOf(stdin)))).toBe('[Fable 5.1 | high·think | ⚡fast]');
  expect(strip(buildModelSegment(ctxOf({ ...stdin, fast_mode: false })))).toBe('[Fable 5.1 | high·think]');
});

test('pr.kind "mr" renders as MR', () => {
  const git = { branch: 'main', isDirty: false, ahead: 0, behind: 0 };
  expect(strip(buildGitSegment(ctxOf({ pr: { number: 42, url: 'https://gitlab.example/x/-/merge_requests/42', kind: 'mr' } }, { gitStatus: git })))).toContain('MR #42');
  expect(strip(buildGitSegment(ctxOf({ pr: { number: 7, review_state: 'approved' } }, { gitStatus: git })))).toContain('PR #7✓');
});
