/**
 * Deprecated by Claude Code (2.1.32x) in favor of mods: the HUD plugin's
 * `AgentRow` hook (hooks/register.ts) draws these rows now. Kept for setups
 * that run the status line without the plugin.
 *
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
import { formatAgentRow, fitRow, type AgentRowData } from './render/agent-row.ts';

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
  /** Configured effort: a level name or a number. */
  effort?: string | number;
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
      .map(t => JSON.stringify({ id: t.id, content: fitRow(formatTask(t, now, colors), columns) }));
  } catch {
    rows = [];
  }
  for (const r of rows) console.log(r);
}

/** Payload-only row: no throughput or cost (the mod's `AgentRow` hook adds both). */
export function formatTask(raw: SubagentTask, now: number, colors: boolean): string {
  return formatAgentRow(raw as AgentRowData, now, colors);
}

if (import.meta.main) void main();
