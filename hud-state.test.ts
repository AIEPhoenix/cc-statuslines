import { test, expect, afterAll } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Isolate the hud dir (getHudDir() = CLAUDE_CONFIG_DIR/hud).
const CFG = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-state-'));
process.env.CLAUDE_CONFIG_DIR = CFG;
afterAll(() => { fs.rmSync(CFG, { recursive: true, force: true }); });

const { readSnapshot, applySnapshot } = await import('./hud-state.ts');
const { SNAPSHOT_VERSION } = await import('./mod/snapshot.ts');
import type { HudSnapshot } from './mod/snapshot.ts';
import type { TranscriptData } from './types.ts';

const now = 1_800_000_000_000;
const SID = '11111111-2222-3333-4444-555555555555';

function writeSnap(s: Partial<HudSnapshot>): void {
  const dir = path.join(CFG, 'hud', 'state');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${SID}.json`), JSON.stringify({ v: SNAPSHOT_VERSION, sessionId: SID, writtenAt: now, activeMs: 0, agents: [], ...s }));
}

const emptyTranscript = (): TranscriptData => ({ tools: [], agents: [], workflows: [], todos: [] }) as unknown as TranscriptData;

test('reads a fresh snapshot for the session', () => {
  writeSnap({ activeMs: 5000 });
  expect(readSnapshot(SID, now + 1000)?.activeMs).toBe(5000);
});

test('ignores a stale snapshot, another session, or no session id', () => {
  writeSnap({});
  expect(readSnapshot(SID, now + 61_000)).toBeNull();
  expect(readSnapshot('other-session', now)).toBeNull();
  expect(readSnapshot(undefined, now)).toBeNull();
});

test('ignores a snapshot of another version', () => {
  writeSnap({ v: 99 as typeof SNAPSHOT_VERSION });
  expect(readSnapshot(SID, now)).toBeNull();
});

test('active time adds the turn in progress; speed comes from the engine', () => {
  const t = emptyTranscript();
  applySnapshot(t, { v: SNAPSHOT_VERSION, sessionId: SID, writtenAt: now, activeMs: 60_000, turnStartedAt: now - 5_000, speed: { inputTokensPerSec: 900, outputTokensPerSec: 42, requests: 12 }, agents: [] }, now);
  expect(t.activeDurationMs).toBe(65_000);
  expect(t.outputTokensPerSec).toBe(42);
  expect(t.inputTokensPerSec).toBe(900);
});

test('engine agent status, model, rate and cost override the transcript; unknown agents are added', () => {
  const t = emptyTranscript();
  t.agents.push({ id: 'tool-1', agentId: 'a1', type: 'Explore', status: 'idle', startTime: new Date(now - 60_000), endTime: new Date(now - 1000), costUsd: 0.5 });
  applySnapshot(t, {
    v: SNAPSHOT_VERSION, sessionId: SID, writtenAt: now, activeMs: 0,
    agents: [
      { id: 'a1', type: 'Explore', description: 'Scan', status: 'running', startTime: now - 60_000, model: 'claude-haiku-5-5', outputTokensPerSec: 80, costUsd: 0.75 },
      { id: 'a2', type: 'oracle', description: 'Review', status: 'killed', startTime: now - 10_000 },
    ],
  }, now);
  const [a1, a2] = t.agents;
  expect(a1).toMatchObject({ status: 'running', model: 'claude-haiku-5-5', outputTokensPerSec: 80 });
  expect(a1!.endTime).toBeUndefined();
  expect(a2).toMatchObject({ agentId: 'a2', type: 'oracle', description: 'Review', status: 'stopped' });
});

test('active time keeps the transcript figure when the mod started later', () => {
  const t = emptyTranscript();
  t.activeDurationMs = 2 * 3600_000;
  applySnapshot(t, { v: SNAPSHOT_VERSION, sessionId: SID, writtenAt: now, activeMs: 0, agents: [] }, now);
  expect(t.activeDurationMs).toBe(2 * 3600_000);
});

test('a running foreground agent without an agentId is matched, not duplicated', () => {
  const t = emptyTranscript();
  t.agents.push({ id: 'toolu_1', type: 'Explore', description: 'Scan repo', status: 'running', startTime: new Date(now - 5_000) });
  applySnapshot(t, { v: SNAPSHOT_VERSION, sessionId: SID, writtenAt: now, activeMs: 0, agents: [
    { id: 'a9', type: 'Explore', description: 'Scan repo', status: 'running', startTime: now - 5_000, costUsd: 0.2 },
  ] }, now);
  expect(t.agents).toHaveLength(1);
  expect(t.agents[0]).toMatchObject({ id: 'toolu_1', agentId: 'a9', costUsd: 0.2 });
});

test('finished agents get an end time so their elapsed time stops', () => {
  const t = emptyTranscript();
  t.agents.push({ id: 'tool-2', agentId: 'b1', type: 'oracle', status: 'idle', startTime: new Date(now - 3600_000), endTime: new Date(now - 1800_000) });
  applySnapshot(t, { v: SNAPSHOT_VERSION, sessionId: SID, writtenAt: now, activeMs: 0, agents: [
    { id: 'b1', type: 'oracle', description: 'Review', status: 'idle', startTime: now - 3600_000, endTime: now - 60_000 },
    { id: 'b2', type: 'Explore', description: 'Done', status: 'completed', startTime: now - 120_000, endTime: now - 30_000 },
    { id: 'b3', type: 'Explore', description: 'Old mod', status: 'completed', startTime: now - 120_000 },
  ] }, now);
  const [b1, b2, b3] = t.agents;
  expect(b1!.endTime?.getTime()).toBe(now - 1800_000); // the transcript's own end time stands
  expect(b2!.endTime?.getTime()).toBe(now - 30_000);
  expect(b3!.endTime?.getTime()).toBe(now); // no endTime: falls back to the snapshot's write time
});

test('a half-written snapshot reads as none, not an error', () => {
  const dir = path.join(CFG, 'hud', 'state');
  fs.writeFileSync(path.join(dir, `${SID}.json`), '{"v":1,"sessionId":');
  expect(readSnapshot(SID, now)).toBeNull();
});

test('a small mod sample does not replace the session-wide transcript speed', () => {
  const t = emptyTranscript();
  t.outputTokensPerSec = 60;
  applySnapshot(t, { v: SNAPSHOT_VERSION, sessionId: SID, writtenAt: now, activeMs: 0, speed: { inputTokensPerSec: 90_000, outputTokensPerSec: 400, requests: 1 }, agents: [] }, now);
  expect(t.outputTokensPerSec).toBe(60);
});

test('an idle teammate without an agentId is matched by name, not duplicated', () => {
  const t = emptyTranscript();
  t.agents.push({ id: 'tool-3', type: 'researcher', description: 'Dig into logs', status: 'idle', startTime: new Date(now - 600_000), endTime: new Date(now - 300_000) });
  applySnapshot(t, { v: SNAPSHOT_VERSION, sessionId: SID, writtenAt: now, activeMs: 0, agents: [
    { id: 'researcher@team', type: 'teammate', name: 'researcher', description: 'Dig into logs', status: 'idle', startTime: now - 600_000 },
  ] }, now);
  expect(t.agents).toHaveLength(1);
  expect(t.agents[0]!.agentId).toBe('researcher@team');
});

test('an agent list read before the transcript saw the agent finish does not revive it', () => {
  const t = emptyTranscript();
  t.agents.push({ id: 'tool-4', agentId: 'c1', type: 'Explore', status: 'completed', startTime: new Date(now - 60_000), endTime: new Date(now - 2_000) });
  // Written just now, but the list itself was read 4 s ago, before the end.
  applySnapshot(t, { v: SNAPSHOT_VERSION, sessionId: SID, writtenAt: now, agentsAt: now - 4_000, activeMs: 0, agents: [
    { id: 'c1', type: 'Explore', description: 'Scan', status: 'running', startTime: now - 60_000, costUsd: 0.3 },
  ] }, now);
  expect(t.agents[0]).toMatchObject({ status: 'completed', costUsd: 0.3 });
  expect(t.agents[0]!.endTime?.getTime()).toBe(now - 2_000);
});

test('an agent the engine reports running after the transcript saw it finish was resumed', () => {
  const t = emptyTranscript();
  t.agents.push({ id: 'tool-5', agentId: 'c2', type: 'Explore', status: 'completed', startTime: new Date(now - 60_000), endTime: new Date(now - 20_000) });
  applySnapshot(t, { v: SNAPSHOT_VERSION, sessionId: SID, writtenAt: now, agentsAt: now - 1_000, activeMs: 0, agents: [
    { id: 'c2', type: 'Explore', description: 'Scan', status: 'running', startTime: now - 60_000 },
  ] }, now);
  expect(t.agents[0]!.status).toBe('running');
  expect(t.agents[0]!.endTime).toBeUndefined();
});

test("a transcript agent of type 'unknown' is matched by description", () => {
  const t = emptyTranscript();
  t.agents.push({ id: 'toolu_7', type: 'unknown', description: 'Look around', status: 'running', startTime: new Date(now - 5_000) });
  applySnapshot(t, { v: SNAPSHOT_VERSION, sessionId: SID, writtenAt: now, activeMs: 0, agents: [
    { id: 'd1', type: 'general-purpose', description: 'Look around', status: 'running', startTime: now - 5_000 },
  ] }, now);
  expect(t.agents).toHaveLength(1);
});

test('engine cost wins for agents begun after the mod loaded, else the larger figure', () => {
  const t = emptyTranscript();
  t.agents.push({ id: 't1', agentId: 'e1', type: 'oracle', status: 'running', startTime: new Date(now - 50_000), costUsd: 4.2 });
  t.agents.push({ id: 't2', agentId: 'e2', type: 'oracle', status: 'running', startTime: new Date(now - 5_000), costUsd: 0.9 });
  applySnapshot(t, { v: SNAPSHOT_VERSION, sessionId: SID, writtenAt: now, ledgerAt: now - 10_000, activeMs: 0, agents: [
    { id: 'e1', type: 'oracle', description: '', status: 'running', startTime: now - 50_000, costUsd: 0.03 }, // ledger restarted
    { id: 'e2', type: 'oracle', description: '', status: 'running', startTime: now - 5_000, costUsd: 0.7 },
  ] }, now);
  expect(t.agents[0]!.costUsd).toBe(4.2);
  expect(t.agents[1]!.costUsd).toBe(0.7);
});

test('agents added from the snapshot are placed by start time', () => {
  const t = emptyTranscript();
  t.agents.push({ id: 't3', agentId: 'f2', type: 'Explore', status: 'completed', startTime: new Date(now - 10_000), endTime: new Date(now - 1_000) });
  applySnapshot(t, { v: SNAPSHOT_VERSION, sessionId: SID, writtenAt: now, activeMs: 0, agents: [
    { id: 'f1', type: 'Explore', description: 'Old', status: 'completed', startTime: now - 1_200_000, endTime: now - 1_100_000 },
  ] }, now);
  expect(t.agents.map(a => a.agentId)).toEqual(['f1', 'f2']);
});

test('a teammate the transcript does not know is shown by its name', () => {
  const t = emptyTranscript();
  applySnapshot(t, { v: SNAPSHOT_VERSION, sessionId: SID, writtenAt: now, activeMs: 0, agents: [
    { id: 'writer@team', type: 'teammate', name: 'writer', description: 'Draft docs', status: 'running', startTime: now - 1_000 },
  ] }, now);
  expect(t.agents[0]!.type).toBe('writer');
});

test('the transcript rate stands; agents spawned by agents are not added', () => {
  const t = emptyTranscript();
  t.agents.push({ id: 't9', agentId: 'g1', type: 'oracle', status: 'running', startTime: new Date(now - 9_000), outputTokensPerSec: 31 });
  applySnapshot(t, { v: SNAPSHOT_VERSION, sessionId: SID, writtenAt: now, activeMs: 0, agents: [
    { id: 'g1', type: 'oracle', description: '', status: 'running', startTime: now - 9_000, outputTokensPerSec: 300 },
    { id: 'g2', type: 'Explore', description: 'Nested', status: 'running', parentId: 'g1', startTime: now - 3_000 },
  ] }, now);
  expect(t.agents).toHaveLength(1);
  expect(t.agents[0]!.outputTokensPerSec).toBe(31);
});
