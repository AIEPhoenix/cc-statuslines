import * as fs from 'fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'readline';
import { createHash } from 'node:crypto';
import { getHudDir } from './config.ts';
import type { TranscriptData, ToolEntry, AgentEntry, TodoItem } from './types.ts';

interface TranscriptLine {
  timestamp?: string;
  type?: string;
  slug?: string;
  customTitle?: string;
  message?: { content?: ContentBlock[] };
}

interface ContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
}

interface TranscriptFileState { mtimeMs: number; size: number; }
interface SerializedToolEntry extends Omit<ToolEntry, 'startTime' | 'endTime'> { startTime: string; endTime?: string; }
interface SerializedAgentEntry extends Omit<AgentEntry, 'startTime' | 'endTime'> { startTime: string; endTime?: string; }
interface SerializedTranscriptData { tools: SerializedToolEntry[]; agents: SerializedAgentEntry[]; todos: TodoItem[]; sessionStart?: string; sessionName?: string; }
interface TranscriptCacheFile { transcriptPath: string; transcriptState: TranscriptFileState; data: SerializedTranscriptData; }

function getCachePath(transcriptPath: string): string {
  const hash = createHash('sha256').update(path.resolve(transcriptPath)).digest('hex');
  return path.join(getHudDir(), 'transcript-cache', `${hash}.json`);
}

function readFileState(p: string): TranscriptFileState | null {
  try { const s = fs.statSync(p); return s.isFile() ? { mtimeMs: s.mtimeMs, size: s.size } : null; } catch { return null; }
}

function serialize(data: TranscriptData): SerializedTranscriptData {
  return {
    tools: data.tools.map(t => ({ ...t, startTime: t.startTime.toISOString(), endTime: t.endTime?.toISOString() })),
    agents: data.agents.map(a => ({ ...a, startTime: a.startTime.toISOString(), endTime: a.endTime?.toISOString() })),
    todos: data.todos.map(t => ({ ...t })),
    sessionStart: data.sessionStart?.toISOString(),
    sessionName: data.sessionName,
  };
}

function deserialize(data: SerializedTranscriptData): TranscriptData {
  return {
    tools: data.tools.map(t => ({ ...t, startTime: new Date(t.startTime), endTime: t.endTime ? new Date(t.endTime) : undefined })),
    agents: data.agents.map(a => ({ ...a, startTime: new Date(a.startTime), endTime: a.endTime ? new Date(a.endTime) : undefined })),
    todos: data.todos.map(t => ({ ...t })),
    sessionStart: data.sessionStart ? new Date(data.sessionStart) : undefined,
    sessionName: data.sessionName,
  };
}

function readCache(transcriptPath: string, state: TranscriptFileState): TranscriptData | null {
  try {
    const raw = fs.readFileSync(getCachePath(transcriptPath), 'utf8');
    const parsed = JSON.parse(raw) as TranscriptCacheFile;
    if (parsed.transcriptPath !== path.resolve(transcriptPath) || parsed.transcriptState?.mtimeMs !== state.mtimeMs || parsed.transcriptState?.size !== state.size) return null;
    return deserialize(parsed.data);
  } catch { return null; }
}

function writeCache(transcriptPath: string, state: TranscriptFileState, data: TranscriptData): void {
  try {
    const cachePath = getCachePath(transcriptPath);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ transcriptPath: path.resolve(transcriptPath), transcriptState: state, data: serialize(data) }), 'utf8');
  } catch {}
}

export async function parseTranscript(transcriptPath: string): Promise<TranscriptData> {
  const result: TranscriptData = { tools: [], agents: [], todos: [] };
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return result;
  const state = readFileState(transcriptPath);
  if (!state) return result;
  const cached = readCache(transcriptPath, state);
  if (cached) return cached;

  const toolMap = new Map<string, ToolEntry>();
  const agentMap = new Map<string, AgentEntry>();
  let latestTodos: TodoItem[] = [];
  const taskIdToIndex = new Map<string, number>();
  let latestSlug: string | undefined;
  let customTitle: string | undefined;
  let parsedCleanly = false;

  try {
    const rl = readline.createInterface({ input: fs.createReadStream(transcriptPath), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as TranscriptLine;
        if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') customTitle = entry.customTitle;
        else if (typeof entry.slug === 'string') latestSlug = entry.slug;
        processEntry(entry, toolMap, agentMap, taskIdToIndex, latestTodos, result);
      } catch {}
    }
    parsedCleanly = true;
  } catch {}

  result.tools = Array.from(toolMap.values()).slice(-20);
  result.agents = Array.from(agentMap.values()).slice(-10);
  result.todos = latestTodos;
  result.sessionName = customTitle ?? latestSlug;
  if (parsedCleanly) writeCache(transcriptPath, state, result);
  return result;
}

