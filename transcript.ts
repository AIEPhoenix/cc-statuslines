import * as fs from 'fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'readline';
import { createHash } from 'node:crypto';
import { getHudDir } from './config.ts';
import type { TranscriptData, ToolEntry, AgentEntry, TodoItem } from './types.ts';
import { collectSpeed, outputTokensPerSec, inputTokensPerSec } from './speed-metrics.ts';

interface TranscriptLine {
  timestamp?: string;
  type?: string;
  slug?: string;
  customTitle?: string;
  aiTitle?: string;
  message?: { content?: ContentBlock[] };
  // queue-operation fields (for async agent completion)
  operation?: string;
  content?: string;
  // toolUseResult on tool_result entries
  toolUseResult?: ToolUseResult;
}

interface ToolUseResult {
  isAsync?: boolean;
  status?: string;
  agentId?: string;
  agentType?: string;
  description?: string;
  totalDurationMs?: number;
  outputFile?: string;
  totalTokens?: number;
  totalToolUseCount?: number;
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
interface SerializedTranscriptData { tools: SerializedToolEntry[]; agents: SerializedAgentEntry[]; todos: TodoItem[]; sessionStart?: string; sessionName?: string; outputTokensPerSec?: number | null; inputTokensPerSec?: number | null; }
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
    outputTokensPerSec: data.outputTokensPerSec ?? null,
    inputTokensPerSec: data.inputTokensPerSec ?? null,
  };
}

function deserialize(data: SerializedTranscriptData): TranscriptData {
  return {
    tools: data.tools.map(t => ({ ...t, startTime: new Date(t.startTime), endTime: t.endTime ? new Date(t.endTime) : undefined })),
    agents: data.agents.map(a => ({ ...a, startTime: new Date(a.startTime), endTime: a.endTime ? new Date(a.endTime) : undefined })),
    todos: data.todos.map(t => ({ ...t })),
    sessionStart: data.sessionStart ? new Date(data.sessionStart) : undefined,
    sessionName: data.sessionName,
    outputTokensPerSec: data.outputTokensPerSec ?? null,
    inputTokensPerSec: data.inputTokensPerSec ?? null,
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
    pruneCacheDir(path.dirname(cachePath));
  } catch {}
}

const PRUNE_MARKER = '.last-prune';
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Delete cache entries for long-dead sessions. Throttled via a marker file
 * so the directory scan runs at most once a day across all hud invocations. */
function pruneCacheDir(dir: string): void {
  try {
    const marker = path.join(dir, PRUNE_MARKER);
    const now = Date.now();
    try {
      if (now - fs.statSync(marker).mtimeMs < PRUNE_INTERVAL_MS) return;
    } catch {}
    fs.writeFileSync(marker, '', 'utf8');
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const p = path.join(dir, name);
      try {
        if (now - fs.statSync(p).mtimeMs > MAX_CACHE_AGE_MS) fs.unlinkSync(p);
      } catch {}
    }
  } catch {}
}

