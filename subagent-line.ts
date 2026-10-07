/**
 * Entry point for Claude Code's `subagentStatusLine` setting (CC ≥2.1.205;
 * `agentType` ≥2.1.293): one row per running subagent in the agent panel.
 *
 *   "subagentStatusLine": {
 *     "type": "command",
 *     "command": "/opt/homebrew/bin/bun --env-file /dev/null ~/.claude/hud/subagent-line.ts"
 *   }
 *
 * Claude Code runs this once per refresh tick with `{ ...base, columns, tasks }`
 * on stdin and expects one `{"id","content"}` JSON line per row to override;
 * a row without a line keeps the engine's default, empty `content` hides it.
 * Everything else on stdout is discarded and logged as an error, so nothing
 * here may print anything but those lines. The whole call has a 5 s budget and
 * the environment is not inherited (`extendEnv: false`), hence the absolute
 * bun path above and no transcript parsing here: only the payload is used.
 */
import { loadConfig } from './config.ts';
import { readStdin } from './stdin.ts';
import { fmtModel, fmtElapsedMs, fmtAgentTokens } from './render/agents.ts';
import { magenta, white, label, dim, RESET } from './render/colors.ts';
import { visualLength, sliceVisible } from './render/index.ts';

interface SubagentTask {
  id: string;
  name?: string;
  type?: string;
  agentType?: string;
  status?: string;
  description?: string;
  label?: string;
  startTime?: number;
  model?: string;
  effort?: string;
  contextWindowSize?: number;
  tokenCount?: number;
  tokenSamples?: number[];
  cwd?: string;
}

interface SubagentStdin {
  columns?: number;
  tasks?: SubagentTask[];
}


async function main(): Promise<void> {
  let rows: string[] = [];
  try {
    const stdin = (await readStdin()) as (SubagentStdin & Record<string, unknown>) | null;
    const tasks = Array.isArray(stdin?.tasks) ? stdin!.tasks : [];
    if (tasks.length === 0) return;
    const config = await loadConfig();
    const colors = config.display.subagentLineColors;
    const columns = typeof stdin?.columns === 'number' && stdin.columns > 0 ? Math.floor(stdin.columns) : 0;
    const now = Date.now();
    rows = tasks
      .filter(t => typeof t?.id === 'string' && t.id)
      .map(t => JSON.stringify({ id: t.id, content: fit(formatTask(t, now, colors), columns) }));
  } catch {
    rows = [];
  }
  for (const r of rows) console.log(r);
}

/**
 * `explore [haiku 4.5 | high]: Researching docs (1m 02s | 203 tok/s | 12k)`
 * Throughput is the task's average (tokenCount over wall-clock since start):
 * `tokenSamples` has no timestamps, so an instantaneous rate can't be derived
 * from it reliably.
 */
export function formatTask(t: SubagentTask, now: number, colors: boolean): string {
  const c = colors ? { magenta, white, label: (s: string) => label(s), dim } : { magenta: id, white: id, label: id, dim: id };
  const type = t.agentType || t.type || 'agent';
  const name = t.name && t.name !== type ? `${type} ${c.dim(`(${t.name})`)}` : type;
  const bracket: string[] = [];
  if (t.model) bracket.push(fmtModel(t.model));
  if (t.effort) bracket.push(t.effort);
  const m = bracket.length > 0 ? ` ${c.label(`[${bracket.join(' | ')}]`)}` : '';
  const desc = (t.label || t.description || '').trim();
  // Width-aware: a CJK description is twice as wide as its code-unit length.
  const descShown = visualLength(desc) > 48 ? `${sliceVisible(desc, 45)}...` : desc;
  const descPart = desc ? `${c.dim(':')} ${c.white(descShown)}` : '';

  const stats: string[] = [];
  const elapsedMs = typeof t.startTime === 'number' && t.startTime > 0 ? Math.max(0, now - t.startTime) : null;
  if (elapsedMs !== null) stats.push(fmtElapsedMs(elapsedMs));
  const tokens = typeof t.tokenCount === 'number' && t.tokenCount > 0 ? t.tokenCount : null;
  if (tokens !== null && elapsedMs !== null && elapsedMs >= 5000) stats.push(`${(tokens / (elapsedMs / 1000)).toFixed(0)} tok/s`);
  if (tokens !== null) {
    const window = typeof t.contextWindowSize === 'number' && t.contextWindowSize > 0 ? t.contextWindowSize : null;
    const pct = window ? ` ${Math.round((tokens / window) * 100)}%` : '';
    stats.push(`${fmtAgentTokens(tokens)}${pct}`);
  }
  const statsPart = stats.length > 0 ? ` ${c.label(`(${stats.join(' | ')})`)}` : '';
  return `${c.magenta(name)}${m}${descPart}${statsPart}${colors ? RESET : ''}`;
}

function id(s: string): string { return s; }

/** Trim to the panel's usable width in terminal cells (ANSI is zero-width,
 * CJK is double-width), keeping color sequences intact and closing them. */
function fit(s: string, columns: number): string {
  if (columns <= 0 || visualLength(s) <= columns) return s;
  const cut = sliceVisible(s, Math.max(0, columns - 1));
  return `${cut}…${/\x1b\[/.test(cut) ? RESET : ''}`;
}

if (import.meta.main) void main();
