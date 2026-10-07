import { test, expect } from 'bun:test';
import { formatTask } from './subagent-line.ts';

const now = 1_800_000_000_000;

test('plain row: type, bracket, description, stats', () => {
  const row = formatTask({ id: 'a1', type: 'local_agent', agentType: 'claude-code-guide', status: 'running', description: 'Reading docs', startTime: now - 95_000, model: 'claude-haiku-4-5-20251001', effort: 'high', contextWindowSize: 200_000, tokenCount: 12_400 }, now, false);
  expect(row).toBe('claude-code-guide [haiku 4.5 | high]: Reading docs (1m 35s | 131 tok/s | 12k 6%)');
});

test('label beats description; name shown when it differs from the type', () => {
  const row = formatTask({ id: 'a2', type: 'local_agent', name: 'reviewer', agentType: 'oracle', description: 'Code review', label: 'Reviewing diff', startTime: now - 2_000, tokenCount: 0 }, now, false);
  expect(row).toBe('oracle (reviewer): Reviewing diff (2s)');
});

test('throughput waits for 5 s of wall-clock; long descriptions are cut', () => {
  const row = formatTask({ id: 'a3', agentType: 'Explore', description: 'x'.repeat(120), startTime: now - 3_000, tokenCount: 900 }, now, false);
  expect(row).toContain('x'.repeat(45) + '...');
  expect(row).not.toContain('tok/s');
  expect(row).toContain('900tok');
});

test('colored rows carry ANSI only when asked', () => {
  const task = { id: 'a4', agentType: 'oracle', description: 'd', startTime: now - 1000 };
  expect(formatTask(task, now, false)).not.toMatch(/\x1b/);
  expect(formatTask(task, now, true)).toMatch(/\x1b/);
  expect(formatTask(task, now, true).replace(/\x1b\[[0-9;]*m/g, '')).toBe(formatTask(task, now, false));
});

test('missing everything still yields a row', () => {
  expect(formatTask({ id: 'a5' }, now, false)).toBe('agent');
});

test('CJK descriptions are cut by display width, not code units', () => {
  const row = formatTask({ id: 'a6', agentType: 'guide', description: '查'.repeat(40), startTime: now - 1000 }, now, false);
  expect(row).toContain('查'.repeat(22) + '...');
});