export async function parseTranscript(transcriptPath: string): Promise<TranscriptData> {
  const result: TranscriptData = { tools: [], agents: [], todos: [] };
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return result;
  const state = readFileState(transcriptPath);
  if (!state) return result;
  const cached = readCache(transcriptPath, state);
  if (cached && !cached.agents.some(a => a.status === 'running')) return cached;

  const toolMap = new Map<string, ToolEntry>();
  const agentMap = new Map<string, AgentEntry>();
  // Maps agentId (from toolUseResult) back to tool_use_id for async agents
  const asyncAgentIdToToolId = new Map<string, string>();
  // Buffers completion events whose async-launch tool_result hasn't been seen yet.
  // The JSONL is appended per-event, but assistant-turn entries are flushed in batches —
  // a fast subagent can have its queue-operation completion written BEFORE the
  // tool_use/tool_result that launched it. Without this buffer, those completions are dropped.
  const pendingCompletions = new Map<string, Date>();
  let latestTodos: TodoItem[] = [];
  const taskIdToIndex = new Map<string, number>();
  let latestSlug: string | undefined;
  let aiTitle: string | undefined;
  let customTitle: string | undefined;
  let parsedCleanly = false;

  try {
    const rl = readline.createInterface({ input: fs.createReadStream(transcriptPath), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as TranscriptLine;
        if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') customTitle = entry.customTitle;
        else if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string') aiTitle = entry.aiTitle;
        else if (typeof entry.slug === 'string') latestSlug = entry.slug;
        processEntry(entry, toolMap, agentMap, asyncAgentIdToToolId, pendingCompletions, taskIdToIndex, latestTodos, result);
      } catch {}
    }
    parsedCleanly = true;
  } catch {}

  result.tools = Array.from(toolMap.values()).slice(-20);
  result.agents = Array.from(agentMap.values()).slice(-10);
  result.todos = latestTodos;
  result.sessionName = customTitle ?? aiTitle ?? latestSlug;

  // Enrich unknown agent types from subagent meta.json files
  enrichAgentTypes(transcriptPath, result.agents, asyncAgentIdToToolId);

  // Collect speeds: main session + each subagent
  await attachSpeeds(transcriptPath, result);

  const hasRunning = result.agents.some(a => a.status === 'running');
  if (parsedCleanly && !hasRunning) writeCache(transcriptPath, state, result);
  return result;
}

async function attachSpeeds(transcriptPath: string, result: TranscriptData): Promise<void> {
  // Main session speed
  const mainMetrics = await collectSpeed(transcriptPath);
  result.outputTokensPerSec = outputTokensPerSec(mainMetrics);
  result.inputTokensPerSec = inputTokensPerSec(mainMetrics);

  // Per-subagent speeds
  const transcriptDir = path.dirname(transcriptPath);
  const transcriptStem = path.basename(transcriptPath, '.jsonl');
  const subagentsDir = path.join(transcriptDir, transcriptStem, 'subagents');
  if (!fs.existsSync(subagentsDir)) return;

  await Promise.all(result.agents.map(async agent => {
    if (!agent.agentId) return;
    const subPath = path.join(subagentsDir, `agent-${agent.agentId}.jsonl`);
    if (!fs.existsSync(subPath)) return;
    const m = await collectSpeed(subPath);
    agent.outputTokensPerSec = outputTokensPerSec(m);
  }));
}

