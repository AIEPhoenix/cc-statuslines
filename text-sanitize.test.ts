import { test, expect } from 'bun:test';
import { stripControl } from './utils/text.ts';
import { formatTask } from './subagent-line.ts';
import { renderAgentsLine } from './render/agents.ts';
import { renderToolsLine } from './render/tools.ts';
import { renderTodosLine } from './render/todos.ts';
import { renderProjectLine } from './render/project.ts';
import { DEFAULT_CONFIG } from './config.ts';
import type { RenderContext } from './types.ts';

// A payload that tries to: clear the screen, open a fake OSC 8 link, ring the
// bell, hide text behind a bidi override, and break the row with a newline.
const EVIL = 'ok\x1b[2J\x1b]8;;http://evil\x07link\x1b]8;;\x07\x07\u202etxet\nnext';
const ESC = /[\x00-\x1f\x7f-\x9f\u2028\u2029]|\p{Cf}/u;

test('stripControl removes C0/C1, DEL, separators and format characters', () => {
  expect(stripControl(EVIL)).toBe('ok[2J]8;;http://evillink]8;;txetnext');
  expect(stripControl('查 statusline · ok')).toBe('查 statusline · ok'); // CJK and middle dot untouched
});

const base = (): RenderContext => ({
  stdin: {}, transcript: { tools: [], agents: [], workflows: [], todos: [] },
  claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0, sessionDuration: '', gitStatus: null, usageData: null,
  config: { ...DEFAULT_CONFIG, display: { ...DEFAULT_CONFIG.display, showSessionName: true } }, extraLabel: null,
});
const noAnsi = (s: string | null) => (s ?? '').replace(/\x1b\[[0-9;]*m/g, '');

test('subagent rows never carry payload-supplied control characters', () => {
  for (const colors of [false, true]) {
    const row = formatTask({ id: 'x', agentType: EVIL, name: EVIL, description: EVIL, label: EVIL, model: EVIL, effort: EVIL, startTime: 1 }, 1000, colors);
    expect(noAnsi(row)).not.toMatch(ESC);
  }
});

test('agents, tools, todos and session name are sanitized at render', () => {
  const ctx = base();
  ctx.transcript.agents.push({ id: 'a', type: EVIL, description: EVIL, model: EVIL, status: 'running', startTime: new Date() });
  ctx.transcript.workflows.push({ runId: 'w', name: EVIL, agentCount: 1, completedCount: 0, status: 'running' });
  ctx.transcript.tools.push({ id: 't', name: EVIL, target: EVIL, status: 'running', startTime: new Date() });
  ctx.transcript.tools.push({ id: 't2', name: EVIL, status: 'completed', startTime: new Date() });
  ctx.transcript.todos.push({ content: EVIL, status: 'in_progress' });
  ctx.transcript.sessionName = EVIL;
  for (const line of [renderAgentsLine(ctx), renderToolsLine(ctx), renderTodosLine(ctx), renderProjectLine(ctx)]) {
    expect(line).not.toBeNull();
    // The agents renderer joins its rows with "\n" itself; only the payload's newline must be gone.
    for (const row of noAnsi(line).split('\n')) expect(row).not.toMatch(ESC);
  }
});
