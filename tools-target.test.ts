import { test, expect } from 'bun:test';
import { renderToolsLine } from './render/tools.ts';
import { DEFAULT_CONFIG } from './config.ts';
import type { RenderContext, ToolEntry } from './types.ts';

const strip = (s: string | null) => (s ?? '').replace(/\x1b\[[0-9;]*m/g, '');
const ctx = (tools: ToolEntry[]): RenderContext => ({
  stdin: {}, transcript: { tools, agents: [], workflows: [], todos: [] },
  claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0, sessionDuration: '', gitStatus: null, usageData: null,
  config: DEFAULT_CONFIG, extraLabel: null,
});
const running = (name: string, target: string): ToolEntry => ({ id: name, name, target, status: 'running', startTime: new Date() });

test('a Bash command is cut from the end, not treated as a path', () => {
  expect(strip(renderToolsLine(ctx([running('Bash', 'cd /home/dev/projects/x && ls')])))).toBe('◐ Bash: cd /home/dev/proj...');
});

test('file tools keep the filename', () => {
  expect(strip(renderToolsLine(ctx([running('Edit', '/home/dev/projects/app/src/index.ts')])))).toBe('◐ Edit: .../index.ts');
});
