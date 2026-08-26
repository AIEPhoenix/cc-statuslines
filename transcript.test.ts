import { test, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Isolate the transcript cache (getHudDir() = CLAUDE_CONFIG_DIR/hud) into a temp dir
// so tests never read or pollute the real ~/.claude/hud/transcript-cache.
const CFG = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-cfg-'));
process.env.CLAUDE_CONFIG_DIR = CFG;

const { parseTranscript } = await import('./transcript.ts');
const { renderAgentsLine } = await import('./render/agents.ts');

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  try { fs.rmSync(CFG, { recursive: true, force: true }); } catch {}
});

// ---- transcript line builders (shapes mirror real Claude Code JSONL) ----
const T = (s: number) => new Date(Date.UTC(2026, 5, 18, 0, 0, s)).toISOString();

const agentUse = (id: string, input: Record<string, unknown>, t: string) =>
  ({ type: 'assistant', timestamp: t, message: { content: [{ type: 'tool_use', id, name: 'Agent', input }] } });

const teammateSpawned = (toolId: string, name: string, t: string) =>
  ({ type: 'user', timestamp: t, toolUseResult: { status: 'teammate_spawned', name, agent_id: `${name}@s`, teammate_id: `${name}@s` }, message: { content: [{ type: 'tool_result', tool_use_id: toolId }] } });

const asyncLaunched = (toolId: string, agentId: string, t: string) =>
  ({ type: 'user', timestamp: t, toolUseResult: { status: 'async_launched', isAsync: true, agentId }, message: { content: [{ type: 'tool_result', tool_use_id: toolId }] } });

const idleNotif = (name: string, t: string) =>
  ({ type: 'user', timestamp: t, message: { content: `Another Claude session sent a message:\n<teammate-message teammate_id="${name}" color="blue">\n{"type":"idle_notification","from":"${name}","timestamp":"${t}","idleReason":"available"}\n</teammate-message>` } });

const sendMessage = (to: string, t: string) =>
  ({ type: 'assistant', timestamp: t, message: { content: [{ type: 'tool_use', id: `sm-${to}-${t}`, name: 'SendMessage', input: { to, message: 'go', summary: 'go' } }] } });

const taskNotif = (taskId: string, status: string, t: string) =>
  ({ type: 'queue-operation', operation: 'enqueue', timestamp: t, content: `<task-notification>\n<task-id>${taskId}</task-id>\n<status>${status}</status>\n<summary>x</summary>\n</task-notification>` });