function processEntry(entry: TranscriptLine, toolMap: Map<string, ToolEntry>, agentMap: Map<string, AgentEntry>, taskIdToIndex: Map<string, number>, latestTodos: TodoItem[], result: TranscriptData): void {
  const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();
  if (!result.sessionStart && entry.timestamp) result.sessionStart = timestamp;
  const content = entry.message?.content;
  if (!content || !Array.isArray(content)) return;

  for (const block of content) {
    if (block.type === 'tool_use' && block.id && block.name) {
      const toolEntry: ToolEntry = { id: block.id, name: block.name, target: extractTarget(block.name, block.input), status: 'running', startTime: timestamp };
      if (block.name === 'Agent' || block.name === 'Task') {
        const input = block.input as Record<string, unknown>;
        agentMap.set(block.id, { id: block.id, type: (input?.subagent_type as string) ?? 'unknown', model: input?.model as string, description: input?.description as string, status: 'running', startTime: timestamp });
      } else if (block.name === 'TodoWrite') {
        const input = block.input as { todos?: TodoItem[] };
        if (input?.todos && Array.isArray(input.todos)) { latestTodos.length = 0; taskIdToIndex.clear(); latestTodos.push(...input.todos); }
      } else if (block.name === 'TaskCreate') {
        const input = block.input as Record<string, unknown>;
        const c = (typeof input?.subject === 'string' ? input.subject : '') || (typeof input?.description === 'string' ? input.description : '') || 'Untitled task';
        const status = normalizeStatus(input?.status) ?? 'pending';
        latestTodos.push({ content: c, status });
        const tid = typeof input?.taskId === 'string' || typeof input?.taskId === 'number' ? String(input.taskId) : block.id;
        if (tid) taskIdToIndex.set(tid, latestTodos.length - 1);
      } else if (block.name === 'TaskUpdate') {
        const input = block.input as Record<string, unknown>;
        const index = resolveIdx(input?.taskId, taskIdToIndex, latestTodos);
        if (index !== null) {
          const s = normalizeStatus(input?.status); if (s) latestTodos[index].status = s;
          const c = (typeof input?.subject === 'string' ? input.subject : '') || (typeof input?.description === 'string' ? input.description : '');
          if (c) latestTodos[index].content = c;
        }
      } else {
        toolMap.set(block.id, toolEntry);
      }
    }
    if (block.type === 'tool_result' && block.tool_use_id) {
      const tool = toolMap.get(block.tool_use_id);
      if (tool) { tool.status = block.is_error ? 'error' : 'completed'; tool.endTime = timestamp; }
      const agent = agentMap.get(block.tool_use_id);
      if (agent) { agent.status = 'completed'; agent.endTime = timestamp; }
    }
  }
}

function extractTarget(name: string, input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  switch (name) {
    case 'Read': case 'Write': case 'Edit': return (input.file_path as string) ?? (input.path as string);
    case 'Glob': case 'Grep': return input.pattern as string;
    case 'Bash': { const cmd = input.command as string; return cmd ? cmd.slice(0, 30) + (cmd.length > 30 ? '...' : '') : undefined; }
  }
  return undefined;
}

function resolveIdx(taskId: unknown, map: Map<string, number>, todos: TodoItem[]): number | null {
  if (typeof taskId === 'string' || typeof taskId === 'number') {
    const key = String(taskId);
    const mapped = map.get(key);
    if (typeof mapped === 'number') return mapped;
    if (/^\d+$/.test(key)) { const i = Number.parseInt(key, 10) - 1; if (i >= 0 && i < todos.length) return i; }
  }
  return null;
}

function normalizeStatus(s: unknown): TodoItem['status'] | null {
  if (typeof s !== 'string') return null;
  switch (s) {
    case 'pending': case 'not_started': return 'pending';
    case 'in_progress': case 'running': return 'in_progress';
    case 'completed': case 'complete': case 'done': return 'completed';
    default: return null;
  }
}
