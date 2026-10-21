import { test, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { requestCostUsd, collectSpeed } from './speed-metrics.ts';

const M = 1_000_000;

test('versioned entries win over family fallbacks', () => {
  const io = { input_tokens: M, output_tokens: M };
  expect(requestCostUsd('claude-fable-5-1', io)).toBeCloseTo(60);
  expect(requestCostUsd('claude-opus-5-5', io)).toBeCloseTo(24);
  expect(requestCostUsd('claude-opus-5', io)).toBeCloseTo(30);
  expect(requestCostUsd('claude-opus-4-8', io)).toBeCloseTo(30);
  expect(requestCostUsd('claude-sonnet-5-5', io)).toBeCloseTo(12);
  expect(requestCostUsd('claude-sonnet-5', io)).toBeCloseTo(12);
  expect(requestCostUsd('claude-sonnet-4-6', io)).toBeCloseTo(18);
  expect(requestCostUsd('claude-haiku-4-5-20251001', io)).toBeCloseTo(6);
  expect(requestCostUsd('claude-3-5-haiku-20241022', io)).toBeCloseTo(4.8);
  expect(requestCostUsd('claude-opus-4-1-20250805', io)).toBeCloseTo(90);
  expect(requestCostUsd('claude-opus-4-20250514', io)).toBeCloseTo(90);
  expect(requestCostUsd('claude-opus-4-5-20251101', io)).toBeCloseTo(30);
  expect(requestCostUsd('anthropic.claude-opus-5-5', io)).toBeCloseTo(24);
  expect(requestCostUsd('gpt-5', io)).toBeNull();
});

test('cache reads use explicit rates where they deviate from 0.1x input', () => {
  const read = { cache_read_input_tokens: M };
  expect(requestCostUsd('claude-fable-5-1', read)).toBeCloseTo(0.25);
  expect(requestCostUsd('claude-fable-5', read)).toBeCloseTo(1);
  expect(requestCostUsd('claude-opus-5-5', read)).toBeCloseTo(0.2);
  expect(requestCostUsd('claude-sonnet-5-5', read)).toBeCloseTo(0.1);
  expect(requestCostUsd('claude-sonnet-5', read)).toBeCloseTo(0.2);
});

test('cache writes: 5m = 1.25x, 1h = 2x input; no breakdown assumes 5m', () => {
  const split = { cache_creation_input_tokens: 2 * M, cache_creation: { ephemeral_5m_input_tokens: M, ephemeral_1h_input_tokens: M } };
  expect(requestCostUsd('claude-opus-5-5', split)).toBeCloseTo(4 * 1.25 + 4 * 2);
  expect(requestCostUsd('claude-opus-5-5', { cache_creation_input_tokens: M })).toBeCloseTo(5);
});

test('Haiku 5.5 bills prompts above 100K at the long-context rate', () => {
  const short = { input_tokens: 100_000, output_tokens: 1000 };
  expect(requestCostUsd('claude-haiku-5-5', short)).toBeCloseTo((100_000 * 0.1 + 1000 * 0.5) / M);
  // 1K fresh + 150K cached = 151K prompt → whole request at $0.50 / $2.50
  const long = { input_tokens: 1000, cache_read_input_tokens: 150_000, output_tokens: 1000 };
  expect(requestCostUsd('claude-haiku-5-5', long)).toBeCloseTo((1000 * 0.5 + 150_000 * 0.05 + 1000 * 2.5) / M);
});

test('fast mode doubles Opus 4.8 / 5 / 5.5 and leaves other models alone', () => {
  const fast = { input_tokens: M, output_tokens: M, speed: 'fast' };
  expect(requestCostUsd('claude-opus-5-5', fast)).toBeCloseTo(48);
  expect(requestCostUsd('claude-opus-5', fast)).toBeCloseTo(60);
  expect(requestCostUsd('claude-opus-4-8', fast)).toBeCloseTo(60);
  expect(requestCostUsd('claude-opus-4-7', fast)).toBeCloseTo(30);
  // cache multipliers stack on the fast price: 5m write $12.50, read $1
  expect(requestCostUsd('claude-opus-4-8', { cache_creation_input_tokens: M, cache_read_input_tokens: M, speed: 'fast' })).toBeCloseTo(13.5);
  expect(requestCostUsd('claude-sonnet-5-5', fast)).toBeCloseTo(12);
});

test('one response split into several assistant records is counted once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-speed-'));
  try {
    const usage = { input_tokens: 1000, output_tokens: 500 };
    const msg = (type: string) => ({ id: 'msg_1', model: 'claude-opus-5-5', usage, content: [{ type }] });
    const lines = [
      { type: 'user', timestamp: '2026-10-21T00:00:00.000Z', message: { content: 'hi' } },
      { type: 'assistant', timestamp: '2026-10-21T00:00:10.000Z', message: msg('thinking') },
      { type: 'assistant', timestamp: '2026-10-21T00:00:10.100Z', message: msg('tool_use') },
    ];
    const p = path.join(dir, 'a.jsonl');
    fs.writeFileSync(p, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    const m = await collectSpeed(p);
    expect(m.outputTokens).toBe(500);
    expect(m.requestCount).toBe(1);
    expect(m.costUsd).toBeCloseTo(requestCostUsd('claude-opus-5-5', usage)!);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