function writeTranscript(lines: object[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-t-'));
  tmpDirs.push(dir);
  const p = path.join(dir, 'session.jsonl');
  fs.writeFileSync(p, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  return p;
}

const byDesc = (agents: { description?: string }[], d: string) => agents.find(a => a.description === d)!;

// ---- teammate lifecycle ----

test('teammate goes idle (not running) after idle_notification', async () => {
  const p = writeTranscript([
    agentUse('t1', { subagent_type: 'oracle', description: 'X' }, T(0)),
    teammateSpawned('t1', 'oracle-x', T(1)),
    idleNotif('oracle-x', T(2)),
  ]);
  const a = byDesc((await parseTranscript(p)).agents, 'X');
  expect(a.status).toBe('idle');
  expect(a.type).toBe('oracle-x'); // display name from teammate_spawned, not base 'oracle'
});

test('SendMessage(to=name) re-awakens an idle teammate to running', async () => {
  const p = writeTranscript([
    agentUse('t1', { subagent_type: 'oracle', description: 'X' }, T(0)),
    teammateSpawned('t1', 'oracle-x', T(1)),
    idleNotif('oracle-x', T(2)),
    sendMessage('oracle-x', T(3)),
  ]);
  expect(byDesc((await parseTranscript(p)).agents, 'X').status).toBe('running');
});

test('teammate that idles again after re-awaken ends idle', async () => {
  const p = writeTranscript([
    agentUse('t1', { subagent_type: 'oracle', description: 'X' }, T(0)),
    teammateSpawned('t1', 'oracle-x', T(1)),
    idleNotif('oracle-x', T(2)),
    sendMessage('oracle-x', T(3)),
    idleNotif('oracle-x', T(4)),
  ]);
  expect(byDesc((await parseTranscript(p)).agents, 'X').status).toBe('idle');
});

// ---- async (background) agent terminal states ----

test('async agent killed by user => stopped', async () => {
  const p = writeTranscript([
    agentUse('a1', { subagent_type: 'general-purpose', description: 'Y' }, T(0)),
    asyncLaunched('a1', 'hex1', T(1)),
    taskNotif('hex1', 'killed', T(2)),
  ]);
  expect(byDesc((await parseTranscript(p)).agents, 'Y').status).toBe('stopped');
});

test('async agent failed => stopped', async () => {
  const p = writeTranscript([
    agentUse('a1', { subagent_type: 'general-purpose', description: 'Y' }, T(0)),
    asyncLaunched('a1', 'hex1', T(1)),
    taskNotif('hex1', 'failed', T(2)),
  ]);
  expect(byDesc((await parseTranscript(p)).agents, 'Y').status).toBe('stopped');
});

test('async agent completed => completed', async () => {
  const p = writeTranscript([
    agentUse('a1', { subagent_type: 'general-purpose', description: 'Y' }, T(0)),
    asyncLaunched('a1', 'hex1', T(1)),
    taskNotif('hex1', 'completed', T(2)),
  ]);
  expect(byDesc((await parseTranscript(p)).agents, 'Y').status).toBe('completed');
});

test('completed-then-killed resolves to stopped (last terminal wins)', async () => {
  const p = writeTranscript([
    agentUse('a1', { subagent_type: 'general-purpose', description: 'Y' }, T(0)),
    asyncLaunched('a1', 'hex1', T(1)),
    taskNotif('hex1', 'completed', T(2)),
    taskNotif('hex1', 'killed', T(3)),
  ]);
  expect(byDesc((await parseTranscript(p)).agents, 'Y').status).toBe('stopped');
});

test('SendMessage(to=hex agentId) re-awakens a rested async agent', async () => {
  const p = writeTranscript([
    agentUse('a1', { subagent_type: 'general-purpose', description: 'Y' }, T(0)),
    asyncLaunched('a1', 'hex1', T(1)),
    taskNotif('hex1', 'completed', T(2)),
    sendMessage('hex1', T(3)),
  ]);
  expect(byDesc((await parseTranscript(p)).agents, 'Y').status).toBe('running');
});

// ---- teammate cost/model enrichment from meta.json + subagent JSONL ----

test('teammate cost/model/speed resolved via meta.json reverse lookup', async () => {
  const lines = [
    agentUse('t1', { subagent_type: 'oracle', description: 'X' }, T(0)),
    teammateSpawned('t1', 'oracle-x', T(1)),
    idleNotif('oracle-x', T(2)),
  ];
  const p = writeTranscript(lines);
  // sidecar: <stem>/subagents/agent-<hash>.{meta.json,jsonl}
  const sub = path.join(path.dirname(p), 'session', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  const hash = 'abc123def456';
  fs.writeFileSync(path.join(sub, `agent-${hash}.meta.json`), JSON.stringify({ agentType: 'oracle-x' }));
  fs.writeFileSync(path.join(sub, `agent-${hash}.jsonl`),
    JSON.stringify({ type: 'user', timestamp: T(0) }) + '\n' +
    JSON.stringify({ type: 'assistant', timestamp: T(5), message: { model: 'claude-opus-4-8', usage: { input_tokens: 2000, output_tokens: 1000 } } }) + '\n');

  const a = byDesc((await parseTranscript(p)).agents, 'X');
  expect(a.agentId).toBe(hash);
  expect(a.model).toContain('opus');
  expect(a.costUsd).toBeGreaterThan(0.03);          // 2000*5/1e6 + 1000*25/1e6 = 0.035
  expect(a.outputTokensPerSec).toBeCloseTo(200, 0); // 1000 tok / 5s
});

test('teammate with multiple session files picks the most recent', async () => {
  const p = writeTranscript([
    agentUse('t1', { subagent_type: 'oracle', description: 'X' }, T(0)),
    teammateSpawned('t1', 'oracle-x', T(1)),
  ]);
  const sub = path.join(path.dirname(p), 'session', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  const mk = (hash: string, out: number) => {
    fs.writeFileSync(path.join(sub, `agent-${hash}.meta.json`), JSON.stringify({ agentType: 'oracle-x' }));
    fs.writeFileSync(path.join(sub, `agent-${hash}.jsonl`),
      JSON.stringify({ type: 'user', timestamp: T(0) }) + '\n' +
      JSON.stringify({ type: 'assistant', timestamp: T(5), message: { model: 'claude-opus-4-8', usage: { input_tokens: 1000, output_tokens: out } } }) + '\n');
  };
  mk('old00', 500);
  mk('new00', 999);
  // make new00 the most-recently-modified file
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(path.join(sub, 'agent-new00.jsonl'), future, future);

  const a = byDesc((await parseTranscript(p)).agents, 'X');
  expect(a.agentId).toBe('new00');
});

// ---- render: four states + stale de-prioritization ----

test('renderAgentsLine shows four state icons', () => {
  const now = Date.now();
  const mk = (type: string, status: string, endAgoMs = 1000) =>
    ({ id: type, type, status, startTime: new Date(now - endAgoMs - 1000), endTime: new Date(now - endAgoMs) });
  const transcript: any = { agents: [
    mk('runner', 'running'),
    mk('rester', 'idle', 1000),
    mk('done', 'completed'),
    mk('dead', 'stopped'),
  ], workflows: [] };
  const line = renderAgentsLine({ transcript, config: { colors: {} } } as any)!;
  expect(line).toContain('◐'); // running
  expect(line).toContain('⏸'); // idle
  expect(line).toContain('✓'); // completed
  expect(line).toContain('✗'); // stopped
});

test('stale idle is dimmed, tagged, and de-prioritized below fresh work', () => {
  const now = Date.now();
  const mk = (type: string, status: string, endAgoMs: number) =>
    ({ id: type, type, status, startTime: new Date(now - endAgoMs - 1000), endTime: new Date(now - endAgoMs) });
  const transcript: any = { agents: [
    mk('zombie', 'idle', 60 * 60 * 1000), // 1h idle -> stale
    mk('fresh', 'idle', 30 * 1000),       // 30s idle -> fresh
  ], workflows: [] };
  const out = renderAgentsLine({ transcript, config: { colors: {} } } as any)!;
  expect(out).toContain('stale');
  const rows = out.split('\n');
  expect(rows[0]).toContain('fresh');  // fresh idle ranks above stale
  expect(rows[1]).toContain('zombie');
  expect(rows[0]).not.toContain('stale');
});

// ---- compaction boundaries ----

const compactBoundary = (trigger: string, preTokens: number, postTokens: number, t: string) =>
  ({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', timestamp: t,
     compactMetadata: { trigger, preTokens, postTokens, durationMs: 1000 } });

test('compact_boundary records are counted and the auto line is learned', async () => {
  const p = writeTranscript([
    { type: 'user', timestamp: T(0), message: { content: [] } },
    compactBoundary('manual', 700_000, 12_000, T(1)),
    compactBoundary('auto', 360_000, 20_000, T(2)),
  ]);
  const c = (await parseTranscript(p)).compactions!;
  expect(c.count).toBe(2);
  expect(c.lastTrigger).toBe('auto');
  expect(c.lastPreTokens).toBe(360_000);
  expect(c.lastPostTokens).toBe(20_000);
  expect(c.lastAutoPreTokens).toBe(360_000);
});

test('manual compaction after auto keeps the learned auto line', async () => {
  const p = writeTranscript([
    compactBoundary('auto', 360_000, 20_000, T(1)),
    compactBoundary('manual', 150_000, 9_000, T(2)),
  ]);
  const c = (await parseTranscript(p)).compactions!;
  expect(c.count).toBe(2);
  expect(c.lastTrigger).toBe('manual');
  expect(c.lastAutoPreTokens).toBe(360_000);
});

test('compactions survive the transcript cache round-trip', async () => {
  const p = writeTranscript([compactBoundary('auto', 360_000, 20_000, T(1))]);
  const first = await parseTranscript(p);
  expect(first.compactions?.count).toBe(1);
  // Second parse hits the cache (no running agents/workflows)
  const second = await parseTranscript(p);
  expect(second.compactions?.count).toBe(1);
  expect(second.compactions?.lastAutoPreTokens).toBe(360_000);
  expect(second.compactions?.lastTime).toBeInstanceOf(Date);
});