function processEntry(
  entry: TranscriptLine,
  toolMap: Map<string, ToolEntry>,
  agentMap: Map<string, AgentEntry>,
  asyncAgentIdToToolId: Map<string, string>,
  pendingCompletions: Map<string, Date>,
  taskIdToIndex: Map<string, number>,
  latestTodos: TodoItem[],
  result: TranscriptData,
): void {
  const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();
  if (!result.sessionStart && entry.timestamp) result.sessionStart = timestamp;

  // Handle queue-operation: async agent completion notification
  if (entry.type === 'queue-operation' && entry.operation === 'enqueue' && typeof entry.content === 'string') {
    const taskIdMatch = entry.content.match(/<task-id>([^<]+)<\/task-id>/);
    const statusMatch = entry.content.match(/<status>([^<]+)<\/status>/);
    if (taskIdMatch && statusMatch?.[1] === 'completed') {
      const agentId = taskIdMatch[1];
      const toolId = asyncAgentIdToToolId.get(agentId);
      if (toolId) {
        const agent = agentMap.get(toolId);
        if (agent) {
          agent.status = 'completed';
          agent.endTime = timestamp;
        }
      } else {
        // Completion arrived before the tool_result that establishes the agentId↔toolId
        // mapping. Buffer it; the tool_result branch below will drain pending entries.
        pendingCompletions.set(agentId, timestamp);
      }
    }
    return;
  }

  const content = entry.message?.content;
  if (!content || !Array.isArray(content)) return;

  for (const block of content) {
    if (block.type === 'tool_use' && block.id && block.name) {
      const toolEntry: ToolEntry = { id: block.id, name: block.name, target: extractTarget(block.name, block.input), status: 'running', startTime: timestamp };
      if (block.name === 'Agent' || block.name === 'Task') {
        const input = block.input as Record<string, unknown>;
        agentMap.set(block.id, {
          id: block.id,
          type: (input?.subagent_type as string) ?? 'unknown',
          model: input?.model as string,
          description: input?.description as string,
          status: 'running',
          startTime: timestamp,
        });
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
      const tur = entry.toolUseResult;

      // Handle agent tool_results
      const agent = agentMap.get(block.tool_use_id);
      if (agent && tur) {
        if (tur.agentId) agent.agentId = tur.agentId;
        if (tur.isAsync === true) {
          // Background agent: tool_result is just the launch notification.
          // Keep status as 'running'. Completion comes via queue-operation.
          if (tur.agentId) {
            asyncAgentIdToToolId.set(tur.agentId, block.tool_use_id);
            // If the completion event was already seen (file order can put it before
            // this tool_result), drain it now.
            const pendingTs = pendingCompletions.get(tur.agentId);
            if (pendingTs) {
              agent.status = 'completed';
              agent.endTime = pendingTs;
              pendingCompletions.delete(tur.agentId);
            }
          }
        } else if (tur.status === 'completed') {
          // Foreground agent: tool_result means truly completed.
          agent.status = 'completed';
          agent.endTime = timestamp;
          // Use accurate duration from toolUseResult if available
          if (typeof tur.totalDurationMs === 'number') {
            agent.endTime = new Date(agent.startTime.getTime() + tur.totalDurationMs);
          }
          // Update type from toolUseResult (more accurate than input.subagent_type)
          if (tur.agentType) agent.type = tur.agentType;
          if (typeof tur.totalTokens === 'number') agent.totalTokens = tur.totalTokens;
          if (typeof tur.totalToolUseCount === 'number') agent.totalToolUseCount = tur.totalToolUseCount;
        }
        continue;
      }

      // Handle regular tool_results
      const tool = toolMap.get(block.tool_use_id);
      if (tool) { tool.status = block.is_error ? 'error' : 'completed'; tool.endTime = timestamp; }
    }
  }
}

function extractTarget(name: string, input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  switch (name) {
    case 'Read': case 'Write': case 'Edit': return (input.file_path as string) ?? (input.path as string);
    case 'NotebookEdit': return input.notebook_path as string;
    case 'Glob': case 'Grep': return input.pattern as string;
    case 'Skill': return input.skill as string;
    case 'ToolSearch': case 'WebSearch': return input.query as string;
    case 'WebFetch': return input.url as string;
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

/**
 * For agents with type 'unknown' (typically background agents where input.subagent_type
 * was not set), read the agentType from subagents/agent-{id}.meta.json.
 */
function enrichAgentTypes(
  transcriptPath: string,
  agents: AgentEntry[],
  asyncAgentIdToToolId: Map<string, string>,
): void {
  const needsEnrichment = agents.some(a => a.type === 'unknown');
  if (!needsEnrichment) return;

  const transcriptDir = path.dirname(transcriptPath);
  const transcriptStem = path.basename(transcriptPath, '.jsonl');
  const subagentsDir = path.join(transcriptDir, transcriptStem, 'subagents');
  if (!fs.existsSync(subagentsDir)) return;

  // Build reverse map: tool_use_id → agentId (file-system id)
  const toolIdToAgentId = new Map<string, string>();
  for (const [agentId, toolId] of asyncAgentIdToToolId) {
    toolIdToAgentId.set(toolId, agentId);
  }

  for (const agent of agents) {
    if (agent.type !== 'unknown') continue;
    const fileAgentId = toolIdToAgentId.get(agent.id);
    if (!fileAgentId) continue;
    try {
      const metaPath = path.join(subagentsDir, `agent-${fileAgentId}.meta.json`);
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.agentType) agent.type = meta.agentType;
    } catch {}
  }
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
